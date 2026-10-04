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
	MaxClientBatchQueue = 32
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
	ClientQueueDrops uint64
	StreamResets     uint64
}

// WebSocketHandler manages WebSocket connections and broadcasts
type WebSocketHandler struct {
	clients   map[*websocket.Conn]*wsClient
	clientsMu sync.RWMutex
	upgrader  websocket.Upgrader
	logger    *logger.Logger

	// Batching
	batchBuffer []any
	batchMu     sync.Mutex
	batchTicker *time.Ticker
	stopBatch   chan struct{}
	batchDone   chan struct{}
	flushNow    chan struct{}
	stopOnce    sync.Once
	closeOnce   sync.Once
	closed      atomic.Bool
	flushMu     sync.Mutex
	sendMu      sync.Mutex
	batchGap    bool
	// Minimal zone metadata; sendMu protects it and its dispatch ordering.
	mapContext            *wsMapContext
	pendingMistChoice     *wsMistChoice
	mistContextObservedAt time.Time

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
	clientQueueDrops atomic.Uint64
	streamResets     atomic.Uint64
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
		clients:     make(map[*websocket.Conn]*wsClient),
		logger:      log,
		batchBuffer: make([]any, 0, MaxBatchSize),
		stopBatch:   make(chan struct{}),
		batchDone:   make(chan struct{}),
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
		defer close(ws.batchDone)
		defer ws.batchTicker.Stop()
		for {
			select {
			case <-ws.batchTicker.C:
				ws.flushBatch()
			case <-ws.flushNow:
				ws.flushBatch()
			case <-ws.stopBatch:
				return
			}
		}
	}()
}

func (ws *WebSocketHandler) flushBatch() {
	// Serialize popping and dispatch together so concurrent flushes cannot
	// enqueue a later batch before an earlier one.
	ws.flushMu.Lock()
	defer ws.flushMu.Unlock()
	for {
		ws.batchMu.Lock()
		if ws.batchGap {
			ws.queueDrops.Add(uint64(len(ws.batchBuffer)))
			ws.batchBuffer = make([]any, 0, MaxBatchSize)
			ws.batchGap = false
			ws.batchMu.Unlock()
			ws.sendStreamReset("queue-overflow")
			continue
		}
		ws.batchMu.Unlock()
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
	ws.sendMu.Lock()
	defer ws.sendMu.Unlock()
	ws.sendBatchLocked(batch)
}

func (ws *WebSocketHandler) sendBatchLocked(batch []any) {
	observedBoundary := ws.observeMapContext(batch)
	msgCount := uint64(len(batch))
	ws.clientsMu.RLock()
	hasClients := false
	for _, client := range ws.clients {
		if !client.logsOnly {
			hasClients = true
			break
		}
	}
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
		ws.queueDrops.Add(msgCount)
		ws.dispatchStreamReset("encode-error")
		return
	}
	var overflowContext *wsFrame
	if !observedBoundary && ws.mapContext != nil {
		context := ws.mapContextFrame()
		overflowContext = &context
	}
	ws.clientsMu.RLock()
	for _, client := range ws.clients {
		if !client.logsOnly {
			client.enqueueWithMapContext(wsFrame{data: data, messages: msgCount}, overflowContext)
		}
	}
	ws.clientsMu.RUnlock()

	ws.batchesSent.Add(1)
	ws.messagesSent.Add(msgCount)
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
		ClientQueueDrops: ws.clientQueueDrops.Load(),
		StreamResets:     ws.streamResets.Load(),
	}
}

// ServeHTTP implements http.Handler for WebSocket upgrades
func (ws *WebSocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ws.handleConnection(w, r)
}

// handleConnection handles new WebSocket connections
func (ws *WebSocketHandler) handleConnection(w http.ResponseWriter, r *http.Request) {
	if ws.closed.Load() {
		http.Error(w, "server shutting down", http.StatusServiceUnavailable)
		return
	}
	// Upgrade connection first (doesn't require lock)
	conn, err := ws.upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.PrintError("WS", "Upgrade error: %v", err)
		return
	}

	// Serialize bootstrap with detached batches and live dispatch. Capture can
	// continue appending future batches while these bounded queues are filled.
	ws.flushMu.Lock()
	ws.sendMu.Lock()
	logsOnly := r.URL.Query().Get("mode") == "logs"
	if !logsOnly && !ws.closed.Load() {
		ws.drainBeforeRadarAttach()
	}
	// Check limit AND register atomically to fix race condition.
	ws.clientsMu.Lock()
	if ws.closed.Load() || len(ws.clients) >= MaxWebSocketClients {
		ws.clientsMu.Unlock()
		ws.sendMu.Unlock()
		ws.flushMu.Unlock()
		_ = conn.Close()
		logger.PrintWarn("WS", "Connection rejected: max clients reached (%d)", MaxWebSocketClients)
		return
	}
	conn.SetReadLimit(MaxClientMessage)
	client := newWSClient(ws, conn, logsOnly)
	if !logsOnly && ws.mapContext != nil {
		client.enqueue(ws.mapContextFrame())
	}
	ws.clients[conn] = client
	clientCount := len(ws.clients)
	// Start owned workers before exposing the registration to shutdown or
	// invoking logging callbacks, which may themselves block.
	go client.writeLoop()
	go ws.handleMessages(client)
	ws.clientsMu.Unlock()
	ws.sendMu.Unlock()
	ws.flushMu.Unlock()

	logger.PrintInfo("WS", "Client connected (%d total)", clientCount)
}

// handleMessages handles incoming messages from a client
func (ws *WebSocketHandler) handleMessages(client *wsClient) {
	defer ws.removeClient(client)

	for {
		_, message, err := client.conn.ReadMessage()
		if err != nil {
			if ws.closed.Load() || client.stopped() {
				return
			}
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
	ws.closeOnce.Do(func() {
		ws.closed.Store(true)
		ws.stopOnce.Do(func() {
			if ws.stopBatch != nil {
				close(ws.stopBatch)
			}
		})
		if ws.batchDone != nil {
			<-ws.batchDone
		}
		ws.flushBatch()
		ws.sendMu.Lock()
		ws.clearMapContext()
		ws.sendMu.Unlock()
		ws.clientsMu.Lock()
		clients := make([]*wsClient, 0, len(ws.clients))
		for conn, client := range ws.clients {
			clients = append(clients, client)
			delete(ws.clients, conn)
		}
		ws.clientsMu.Unlock()
		for _, client := range clients {
			close(client.shutdown)
		}
		// All writers shut down concurrently. One slow socket cannot add a
		// separate write timeout for every connected browser.
		timer := time.NewTimer(WebSocketWriteWait)
		defer timer.Stop()
		for _, client := range clients {
			select {
			case <-client.writerDone:
			case <-timer.C:
				for _, pending := range clients {
					pending.stop()
				}
				for _, pending := range clients {
					<-pending.writerDone
				}
				return
			}
		}
	})
}

// broadcastPayload adds a message to the batch buffer without blocking the
// packet-capture goroutine on WebSocket writes. Large bursts trigger an early
// flush, while MaxBatchQueue provides a hard memory bound if clients are slow.
func (ws *WebSocketHandler) broadcastPayload(code string, payload any) {
	if ws.closed.Load() {
		return
	}
	msg := map[string]any{
		"code":       code,
		"dictionary": payload,
	}
	ws.batchMu.Lock()
	if ws.closed.Load() {
		ws.batchMu.Unlock()
		return
	}
	if ws.batchGap || len(ws.batchBuffer) >= MaxBatchQueue {
		ws.batchGap = true
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

// RadarClientCount excludes input-only logger connections. Offline replay must
// wait for an actual radar subscriber before delivering its finite history.
func (ws *WebSocketHandler) RadarClientCount() int {
	ws.clientsMu.RLock()
	defer ws.clientsMu.RUnlock()
	count := 0
	for _, client := range ws.clients {
		if !client.logsOnly {
			count++
		}
	}
	return count
}
