package server

import (
	"encoding/json/v2"
	"strings"
	"time"
)

const (
	maxMapContextIDBytes = 256
	mistChoiceLifetime   = 30 * time.Second
	mistContextLifetime  = 30 * time.Minute
)

// This is last observed zone metadata, not a snapshot of game state. It never
// retains Join coordinates, player identity, entities, or the original packet.
type wsMapContext struct {
	Type          string `json:"type"`
	MapID         string `json:"mapId"`
	ObservedAt    int64  `json:"observedAt"`
	Source        string `json:"source"`
	OriginCluster string `json:"originCluster,omitempty"`
	MistLethal    *bool  `json:"mistLethal,omitempty"`
}

type wsMistChoice struct {
	lethal     bool
	observedAt time.Time
}

func validMapContextID(value any) (string, bool) {
	id, ok := value.(string)
	if !ok || id == "" || id == "-1" || len(id) > maxMapContextIDBytes || strings.TrimSpace(id) != id {
		return "", false
	}
	return id, true
}

func mapContextInteger(value any) (int64, bool) {
	switch n := value.(type) {
	case byte:
		return int64(n), true
	case int16:
		return int64(n), true
	case int32:
		return int64(n), true
	case int64:
		return n, true
	case int:
		return int64(n), true
	default:
		return 0, false
	}
}

func mistContextID(id string) bool {
	return strings.HasPrefix(id, "@MISTS@") || strings.HasPrefix(id, "@MISTSDUNGEON@")
}

// Called only under sendMu, in the same order as batch dispatch. In particular,
// no-client batches still teach us the zone captured before the browser opens.
func (ws *WebSocketHandler) observeMapContext(batch []any) bool {
	observedBoundary := false
	for _, raw := range batch {
		message, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		dictionary, ok := message["dictionary"].(map[string]any)
		if !ok {
			continue
		}
		params, ok := dictionary["parameters"].(map[byte]any)
		if !ok {
			continue
		}
		now := time.Now()
		switch message["code"] {
		case "response":
			result, validResult := mapContextInteger(dictionary["returnCode"])
			code, validCode := mapContextInteger(params[253])
			if !validResult || result != 0 || !validCode {
				continue
			}
			var id string
			var valid bool
			var source string
			if code == 2 {
				id, valid = validMapContextID(params[8])
				source = "join"
			} else if code == 41 {
				id, valid = validMapContextID(params[0])
				source = "change-cluster"
			}
			if valid {
				ws.setObservedMapContext(id, source, now)
				observedBoundary = true
			}
		case "request":
			code, validCode := mapContextInteger(params[253])
			mode, validMode := mapContextInteger(params[1])
			if validCode && code == 477 && validMode && mode == 8 {
				_, lethal := params[2]
				ws.pendingMistChoice = &wsMistChoice{lethal: lethal, observedAt: now}
			}
		case "event":
			code, validCode := mapContextInteger(params[252])
			self, _ := params[3].(bool)
			id, validID := validMapContextID(params[2])
			if !validCode || code != 522 || !self || !validID {
				continue
			}
			ws.setObservedMapContext(id, "mists-player-joined", now)
			observedBoundary = true
			if origin, validOrigin := validMapContextID(params[4]); validOrigin {
				ws.mapContext.OriginCluster = strings.Clone(origin)
				ws.mistContextObservedAt = now
			}
		}
	}
	return observedBoundary
}

func (ws *WebSocketHandler) setObservedMapContext(id, source string, now time.Time) {
	context := &wsMapContext{Type: "map-context", MapID: strings.Clone(id), Source: source, ObservedAt: now.UnixMilli()}
	if mistContextID(id) {
		// Preserve only metadata already observed in this Mist/Abbey chain. A
		// world-zone ID alone is never treated as proof of a Mist origin or mode.
		if previous := ws.mapContext; previous != nil && mistContextID(previous.MapID) && (previous.MapID == id || now.Sub(ws.mistContextObservedAt) <= mistContextLifetime) {
			context.OriginCluster = previous.OriginCluster
			context.MistLethal = previous.MistLethal
		}
		if strings.HasPrefix(id, "@MISTS@") && ws.pendingMistChoice != nil {
			if now.Sub(ws.pendingMistChoice.observedAt) <= mistChoiceLifetime {
				lethal := ws.pendingMistChoice.lethal
				context.MistLethal = &lethal
				ws.mistContextObservedAt = now
			}
			ws.pendingMistChoice = nil
		}
	} else {
		ws.pendingMistChoice = nil
		ws.mistContextObservedAt = time.Time{}
	}
	ws.mapContext = context
}

func (ws *WebSocketHandler) clearMapContext() {
	ws.mapContext = nil
	ws.pendingMistChoice = nil
	ws.mistContextObservedAt = time.Time{}
}

// Caller owns flushMu and sendMu. Capture can append the next live batch while
// the detached backlog is dispatched to existing clients. New subscribers are
// registered afterwards, so they cannot see a pre-bootstrap boundary twice.
func (ws *WebSocketHandler) drainBeforeRadarAttach() {
	ws.batchMu.Lock()
	pending, gap := ws.batchBuffer, ws.batchGap
	ws.batchBuffer = make([]any, 0, MaxBatchSize)
	ws.batchGap = false
	ws.batchMu.Unlock()
	if gap {
		ws.queueDrops.Add(uint64(len(pending)))
		ws.dispatchStreamReset("queue-overflow")
		return
	}
	for len(pending) > 0 {
		n := min(len(pending), MaxBatchSize)
		ws.sendBatchLocked(pending[:n])
		pending = pending[n:]
	}
}

func (ws *WebSocketHandler) mapContextFrame() wsFrame {
	data, _ := json.Marshal(ws.mapContext)
	return wsFrame{data: data}
}

// InvalidateMapContext is used after a real capture selection/restart change.
// The caller must first stop delivery from the previous source. Periodic
// interface discovery and unchanged selections should not call this method.
func (ws *WebSocketHandler) InvalidateMapContext(reason string) {
	ws.flushMu.Lock()
	defer ws.flushMu.Unlock()
	ws.sendMu.Lock()
	defer ws.sendMu.Unlock()
	ws.batchMu.Lock()
	ws.queueDrops.Add(uint64(len(ws.batchBuffer)))
	ws.batchBuffer = make([]any, 0, MaxBatchSize)
	ws.batchGap = false
	ws.batchMu.Unlock()
	ws.dispatchStreamReset(reason)
}
