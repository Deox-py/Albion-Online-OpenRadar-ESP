package server

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/nospy/albion-openradar/internal/logger"
	"github.com/stretchr/testify/require"
)

// Block the transport after its real WebSocket handshake, without relying on
// OS socket-buffer sizes or a large synthetic payload to create a slow reader.
type delayedWSConn struct {
	net.Conn
	delayed atomic.Bool
	started chan struct{}
	release chan struct{}
	closed  chan struct{}
	start   sync.Once
	close   sync.Once
}

func (c *delayedWSConn) Write(p []byte) (int, error) {
	if c.delayed.Load() {
		c.start.Do(func() { close(c.started) })
		select {
		case <-c.release:
		case <-c.closed:
			return 0, net.ErrClosed
		}
	}
	return c.Conn.Write(p)
}

func (c *delayedWSConn) Close() error {
	c.close.Do(func() { close(c.closed) })
	return c.Conn.Close()
}

type delayedWSListener struct {
	net.Listener
	accepted chan *delayedWSConn
}

func (l *delayedWSListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	c := &delayedWSConn{Conn: conn, started: make(chan struct{}), release: make(chan struct{}), closed: make(chan struct{})}
	l.accepted <- c
	return c, nil
}

func websocketTestServer(t *testing.T) (*WebSocketHandler, string, <-chan *delayedWSConn) {
	t.Helper()
	ws := NewWebSocketHandler(nil)
	srv := httptest.NewUnstartedServer(ws)
	listener := &delayedWSListener{Listener: srv.Listener, accepted: make(chan *delayedWSConn, 10)}
	srv.Listener = listener
	srv.Start()
	t.Cleanup(func() {
		ws.CloseAllClients()
		srv.Close()
	})
	return ws, "ws" + strings.TrimPrefix(srv.URL, "http"), listener.accepted
}

func dialTestWS(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func readTestWS(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(time.Second)))
	var msg map[string]any
	require.NoError(t, conn.ReadJSON(&msg))
	return msg
}

func TestWebSocketLogOnlyConnectionDoesNotReceiveRadar(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	logs := dialTestWS(t, url+"/ws?mode=logs")
	<-accepted
	radar := dialTestWS(t, url+"/ws")
	<-accepted
	require.Eventually(t, func() bool { return ws.ClientCount() == 2 }, time.Second, time.Millisecond)
	ws.sendBatch([]any{map[string]any{"code": "event", "dictionary": map[string]any{"code": 3}}})
	require.Equal(t, "batch", readTestWS(t, radar)["type"])
	require.NoError(t, logs.SetReadDeadline(time.Now().Add(100*time.Millisecond)))
	_, _, err := logs.ReadMessage()
	require.Error(t, err, "log-only clients must never receive game broadcasts")
}

func TestWebSocketRadarSubscriberCountExcludesLoggerClients(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	_ = dialTestWS(t, url+"/ws?mode=logs")
	<-accepted
	require.Eventually(t, func() bool { return ws.ClientCount() == 1 }, time.Second, time.Millisecond)
	counter, ok := any(ws).(interface{ RadarClientCount() int })
	require.True(t, ok, "replay must be able to distinguish radar subscriptions from log uploads")
	require.Zero(t, counter.RadarClientCount())
	_ = dialTestWS(t, url+"/ws")
	<-accepted
	require.Eventually(t, func() bool { return counter.RadarClientCount() == 1 }, time.Second, time.Millisecond)
	require.Equal(t, 2, ws.ClientCount())
}

func TestWebSocketShutdownDoesNotWaitForBlockedConnectionLog(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	logged := make(chan struct{})
	release := make(chan struct{})
	var blocked sync.Once
	logger.SetLogCallback(func(_ string, tag string, message string) {
		if tag == "WS" && strings.HasPrefix(message, "Client connected") {
			blocked.Do(func() { close(logged) })
			<-release
		}
	})
	t.Cleanup(func() { close(release); logger.ClearLogCallback() })
	_ = dialTestWS(t, url+"/ws")
	<-accepted
	<-logged
	finished := make(chan struct{})
	go func() { ws.CloseAllClients(); close(finished) }()
	select {
	case <-finished:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("shutdown waited for a connection log before its writer had even started")
	}
}

func TestWebSocketWriterCompletionDoesNotWaitForBlockedDisconnectLog(t *testing.T) {
	ws := NewWebSocketHandler(nil)
	registered := make(chan *wsClient, 1)
	// Use a real upgraded transport and the production writer without a reader
	// racing to remove it first; this isolates the failed-writer cleanup path.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := ws.upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		client := newWSClient(ws, conn, false)
		ws.clientsMu.Lock()
		ws.clients[conn] = client
		go client.writeLoop()
		ws.clientsMu.Unlock()
		registered <- client
	}))
	t.Cleanup(func() { ws.CloseAllClients(); srv.Close() })
	logged := make(chan struct{})
	release := make(chan struct{})
	var blocked sync.Once
	logger.SetLogCallback(func(_ string, tag string, message string) {
		if tag == "WS" && strings.HasPrefix(message, "Client disconnected") {
			blocked.Do(func() { close(logged) })
			<-release
		}
	})
	t.Cleanup(func() { close(release); logger.ClearLogCallback() })
	_ = dialTestWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	client := <-registered
	require.NoError(t, client.conn.UnderlyingConn().Close())
	client.enqueue(wsFrame{data: []byte(`{"type":"batch","messages":[]}`)})
	select {
	case <-logged:
	case <-time.After(time.Second):
		t.Fatal("failed writer did not reach disconnect logging")
	}
	require.Zero(t, ws.ClientCount())
	require.True(t, client.stopped(), "transport cleanup must precede the log sink")
	select {
	case <-client.writerDone:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("writer completion was withheld by an external disconnect log sink")
	}
	ws.CloseAllClients()
}

func TestWebSocketLogOnlyConnectionStillAcceptsBrowserLogs(t *testing.T) {
	logDir := t.TempDir()
	log := logger.New(logDir, true)
	t.Cleanup(log.Stop)
	ws := NewWebSocketHandler(log)
	srv := httptest.NewServer(ws)
	t.Cleanup(func() { ws.CloseAllClients(); srv.Close() })
	conn := dialTestWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws?mode=logs")
	require.NoError(t, conn.WriteJSON(map[string]any{
		"type": "logs", "logs": []any{map[string]any{"level": "WARN", "event": "accepted-entry"}},
	}))
	require.Eventually(t, func() bool {
		log.Flush()
		files, _ := filepath.Glob(filepath.Join(logDir, "debug", "front_*.jsonl"))
		if len(files) != 1 {
			return false
		}
		data, _ := os.ReadFile(files[0])
		return strings.Contains(string(data), `"event":"accepted-entry"`)
	}, time.Second, 5*time.Millisecond)
	ws.sendBatch([]any{"radar-only"})
	require.Equal(t, uint64(1), ws.Stats().NoClientMessages)
	require.Zero(t, ws.Stats().BatchesSent)
}

func TestWebSocketSlowClientDoesNotDelayHealthyClient(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	_ = dialTestWS(t, url+"/ws")
	slow := <-accepted
	healthy := dialTestWS(t, url+"/ws")
	<-accepted
	t.Cleanup(func() { close(slow.release) })
	slow.delayed.Store(true)
	go ws.sendBatch([]any{"first"})
	select {
	case <-slow.started:
	case <-time.After(time.Second):
		t.Fatal("slow client never began writing")
	}
	go ws.sendBatch([]any{"second"})
	first := readTestWS(t, healthy)
	second := readTestWS(t, healthy)
	require.Equal(t, []any{"first"}, first["messages"])
	require.Equal(t, []any{"second"}, second["messages"])
}

func TestWebSocketSharedOverflowAnnouncesLostStateBeforeFreshBatch(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	conn := dialTestWS(t, url+"/ws")
	<-accepted
	// Stop automatic flushing so this reproduces a capture burst deterministically.
	ws.stopOnce.Do(func() { close(ws.stopBatch) })
	<-ws.batchDone
	for i := 0; i <= MaxBatchQueue; i++ {
		ws.broadcastPayload("event", map[string]any{"i": i})
	}
	ws.flushBatch()
	reset := readTestWS(t, conn)
	require.Equal(t, "stream-reset", reset["type"])
	require.Equal(t, "queue-overflow", reset["reason"])
	ws.broadcastPayload("event", map[string]any{"i": "fresh"})
	ws.flushBatch()
	fresh := readTestWS(t, conn)
	require.Equal(t, "batch", fresh["type"])
	encoded, err := json.Marshal(fresh)
	require.NoError(t, err)
	require.Contains(t, string(encoded), `"i":"fresh"`)
}

func TestWebSocketClientOverflowAnnouncesLostStateBeforeNewestBatch(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	conn := dialTestWS(t, url+"/ws")
	slow := <-accepted
	t.Cleanup(func() { close(slow.release) })
	slow.delayed.Store(true)
	ws.sendBatch([]any{"in-flight"})
	select {
	case <-slow.started:
	case <-time.After(time.Second):
		t.Fatal("slow client never began writing")
	}
	for i := 0; i < MaxClientBatchQueue; i++ {
		ws.sendBatch([]any{"stale"})
	}
	ws.sendBatch([]any{"fresh"})
	// Let reads proceed without closing the channel that cleanup owns.
	slow.delayed.Store(false)
	slow.release <- struct{}{}
	require.Equal(t, []any{"in-flight"}, readTestWS(t, conn)["messages"])
	reset := readTestWS(t, conn)
	require.Equal(t, "stream-reset", reset["type"])
	require.Equal(t, "queue-overflow", reset["reason"])
	require.Equal(t, []any{"fresh"}, readTestWS(t, conn)["messages"])
	require.Equal(t, uint64(32), ws.Stats().ClientQueueDrops)
}

func TestWebSocketEncodingFailureAnnouncesLostState(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	conn := dialTestWS(t, url+"/ws")
	<-accepted
	ws.sendBatch([]any{make(chan int)})
	reset := readTestWS(t, conn)
	require.Equal(t, "stream-reset", reset["type"])
	require.Equal(t, "encode-error", reset["reason"])
	ws.sendBatch([]any{"fresh"})
	require.Equal(t, []any{"fresh"}, readTestWS(t, conn)["messages"])
}

func TestWebSocketShutdownWaitsForWriterAndRejectsNewClients(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	conn := dialTestWS(t, url+"/ws")
	<-accepted
	ws.sendBatch([]any{"last-event"})
	ws.CloseAllClients()
	require.Equal(t, []any{"last-event"}, readTestWS(t, conn)["messages"])
	_, _, err := conn.ReadMessage()
	require.True(t, websocket.IsCloseError(err, websocket.CloseGoingAway), "shutdown must send a close frame: %v", err)
	require.Zero(t, ws.ClientCount())
	ws.CloseAllClients() // Idempotent even after writers and ticker have exited.
	_, resp, err := websocket.DefaultDialer.Dial(url+"/ws", nil)
	require.Error(t, err)
	require.Equal(t, 503, resp.StatusCode)
}

func TestWebSocketCaptureWaitingForQueueCannotAppendAfterShutdown(t *testing.T) {
	ws := &WebSocketHandler{}
	ws.batchMu.Lock()
	finished := make(chan struct{})
	go func() {
		ws.broadcastPayload("event", "late-capture")
		close(finished)
	}()
	// Capture has entered while open, but is waiting for the batch lock.
	require.Never(t, func() bool {
		select {
		case <-finished:
			return true
		default:
			return false
		}
	}, 20*time.Millisecond, time.Millisecond)
	ws.closed.Store(true)
	ws.batchMu.Unlock()
	<-finished
	require.Zero(t, ws.Stats().MessagesQueue, "a stopped handler must not retain late capture events")
}
