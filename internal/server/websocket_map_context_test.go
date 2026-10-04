package server

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/nospy/albion-openradar/internal/photon"
	"github.com/stretchr/testify/require"
)

func stopMapContextTicker(ws *WebSocketHandler) {
	ws.stopOnce.Do(func() { close(ws.stopBatch) })
	<-ws.batchDone
}

func observedMapResponse(code int16, id any) *photon.OperationResponse {
	return &photon.OperationResponse{Parameters: map[byte]any{253: code, 8: id, 0: id}}
}

func TestWebSocketMapContextBootstrapsLateRadarWithoutReplayingJoinData(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	start := time.Now().UnixMilli()
	join := observedMapResponse(2, "0317")
	join.Parameters[9] = []float32{123, -456}
	join.Parameters[1] = "private-player-name"
	ws.BroadcastResponse(join)
	ws.flushBatch()
	require.Equal(t, uint64(1), ws.Stats().NoClientMessages)
	conn := dialTestWS(t, url+"/ws")
	<-accepted
	context := readTestWS(t, conn)
	require.Equal(t, "map-context", context["type"])
	require.Equal(t, "0317", context["mapId"])
	require.Equal(t, "join", context["source"])
	require.GreaterOrEqual(t, context["observedAt"].(float64), float64(start))
	require.LessOrEqual(t, context["observedAt"].(float64), float64(time.Now().UnixMilli()))
	require.Len(t, context, 4, "bootstrap contains only observed zone metadata")
	ws.sendBatch([]any{"live-after-attach"})
	require.Equal(t, []any{"live-after-attach"}, readTestWS(t, conn)["messages"])
}

func TestWebSocketMapContextAttachDrainsOldBacklogOnlyToExistingRadar(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	existing := dialTestWS(t, url+"/ws")
	<-accepted
	ws.BroadcastResponse(observedMapResponse(2, "old-map"))
	ws.flushBatch()
	require.Equal(t, "batch", readTestWS(t, existing)["type"])
	ws.BroadcastResponse(observedMapResponse(41, "new-map"))
	ws.broadcastPayload("event", map[string]any{"parameters": map[byte]any{252: int16(27), 0: "old-spawn"}})
	late := dialTestWS(t, url+"/ws")
	<-accepted
	context := readTestWS(t, late)
	require.Equal(t, "map-context", context["type"])
	require.Equal(t, "new-map", context["mapId"])
	require.Equal(t, "change-cluster", context["source"])
	require.Len(t, readTestWS(t, existing)["messages"], 2)
	ws.sendBatch([]any{"post-attach"})
	require.Equal(t, []any{"post-attach"}, readTestWS(t, late)["messages"], "late client must not replay an older map/spawn after bootstrap")
}

func TestWebSocketMapContextNeverBootstrapsLogOnlyClient(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	ws.BroadcastResponse(observedMapResponse(2, "0317"))
	ws.flushBatch()
	logs := dialTestWS(t, url+"/ws?mode=logs")
	<-accepted
	require.Eventually(t, func() bool { return ws.ClientCount() == 1 }, time.Second, time.Millisecond)
	ws.sendBatch([]any{"radar-only"})
	require.NoError(t, logs.SetReadDeadline(time.Now().Add(50*time.Millisecond)))
	_, _, err := logs.ReadMessage()
	require.Error(t, err)
}

func TestWebSocketMapContextIgnoresInvalidOrUnsuccessfulIdentity(t *testing.T) {
	cases := []struct {
		name     string
		response *photon.OperationResponse
		event    *photon.EventData
	}{
		{name: "unknown-at-start"},
		{name: "missing-id", response: observedMapResponse(2, nil)},
		{name: "empty-id", response: observedMapResponse(2, "")},
		{name: "whitespace-id", response: observedMapResponse(2, "  ")},
		{name: "unknown-sentinel", response: observedMapResponse(2, "-1")},
		{name: "nonstring-id", response: observedMapResponse(2, 317)},
		{name: "oversized-id", response: observedMapResponse(2, strings.Repeat("x", 4096))},
		{name: "failed-join", response: &photon.OperationResponse{ReturnCode: -1, Parameters: map[byte]any{253: int16(2), 8: "0317"}}},
		{name: "unknown-response", response: observedMapResponse(35, "0317")},
		{name: "noninteger-opcode", response: &photon.OperationResponse{Parameters: map[byte]any{253: float32(2), 8: "0317"}}},
		{name: "another-player-mists", event: &photon.EventData{Parameters: map[byte]any{252: int16(522), 2: "@MISTS@other", 3: false, 4: "0317"}}},
		{name: "truthy-mists-discriminator", event: &photon.EventData{Parameters: map[byte]any{252: int16(522), 2: "@MISTS@other", 3: 1, 4: "0317"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ws, url, accepted := websocketTestServer(t)
			stopMapContextTicker(ws)
			if tc.response != nil {
				ws.BroadcastResponse(tc.response)
			}
			if tc.event != nil {
				ws.BroadcastEvent(tc.event)
			}
			ws.flushBatch()
			conn := dialTestWS(t, url+"/ws")
			<-accepted
			require.Eventually(t, func() bool { return ws.RadarClientCount() == 1 }, time.Second, time.Millisecond)
			ws.sendBatch([]any{"live"})
			require.Equal(t, "batch", readTestWS(t, conn)["type"], "invalid identity must not masquerade as a bootstrap")
		})
	}
}

func TestWebSocketMapContextBootstrapsSelfMistInfoWithoutJoin(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	ws.BroadcastRequest(&photon.OperationRequest{Parameters: map[byte]any{253: int16(477), 1: byte(8), 2: byte(1)}})
	ws.BroadcastEvent(&photon.EventData{Parameters: map[byte]any{252: int16(522), 2: "@MISTS@self", 3: true, 4: "0317"}})
	ws.flushBatch()
	conn := dialTestWS(t, url+"/ws")
	<-accepted
	context := readTestWS(t, conn)
	require.Equal(t, "map-context", context["type"])
	require.Equal(t, "mists-player-joined", context["source"])
	require.Equal(t, "@MISTS@self", context["mapId"])
	require.Equal(t, "0317", context["originCluster"])
	require.Equal(t, true, context["mistLethal"])
}

func TestWebSocketMapContextExpiredChoiceDoesNotInventMistMode(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	ws.BroadcastRequest(&photon.OperationRequest{Parameters: map[byte]any{253: int16(477), 1: byte(8), 2: byte(1)}})
	ws.flushBatch()
	ws.sendMu.Lock()
	ws.pendingMistChoice.observedAt = time.Now().Add(-time.Minute)
	ws.sendMu.Unlock()
	ws.BroadcastResponse(observedMapResponse(2, "@MISTS@self"))
	ws.flushBatch()
	conn := dialTestWS(t, url+"/ws")
	<-accepted
	context := readTestWS(t, conn)
	require.Equal(t, "@MISTS@self", context["mapId"])
	require.NotContains(t, context, "mistLethal")
}

func TestWebSocketMapContextExpiredMistChainDoesNotInventInstanceOrigin(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	ws.BroadcastEvent(&photon.EventData{Parameters: map[byte]any{252: int16(522), 2: "@MISTS@first", 3: true, 4: "0317"}})
	ws.flushBatch()
	ws.sendMu.Lock()
	ws.mistContextObservedAt = time.Now().Add(-time.Hour)
	ws.sendMu.Unlock()
	ws.BroadcastResponse(observedMapResponse(2, "@MISTSDUNGEON@later"))
	ws.flushBatch()
	conn := dialTestWS(t, url+"/ws")
	<-accepted
	context := readTestWS(t, conn)
	require.Equal(t, "@MISTSDUNGEON@later", context["mapId"])
	require.NotContains(t, context, "originCluster")
	require.NotContains(t, context, "mistLethal")
}

func TestWebSocketMapContextStationaryInstanceRetainsObservedMetadata(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	ws.BroadcastEvent(&photon.EventData{Parameters: map[byte]any{252: int16(522), 2: "@MISTS@same", 3: true, 4: "0317"}})
	ws.flushBatch()
	ws.sendMu.Lock()
	ws.mistContextObservedAt = time.Now().Add(-4 * time.Hour)
	ws.sendMu.Unlock()
	ws.BroadcastResponse(observedMapResponse(2, "@MISTS@same"))
	ws.flushBatch()
	conn := dialTestWS(t, url+"/ws")
	<-accepted
	context := readTestWS(t, conn)
	require.Equal(t, "@MISTS@same", context["mapId"])
	require.Equal(t, "0317", context["originCluster"], "age alone must not discard the same observed instance")
}

func TestWebSocketMapContextActualSharedOverflowDiscardsIdentity(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	ws.BroadcastResponse(observedMapResponse(2, "0317"))
	ws.flushBatch()
	for i := 0; i <= MaxBatchQueue; i++ {
		ws.broadcastPayload("event", map[string]any{"i": i})
	}
	conn := dialTestWS(t, url+"/ws")
	<-accepted
	require.Eventually(t, func() bool { return ws.RadarClientCount() == 1 }, time.Second, time.Millisecond)
	ws.sendBatch([]any{"fresh"})
	require.Equal(t, "batch", readTestWS(t, conn)["type"])
}

func TestWebSocketMapContextEncodingFailureDiscardsIdentity(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	ws.BroadcastResponse(observedMapResponse(2, "0317"))
	ws.flushBatch()
	existing := dialTestWS(t, url+"/ws")
	<-accepted
	require.Equal(t, "map-context", readTestWS(t, existing)["type"])
	ws.sendBatch([]any{make(chan int)})
	require.Equal(t, "stream-reset", readTestWS(t, existing)["type"])
	late := dialTestWS(t, url+"/ws")
	<-accepted
	require.Eventually(t, func() bool { return ws.RadarClientCount() == 2 }, time.Second, time.Millisecond)
	ws.sendBatch([]any{"fresh"})
	require.Equal(t, "batch", readTestWS(t, late)["type"])
}

func TestWebSocketMapContextKeepsObservedMistOriginAndChoiceAcrossInstanceChain(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	ws.BroadcastRequest(&photon.OperationRequest{Parameters: map[byte]any{253: int16(477), 1: byte(8)}})
	ws.BroadcastResponse(observedMapResponse(2, "@MISTS@first"))
	ws.BroadcastEvent(&photon.EventData{Parameters: map[byte]any{252: int16(522), 2: "@MISTS@first", 3: true, 4: "0317"}})
	ws.BroadcastResponse(observedMapResponse(2, "@MISTSDUNGEON@abbey"))
	ws.BroadcastResponse(observedMapResponse(41, "@MISTS@second"))
	ws.flushBatch()
	conn := dialTestWS(t, url+"/ws")
	<-accepted
	context := readTestWS(t, conn)
	require.Equal(t, "@MISTS@second", context["mapId"])
	require.Equal(t, "0317", context["originCluster"])
	require.Equal(t, false, context["mistLethal"])
	ws.BroadcastResponse(observedMapResponse(2, "0000"))
	ws.flushBatch()
	require.Equal(t, "batch", readTestWS(t, conn)["type"])
	ws.BroadcastResponse(observedMapResponse(2, "@MISTS@unobserved-origin"))
	ws.flushBatch()
	require.Equal(t, "batch", readTestWS(t, conn)["type"])
	late := dialTestWS(t, url+"/ws")
	<-accepted
	unknown := readTestWS(t, late)
	require.Equal(t, "@MISTS@unobserved-origin", unknown["mapId"])
	require.NotContains(t, unknown, "originCluster")
	require.NotContains(t, unknown, "mistLethal")
}

func TestWebSocketMapContextResetDiscardsSavedIdentity(t *testing.T) {
	for _, reason := range []string{"queue-overflow", "encode-error"} {
		t.Run(reason, func(t *testing.T) {
			ws, url, accepted := websocketTestServer(t)
			stopMapContextTicker(ws)
			ws.BroadcastResponse(observedMapResponse(2, "0317"))
			ws.flushBatch()
			ws.sendStreamReset(reason)
			conn := dialTestWS(t, url+"/ws")
			<-accepted
			require.Eventually(t, func() bool { return ws.RadarClientCount() == 1 }, time.Second, time.Millisecond)
			ws.sendBatch([]any{"live"})
			require.Equal(t, "batch", readTestWS(t, conn)["type"])
		})
	}
}

func TestWebSocketMapContextConcurrentAttachDoesNotRepeatOrReorderMapChange(t *testing.T) {
	for i := 0; i < 12; i++ {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			ws, url, accepted := websocketTestServer(t)
			stopMapContextTicker(ws)
			ws.BroadcastResponse(observedMapResponse(2, "map-1"))
			ws.flushBatch()
			start := make(chan struct{})
			changed := make(chan struct{})
			go func() {
				<-start
				ws.BroadcastResponse(observedMapResponse(41, "map-2"))
				ws.flushBatch()
				close(changed)
			}()
			close(start)
			conn := dialTestWS(t, url+"/ws")
			<-accepted
			<-changed
			context := readTestWS(t, conn)
			require.Equal(t, "map-context", context["type"], "bootstrap must be the first frame")
			ws.sendBatch([]any{"tail"})
			changes := 0
			for {
				frame := readTestWS(t, conn)
				messages := frame["messages"].([]any)
				if len(messages) == 1 && messages[0] == "tail" {
					break
				}
				for _, raw := range messages {
					msg := raw.(map[string]any)
					params := msg["dictionary"].(map[string]any)["parameters"].(map[string]any)
					require.Equal(t, "map-2", params["0"])
					changes++
				}
			}
			if context["mapId"] == "map-1" {
				require.Equal(t, 1, changes)
			} else {
				require.Equal(t, "map-2", context["mapId"])
				require.Zero(t, changes, "already bootstrapped boundary must not be replayed")
			}
		})
	}
}

func TestWebSocketMapContextCaptureResetDropsPendingOldSource(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	ws.BroadcastResponse(observedMapResponse(2, "0317"))
	resetter, ok := any(ws).(interface{ InvalidateMapContext(string) })
	require.True(t, ok, "capture changes need a way to discard old source identity and queued packets")
	resetter.InvalidateMapContext("capture-changed")
	conn := dialTestWS(t, url+"/ws")
	<-accepted
	require.Eventually(t, func() bool { return ws.RadarClientCount() == 1 }, time.Second, time.Millisecond)
	ws.sendBatch([]any{"new-source-live"})
	require.Equal(t, "batch", readTestWS(t, conn)["type"])
}

func TestWebSocketMapContextClientOverflowRestoresOnlyObservedZone(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	ws.BroadcastResponse(observedMapResponse(2, "0317"))
	ws.flushBatch()
	conn := dialTestWS(t, url+"/ws")
	slow := <-accepted
	require.Equal(t, "map-context", readTestWS(t, conn)["type"])
	t.Cleanup(func() { close(slow.release) })
	slow.delayed.Store(true)
	ws.sendBatch([]any{"in-flight"})
	select {
	case <-slow.started:
	case <-time.After(time.Second):
		t.Fatal("slow writer did not block")
	}
	for i := 0; i < MaxClientBatchQueue; i++ {
		ws.sendBatch([]any{"stale"})
	}
	ws.sendBatch([]any{"fresh"})
	slow.delayed.Store(false)
	slow.release <- struct{}{}
	require.Equal(t, []any{"in-flight"}, readTestWS(t, conn)["messages"])
	require.Equal(t, "stream-reset", readTestWS(t, conn)["type"])
	context := readTestWS(t, conn)
	require.Equal(t, "map-context", context["type"], "a dropped bootstrap must not leave known zone identity unavailable")
	require.Equal(t, "0317", context["mapId"])
	require.Len(t, context, 4)
	require.Equal(t, []any{"fresh"}, readTestWS(t, conn)["messages"])
}

func TestWebSocketMapContextClientOverflowAfterSourceResetCannotRestoreOldZone(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	ws.BroadcastResponse(observedMapResponse(2, "0317"))
	ws.flushBatch()
	conn := dialTestWS(t, url+"/ws")
	slow := <-accepted
	require.Equal(t, "map-context", readTestWS(t, conn)["type"])
	t.Cleanup(func() { close(slow.release) })
	slow.delayed.Store(true)
	ws.sendBatch([]any{"in-flight"})
	select {
	case <-slow.started:
	case <-time.After(time.Second):
		t.Fatal("slow writer did not block")
	}
	ws.InvalidateMapContext("capture-changed")
	for i := 0; i < MaxClientBatchQueue-1; i++ {
		ws.sendBatch([]any{"stale"})
	}
	ws.sendBatch([]any{"fresh"})
	slow.delayed.Store(false)
	slow.release <- struct{}{}
	require.Equal(t, []any{"in-flight"}, readTestWS(t, conn)["messages"])
	require.Equal(t, "stream-reset", readTestWS(t, conn)["type"])
	require.Equal(t, []any{"fresh"}, readTestWS(t, conn)["messages"], "source reset must not resurrect invalidated identity")
}

func TestWebSocketMapContextClientOverflowUsesLiveBoundaryWithoutExtraBootstrap(t *testing.T) {
	ws, url, accepted := websocketTestServer(t)
	stopMapContextTicker(ws)
	ws.BroadcastResponse(observedMapResponse(2, "0317"))
	ws.flushBatch()
	conn := dialTestWS(t, url+"/ws")
	slow := <-accepted
	require.Equal(t, "map-context", readTestWS(t, conn)["type"])
	t.Cleanup(func() { close(slow.release) })
	slow.delayed.Store(true)
	ws.sendBatch([]any{"in-flight"})
	select {
	case <-slow.started:
	case <-time.After(time.Second):
		t.Fatal("slow writer did not block")
	}
	for i := 0; i < MaxClientBatchQueue; i++ {
		ws.sendBatch([]any{"stale"})
	}
	ws.BroadcastResponse(observedMapResponse(41, "0000"))
	ws.flushBatch()
	slow.delayed.Store(false)
	slow.release <- struct{}{}
	require.Equal(t, []any{"in-flight"}, readTestWS(t, conn)["messages"])
	require.Equal(t, "stream-reset", readTestWS(t, conn)["type"])
	boundary := readTestWS(t, conn)
	require.Equal(t, "batch", boundary["type"], "a surviving real boundary already carries the new map identity")
	params := boundary["messages"].([]any)[0].(map[string]any)["dictionary"].(map[string]any)["parameters"].(map[string]any)
	require.Equal(t, "0000", params["0"])
	ws.sendBatch([]any{"tail"})
	require.Equal(t, []any{"tail"}, readTestWS(t, conn)["messages"])
}
