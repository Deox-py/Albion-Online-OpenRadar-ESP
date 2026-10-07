package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nospy/albion-openradar/internal/capture"
)

type diagnosticManager struct{ fakeManager }

func (*diagnosticManager) Stats() capture.AggregateStats {
	return capture.AggregateStats{TruncatedFrames: 2, DecodeErrors: 3, IPv4FragmentsSkipped: 4}
}

func TestNetworkAPIStateExposesCaptureLayerDiagnostics(t *testing.T) {
	api := NewNetworkAPI(&diagnosticManager{}, nil, t.TempDir(), func() []string { return nil })
	r := httptest.NewRecorder()
	newTestMux(api).ServeHTTP(r, httptest.NewRequest(http.MethodGet, "/api/network/state", nil))
	var got struct {
		CaptureDiagnostics capture.DiagnosticsStats `json:"captureDiagnostics"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.CaptureDiagnostics != (capture.DiagnosticsStats{TruncatedFrames: 2, DecodeErrors: 3, IPv4FragmentsSkipped: 4}) {
		t.Fatalf("capture diagnostics=%+v", got.CaptureDiagnostics)
	}
}
