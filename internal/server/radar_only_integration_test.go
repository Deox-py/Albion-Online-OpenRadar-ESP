package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A radar-only release must expose neither the removed panel nor its native
// controls. Test real registered routes so a forgotten hookup fails this guard.
func TestRadarOnlyReleaseHasNoAutomationRoutes(t *testing.T) {
	s := newTestServer(t, "2.3ESP_Deox-V7.3.1", true)
	paths := []string{"/automation", "/api/automation/status", "/api/automation/windows", "/api/automation/frame?windowId=excluded", "/api/automation/start", "/api/automation/stop"}
	for _, path := range paths {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			for _, partial := range []bool{false, true} {
				t.Run(method+path+map[bool]string{false: "/full", true: "/htmx"}[partial], func(t *testing.T) {
					r := httptest.NewRequest(method, "http://localhost:5555"+path, strings.NewReader(`{}`))
					r.RemoteAddr = "127.0.0.1:32000"
					r.Header.Set("Origin", "http://localhost:5555")
					r.Header.Set("Content-Type", "application/json")
					if partial {
						r.Header.Set("Hx-Request", "true")
					}
					w := httptest.NewRecorder()
					s.mux.ServeHTTP(w, r)
					if w.Code != http.StatusNotFound {
						t.Fatalf("removed route remains accessible: %s %s (partial=%v): %d", method, path, partial, w.Code)
					}
				})
			}
		}
	}
}

func TestRadarOnlyReleaseKeepsRadarPages(t *testing.T) {
	s := newTestServer(t, "2.3ESP_Deox-V7.3.1", true)
	for _, path := range []string{"/", "/home", "/players", "/resources", "/enemies", "/chests", "/ignorelist", "/settings"} {
		for _, partial := range []bool{false, true} {
			t.Run(path+map[bool]string{false: "/full", true: "/htmx"}[partial], func(t *testing.T) {
				r := httptest.NewRequest(http.MethodGet, path, http.NoBody)
				if partial {
					r.Header.Set("Hx-Request", "true")
				}
				w := httptest.NewRecorder()
				s.mux.ServeHTTP(w, r)
				if w.Code != http.StatusOK || !strings.Contains(w.Header().Get("Content-Type"), "text/html") || w.Body.Len() == 0 {
					t.Fatalf("radar route failed: %s (partial=%v): %d", path, partial, w.Code)
				}
			})
		}
	}
}
