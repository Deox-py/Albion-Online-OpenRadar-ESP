package server

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"github.com/nospy/albion-openradar/internal/logger"
	"github.com/nospy/albion-openradar/internal/photon"
)

const (
	MaxWebSocketClients = 100
	BatchInterval       = 16 * time.Millisecond // ~60 fps
	MaxBatchSize        = 100
	MaxBatchQueue       = 2000 // hard cap so a slow/noisy client cannot grow memory without bound
	MaxClientMessage    = 256 << 10
	WebSocketWriteWait  = 5 * time.Second
)

// WSBatchMessage represents a batch of messages
type WSBatchMessage struct {
	Type     string `json:"type"`
	Messages []any  `json:"messages"`
}

var wsJSONOptions = json.JoinOptions(
	jsontext.AllowInvalidUTF8(true),
	json.FormatNilMapAsNull(true),
	json.FormatNilSliceAsNull(true),
)

func encodeBatch(batch []any) ([]byte, error) {
	return json.Marshal(&WSBatchMessage{Type: "batch", Messages: batch}, wsJSONOptions)
}

// WSStats holds WebSocket statistics
type WSStats struct {
	BatchesSent      uint64
	MessagesSent     uint64
	MessagesQueue    int
	BytesSent        uint64
	ReadErrors       uint64
	WriteFailures    uint64
	NormalCloses     uint64
	QueueDrops       uint64
	NoClientMessages uint64
}

// WebSocketHandler manages WebSocket connections and broadcasts
type WebSocketHandler struct {
	clients   map[*websocket.Conn]bool
	clientsMu sync.RWMutex
	upgrader  websocket.Upgrader
	logger    *logger.Logger

	// Batching
	batchBuffer []any
	batchMu     sync.Mutex
	batchTicker *time.Ticker
	stopBatch   chan struct{}
	flushNow    chan struct{}
	stopOnce    sync.Once
	writeMu     sync.Mutex

	// Stats. Atomics avoid races between the batch writer, connection readers,
	// and the 1 Hz dashboard sampler.
	batchesSent      atomic.Uint64
	messagesSent     atomic.Uint64
	bytesSent        atomic.Uint64
	readErrors       atomic.Uint64
	writeFailures    atomic.Uint64
	normalCloses     atomic.Uint64
	queueDrops       atomic.Uint64
	noClientMessages atomic.Uint64
}

// sameOriginWebSocket rejects browser WebSocket requests originating from a
// different site. This protects the localhost API from drive-by pages while
// still allowing the local UI, LAN UI, and non-browser clients without Origin.
func sameOriginWebSocket(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	return strings.EqualFold(u.Host, r.Host)
}

// NewWebSocketHandler creates a new WebSocket handler
func NewWebSocketHandler(log *logger.Logger) *WebSocketHandler {
	ws := &WebSocketHandler{
		clients:     make(map[*websocket.Conn]bool),
		logger:      log,
		batchBuffer: make([]any, 0, MaxBatchSize),
		stopBatch:   make(chan struct{}),
		flushNow:    make(chan struct{}, 1),
		upgrader: websocket.Upgrader{
			CheckOrigin: sameOriginWebSocket,
		},
	}
	ws.startBatchTicker()
	return ws
}

func (ws *WebSocketHandler) startBatchTicker() {
	ws.batchTicker = time.NewTicker(BatchInterval)
	go func() {
		for {
			select {
			case <-ws.batchTicker.C:
				ws.flushBatch()
			case <-ws.flushNow:
				ws.flushBatch()
			case <-ws.stopBatch:
				ws.batchTicker.Stop()
				return
			}
		}
	}()
}

func (ws *WebSocketHandler) flushBatch() {
	for {
		batch := ws.popBatch(MaxBatchSize)
		if len(batch) == 0 {
			return
		}
		ws.sendBatch(batch)
		if len(batch) < MaxBatchSize {
			return
		}
	}
}

func (ws *WebSocketHandler) popBatch(limit int) []any {
	ws.batchMu.Lock()
	defer ws.batchMu.Unlock()
	if len(ws.batchBuffer) == 0 {
		return nil
	}
	n := min(limit, len(ws.batchBuffer))
	batch := make([]any, n)
	copy(batch, ws.batchBuffer[:n])
	ws.batchBuffer = ws.batchBuffer[n:]
	if len(ws.batchBuffer) == 0 {
		ws.batchBuffer = make([]any, 0, MaxBatchSize)
	}
	return batch
}

func (ws *WebSocketHandler) sendBatch(batch []any) {
	msgCount := uint64(len(batch))
	ws.clientsMu.RLock()
	hasClients := len(ws.clients) > 0
	ws.clientsMu.RUnlock()
	if !hasClients {
		ws.noClientMessages.Add(msgCount)
		return
	}

	data, err := encodeBatch(batch)
	if err != nil {
		logger.PrintWarn("WS", "batch marshal failed: %v (batch size=%d, DROPPED)", err, msgCount)
		for i, m := range batch {
			if _, err := json.Marshal(m, wsJSONOptions); err != nil {
				logger.PrintWarn("WS", "  offending message[%d]: %v (type=%T, value=%+v)", i, err, m, m)
			}
		}
		return
	}

	dataLen := uint64(len(data))
	var failedClients []*websocket.Conn
	var sentCount uint64

	// gorilla/websocket permits one concurrent writer per connection. A single
	// handler-level lock also serializes immediate full batches with ticker
	// flushes and graceful shutdown close frames.
	ws.writeMu.Lock()
	ws.clientsMu.RLock()
	for client := range ws.clients {
		_ = client.SetWriteDeadline(time.Now().Add(WebSocketWriteWait))
		if err := client.WriteMessage(websocket.TextMessage, data); err != nil {
			failedClients = append(failedClients, client)
		} else {
			sentCount++
		}
	}
	ws.clientsMu.RUnlock()
	ws.writeMu.Unlock()

	ws.batchesSent.Add(1)
	ws.messagesSent.Add(msgCount)
	ws.bytesSent.Add(dataLen * sentCount)
	if len(failedClients) > 0 {
		ws.writeFailures.Add(uint64(len(failedClients)))
		ws.clientsMu.Lock()
		for _, client := range failedClients {
			if _, exists := ws.clients[client]; exists {
				_ = client.Close()
				delete(ws.clients, client)
			}
		}
		ws.clientsMu.Unlock()
	}
}

// Stats returns current WebSocket statistics
func (ws *WebSocketHandler) Stats() WSStats {
	ws.batchMu.Lock()
	queueLen := len(ws.batchBuffer)
	ws.batchMu.Unlock()

	return WSStats{
		BatchesSent:      ws.batchesSent.Load(),
		MessagesSent:     ws.messagesSent.Load(),
		MessagesQueue:    queueLen,
		BytesSent:        ws.bytesSent.Load(),
		ReadErrors:       ws.readErrors.Load(),
		WriteFailures:    ws.writeFailures.Load(),
		NormalCloses:     ws.normalCloses.Load(),
		QueueDrops:       ws.queueDrops.Load(),
		NoClientMessages: ws.noClientMessages.Load(),
	}
}

// ServeHTTP implements http.Handler for WebSocket upgrades
func (ws *WebSocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ws.handleConnection(w, r)
}

// handleConnection handles new WebSocket connections
func (ws *WebSocketHandler) handleConnection(w http.ResponseWriter, r *http.Request) {
	// Upgrade connection first (doesn't require lock)
	conn, err := ws.upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.PrintError("WS", "Upgrade error: %v", err)
		return
	}

	// Check limit AND register atomically to fix race condition
	ws.clientsMu.Lock()
	if len(ws.clients) >= MaxWebSocketClients {
		ws.clientsMu.Unlock()
		_ = conn.Close()
		logger.PrintWarn("WS", "Connection rejected: max clients reached (%d)", MaxWebSocketClients)
		return
	}
	conn.SetReadLimit(MaxClientMessage)
	ws.clients[conn] = true
	clientCount := len(ws.clients)
	ws.clientsMu.Unlock()

	logger.PrintInfo("WS", "Client connected (%d total)", clientCount)

	// Handle incoming messages (for logs from client)
	go ws.handleMessages(conn)
}

// handleMessages handles incoming messages from a client
func (ws *WebSocketHandler) handleMessages(conn *websocket.Conn) {
	defer func() {
		ws.clientsMu.Lock()
		delete(ws.clients, conn)
		clientCount := len(ws.clients)
		ws.clientsMu.Unlock()
		_ = conn.Close()
		logger.PrintInfo("WS", "Client disconnected (%d remaining)", clientCount)
	}()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			// Browsers commonly close a tab/reload without a close status (1005).
			// Treat those as normal lifecycle noise instead of an application error.
			if websocket.IsCloseError(
				err,
				websocket.CloseNormalClosure,
				websocket.CloseGoingAway,
				websocket.CloseNoStatusReceived,
			) {
				ws.normalCloses.Add(1)
			} else {
				ws.readErrors.Add(1)
				logger.PrintWarn("WS", "Read error: %v", err)
			}
			break
		}

		if logs := parseClientLogs(message); len(logs) > 0 && ws.logger != nil {
			ws.logger.WriteLogs(logs)
		}
	}
}

func parseClientLogs(message []byte) []any {
	var data struct {
		Type string `json:"type"`
		Logs []any  `json:"logs"`
	}
	if err := json.Unmarshal(message, &data, jsontext.AllowInvalidUTF8(true)); err != nil || data.Type != "logs" {
		return nil
	}
	return data.Logs
}

// CloseAllClients closes all WebSocket connections gracefully
func (ws *WebSocketHandler) CloseAllClients() {
	ws.stopOnce.Do(func() { close(ws.stopBatch) })
	ws.flushBatch() // Flush remaining events

	ws.writeMu.Lock()
	ws.clientsMu.Lock()
	for client := range ws.clients {
		_ = client.SetWriteDeadline(time.Now().Add(WebSocketWriteWait))
		_ = client.WriteMessage(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseGoingAway, "server shutting down"),
		)
		_ = client.Close()
		delete(ws.clients, client)
	}
	ws.clientsMu.Unlock()
	ws.writeMu.Unlock()
}

// broadcastPayload adds a message to the batch buffer without blocking the
// packet-capture goroutine on WebSocket writes. Large bursts trigger an early
// flush, while MaxBatchQueue provides a hard memory bound if clients are slow.
func (ws *WebSocketHandler) broadcastPayload(code string, payload any) {
	msg := map[string]any{
		"code":       code,
		"dictionary": payload,
	}
	ws.batchMu.Lock()
	if len(ws.batchBuffer) >= MaxBatchQueue {
		ws.batchMu.Unlock()
		ws.queueDrops.Add(1)
		return
	}
	ws.batchBuffer = append(ws.batchBuffer, msg)
	shouldFlush := len(ws.batchBuffer) >= MaxBatchSize
	ws.batchMu.Unlock()

	if shouldFlush {
		select {
		case ws.flushNow <- struct{}{}:
		default:
		}
	}
}

// BroadcastEvent broadcasts an event to all clients
func (ws *WebSocketHandler) BroadcastEvent(event *photon.EventData) {
	ws.broadcastPayload("event", map[string]any{
		"code":       event.Code,
		"parameters": event.Parameters,
	})
}

// BroadcastRequest broadcasts a request to all clients
func (ws *WebSocketHandler) BroadcastRequest(req *photon.OperationRequest) {
	ws.broadcastPayload("request", map[string]any{
		"operationCode": req.OperationCode,
		"parameters":    req.Parameters,
	})
}

// BroadcastResponse broadcasts a response to all clients
func (ws *WebSocketHandler) BroadcastResponse(resp *photon.OperationResponse) {
	ws.broadcastPayload("response", map[string]any{
		"operationCode": resp.OperationCode,
		"returnCode":    resp.ReturnCode,
		"debugMessage":  resp.DebugMessage,
		"parameters":    resp.Parameters,
	})
}

// ClientCount returns the number of connected clients
func (ws *WebSocketHandler) ClientCount() int {
	ws.clientsMu.RLock()
	defer ws.clientsMu.RUnlock()
	return len(ws.clients)
}
