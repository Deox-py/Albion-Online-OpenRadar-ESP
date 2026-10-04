package server

import (
	"encoding/json/v2"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/nospy/albion-openradar/internal/logger"
)

type wsFrame struct {
	data     []byte
	messages uint64
	reset    bool
}

// Each connection owns exactly one data writer. Broadcasts only enqueue an
// immutable encoded frame, so transport latency never blocks another client.
type wsClient struct {
	handler    *WebSocketHandler
	conn       *websocket.Conn
	logsOnly   bool
	queue      chan wsFrame
	queueMu    sync.Mutex
	done       chan struct{}
	stopOnce   sync.Once
	shutdown   chan struct{}
	writerDone chan struct{}
}

func newWSClient(ws *WebSocketHandler, conn *websocket.Conn, logsOnly bool) *wsClient {
	return &wsClient{
		handler: ws, conn: conn, logsOnly: logsOnly,
		queue: make(chan wsFrame, MaxClientBatchQueue), done: make(chan struct{}),
		shutdown: make(chan struct{}), writerDone: make(chan struct{}),
	}
}

func streamResetFrame(reason string) wsFrame {
	data, _ := json.Marshal(struct {
		Type   string `json:"type"`
		Reason string `json:"reason"`
	}{Type: "stream-reset", Reason: reason})
	return wsFrame{data: data, reset: true}
}

func (c *wsClient) stopped() bool {
	select {
	case <-c.done:
		return true
	default:
		return false
	}
}

func (c *wsClient) discardQueue() {
	for {
		select {
		case frame := <-c.queue:
			c.handler.clientQueueDrops.Add(frame.messages)
		default:
			return
		}
	}
}

func (c *wsClient) enqueue(frame wsFrame) {
	c.enqueueWithMapContext(frame, nil)
}

func (c *wsClient) enqueueWithMapContext(frame wsFrame, context *wsFrame) {
	c.queueMu.Lock()
	defer c.queueMu.Unlock()
	if c.stopped() {
		return
	}
	if frame.reset {
		c.discardQueue()
	} else if len(c.queue) == cap(c.queue) {
		// Dropping a spawn/removal makes the old entity cache untrustworthy.
		// Discard the stale backlog and put the reset before the newest batch.
		c.discardQueue()
		c.queue <- streamResetFrame("queue-overflow")
		// Restore only the server's observed zone metadata after the gap. The
		// caller supplies an immutable frame under dispatch ordering; the client
		// never reads shared cache state or replays player/entity data here.
		if context != nil {
			c.queue <- *context
		}
	}
	c.queue <- frame
}

func (c *wsClient) stop() {
	c.stopOnce.Do(func() {
		close(c.done)
		_ = c.conn.Close() // Also unblocks an in-flight reader or writer.
	})
}

func (c *wsClient) writeFrame(frame wsFrame) bool {
	_ = c.conn.SetWriteDeadline(time.Now().Add(WebSocketWriteWait))
	if err := c.conn.WriteMessage(websocket.TextMessage, frame.data); err != nil {
		if !c.handler.closed.Load() && !c.stopped() {
			c.handler.writeFailures.Add(1)
		}
		return false
	}
	c.handler.bytesSent.Add(uint64(len(frame.data)))
	if frame.reset {
		c.handler.streamResets.Add(1)
	}
	return true
}

func (c *wsClient) writeLoop() {
	defer func() {
		count, existed := c.handler.detachClient(c)
		// Signal completion of transport ownership before invoking an external
		// log sink. A blocked sink must not withhold writer cleanup completion.
		close(c.writerDone)
		if existed {
			logger.PrintInfo("WS", "Client disconnected (%d remaining)", count)
		}
	}()
	for {
		select {
		case <-c.done:
			return
		case <-c.shutdown:
			// Preserve queued ordering during a graceful shutdown. CloseAllClients
			// forcibly closes every transport if the shared time budget expires.
			for {
				select {
				case frame := <-c.queue:
					if !c.writeFrame(frame) {
						return
					}
				default:
					_ = c.conn.SetWriteDeadline(time.Now().Add(WebSocketWriteWait))
					_ = c.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseGoingAway, "server shutting down"))
					return
				}
			}
		case frame := <-c.queue:
			if !c.writeFrame(frame) {
				return
			}
		}
	}
}

func (ws *WebSocketHandler) removeClient(client *wsClient) {
	count, existed := ws.detachClient(client)
	if existed {
		logger.PrintInfo("WS", "Client disconnected (%d remaining)", count)
	}
}

func (ws *WebSocketHandler) detachClient(client *wsClient) (int, bool) {
	client.stop()
	ws.clientsMu.Lock()
	_, existed := ws.clients[client.conn]
	delete(ws.clients, client.conn)
	count := len(ws.clients)
	ws.clientsMu.Unlock()
	return count, existed
}

func (ws *WebSocketHandler) sendStreamReset(reason string) {
	ws.sendMu.Lock()
	defer ws.sendMu.Unlock()
	ws.dispatchStreamReset(reason)
}

func (ws *WebSocketHandler) dispatchStreamReset(reason string) {
	ws.clearMapContext()
	frame := streamResetFrame(reason)
	ws.clientsMu.RLock()
	defer ws.clientsMu.RUnlock()
	for _, client := range ws.clients {
		if !client.logsOnly {
			client.enqueue(frame)
		}
	}
}
