package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestSameOriginWebSocket(t *testing.T) {
	tests := []struct {
		name   string
		host   string
		origin string
		want   bool
	}{
		{name: "same localhost", host: "localhost:5001", origin: "http://localhost:5001", want: true},
		{name: "same lan", host: "192.168.1.3:5001", origin: "http://192.168.1.3:5001", want: true},
		{name: "missing origin allows cli", host: "localhost:5001", origin: "", want: true},
		{name: "different host rejected", host: "localhost:5001", origin: "https://example.com", want: false},
		{name: "different port rejected", host: "localhost:5001", origin: "http://localhost:8080", want: false},
		{name: "invalid scheme rejected", host: "localhost:5001", origin: "file:///tmp/x", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "http://"+tt.host+"/ws", nil)
			r.Host = tt.host
			if tt.origin != "" {
				r.Header.Set("Origin", tt.origin)
			}
			if got := sameOriginWebSocket(r); got != tt.want {
				t.Fatalf("sameOriginWebSocket()=%v want %v", got, tt.want)
			}
		})
	}
}

func TestSecurityHeaders(t *testing.T) {
	h := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "http://localhost:5001/", nil)
	h.ServeHTTP(rr, r)

	if got := rr.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options=%q", got)
	}
	if got := rr.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Fatalf("Referrer-Policy=%q", got)
	}
	if got := rr.Header().Get("Permissions-Policy"); !strings.Contains(got, "camera=()") {
		t.Fatalf("Permissions-Policy missing camera restriction: %q", got)
	}
	if got := rr.Header().Get("Content-Security-Policy"); !strings.Contains(got, "object-src 'none'") {
		t.Fatalf("CSP missing object-src restriction: %q", got)
	}
}

func TestWebSocketQueueIsHardBounded(t *testing.T) {
	ws := &WebSocketHandler{
		clients:     make(map[*websocket.Conn]*wsClient),
		batchBuffer: make([]any, 0, MaxBatchSize),
		stopBatch:   make(chan struct{}),
		flushNow:    make(chan struct{}, 1),
	}
	for i := 0; i < MaxBatchQueue+5; i++ {
		ws.broadcastPayload("test", map[string]any{"i": i})
	}
	stats := ws.Stats()
	if stats.MessagesQueue != MaxBatchQueue {
		t.Fatalf("queue=%d want hard cap %d", stats.MessagesQueue, MaxBatchQueue)
	}
	if stats.QueueDrops != 5 {
		t.Fatalf("queue drops=%d want 5", stats.QueueDrops)
	}
}

func TestLocalMutationsOnly(t *testing.T) {
	called := 0
	h := localMutationsOnly(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		w.WriteHeader(http.StatusNoContent)
	}))

	t.Run("remote get remains readable", func(t *testing.T) {
		rr := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "http://192.168.1.3:5001/api/network/state", nil)
		r.RemoteAddr = "192.168.1.44:54321"
		h.ServeHTTP(rr, r)
		if rr.Code != http.StatusNoContent {
			t.Fatalf("GET status=%d want %d", rr.Code, http.StatusNoContent)
		}
	})

	t.Run("remote post is forbidden", func(t *testing.T) {
		rr := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "http://192.168.1.3:5001/api/settings/logging", strings.NewReader(`{}`))
		r.RemoteAddr = "192.168.1.44:54321"
		h.ServeHTTP(rr, r)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("POST status=%d want %d", rr.Code, http.StatusForbidden)
		}
	})

	t.Run("localhost post is allowed", func(t *testing.T) {
		rr := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "http://localhost:5001/api/settings/logging", strings.NewReader(`{}`))
		r.RemoteAddr = "127.0.0.1:54321"
		h.ServeHTTP(rr, r)
		if rr.Code != http.StatusNoContent {
			t.Fatalf("localhost POST status=%d want %d", rr.Code, http.StatusNoContent)
		}
	})

	if called != 2 {
		t.Fatalf("handler called %d times want 2", called)
	}
}
