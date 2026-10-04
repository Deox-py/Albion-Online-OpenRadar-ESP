package photon

import (
	"encoding/binary"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestPhotonParserReportsMalformedMessages(t *testing.T) {
	for _, tc := range []struct {
		name string
		kind byte
	}{{"event", msgEvent}, {"request", msgRequest}, {"response", msgResponse}} {
		t.Run(tc.name, func(t *testing.T) {
			p := NewPhotonParser(nil, nil, nil)
			var reasons []string
			p.OnParseError = func(reason string, _ int) { reasons = append(reasons, reason) }
			require.False(t, p.ReceivePacket(newReliableMessagePacket(tc.kind, nil)), "malformed messages must not be counted as processed")
			require.Len(t, reasons, 1)
			require.Contains(t, reasons[0], "deserialize "+tc.name)
		})
	}
}

func TestPhotonParserIsolatesFragmentIdentity(t *testing.T) {
	for _, part := range []string{"peer", "challenge", "channel"} {
		t.Run(part, func(t *testing.T) {
			var events int
			p := NewPhotonParser(func(*EventData) { events++ }, nil, nil)
			a, b := buildFragmentedEventPackets(2), buildFragmentedEventPackets(2)
			for _, packet := range b {
				switch part {
				case "peer":
					packet[1] = 2
				case "challenge":
					packet[11] = 2
				case "channel":
					packet[photonHeaderLength+1] = 2
				}
			}
			require.True(t, p.ReceivePacket(a[0]))
			require.True(t, p.ReceivePacket(b[1]))
			require.Zero(t, events, "fragments from distinct sessions must not be combined")
			require.True(t, p.ReceivePacket(a[1]))
			require.True(t, p.ReceivePacket(b[0]))
			require.Equal(t, 2, events)
		})
	}
}

func TestPhotonParserIsolatesTransportFlows(t *testing.T) {
	var events int
	p := NewPhotonParser(func(*EventData) { events++ }, nil, nil)
	flowParser, ok := any(p).(interface{ ReceivePacketFlow(string, []byte) bool })
	require.True(t, ok, "parser must accept capture interface and directional endpoint identity")
	packets := buildFragmentedEventPackets(2)
	require.True(t, flowParser.ReceivePacketFlow("adapter-a|192.0.2.1:5056>192.0.2.2:3000", packets[0]))
	require.True(t, flowParser.ReceivePacketFlow("adapter-b|192.0.2.1:5056>192.0.2.2:3000", packets[1]))
	require.Zero(t, events)
	require.True(t, flowParser.ReceivePacketFlow("adapter-a|192.0.2.1:5056>192.0.2.2:3000", packets[1]))
	require.True(t, flowParser.ReceivePacketFlow("adapter-b|192.0.2.1:5056>192.0.2.2:3000", packets[0]))
	require.Equal(t, 2, events)
}

func TestPhotonParserCaptureResetDiscardsIncompleteOldSource(t *testing.T) {
	var events int
	p := NewPhotonParser(func(*EventData) { events++ }, nil, nil)
	reset, ok := any(p).(interface{ ResetFragments() })
	require.True(t, ok, "capture source changes must invalidate parser fragment state")
	packets := buildFragmentedEventPackets(2)
	require.True(t, p.ReceivePacketFlow("same-interface-and-endpoints", packets[0]))
	reset.ResetFragments()
	require.True(t, p.ReceivePacketFlow("same-interface-and-endpoints", packets[1]))
	require.Zero(t, events, "a post-reset fragment must not complete pre-reset bytes")
	require.True(t, p.ReceivePacketFlow("same-interface-and-endpoints", packets[0]))
	require.Equal(t, 1, events, "the new source can assemble its own complete message")
}

func TestPhotonParserRejectsInvalidFragments(t *testing.T) {
	for _, field := range []string{"overlap", "count", "number", "length", "offset", "duplicate"} {
		t.Run(field, func(t *testing.T) {
			p := NewPhotonParser(nil, nil, nil)
			var reason string
			p.OnParseError = func(r string, _ int) { reason = r }
			packets := buildFragmentedEventPackets(2)
			require.True(t, p.ReceivePacket(packets[0]))
			second := packets[1]
			header := photonHeaderLength + commandHeaderLength
			switch field {
			case "overlap":
				binary.BigEndian.PutUint32(second[header+16:], 3)
			case "count":
				binary.BigEndian.PutUint32(second[header+4:], 3)
			case "number":
				binary.BigEndian.PutUint32(second[header+8:], 2)
			case "length":
				binary.BigEndian.PutUint32(second[header+12:], 8)
			case "offset":
				binary.BigEndian.PutUint32(second[header+16:], 99)
			case "duplicate":
				second = append([]byte(nil), packets[0]...)
				second[len(second)-1] ^= 1
			}
			require.False(t, p.ReceivePacket(second), "invalid fragments must be rejected")
			require.Contains(t, reason, "fragment")
			require.Empty(t, p.pendingSegments, "invalid assembly must not remain available for reuse")
		})
	}
}

func TestPhotonParserExpiresIncompleteFragments(t *testing.T) {
	p := NewPhotonParser(nil, nil, nil)
	var reason string
	p.OnParseError = func(r string, _ int) { reason = r }
	require.True(t, p.ReceivePacket(buildFragmentedEventPackets(2)[0]))
	for _, segment := range p.pendingSegments {
		segment.createdAt = time.Now().Add(-time.Minute)
	}
	require.True(t, p.ReceivePacket(make([]byte, photonHeaderLength)))
	require.Empty(t, p.pendingSegments, "fragment state must expire even below the capacity limit")
	require.Contains(t, reason, "expired")
}

func TestPhotonParserSerializesConcurrentCallbacks(t *testing.T) {
	var inCallback, maximum, events atomic.Int32
	p := NewPhotonParser(func(*EventData) {
		n := inCallback.Add(1)
		for old := maximum.Load(); n > old && !maximum.CompareAndSwap(old, n); old = maximum.Load() {
		}
		time.Sleep(time.Millisecond)
		events.Add(1)
		inCallback.Add(-1)
	}, nil, nil)
	var wg sync.WaitGroup
	for range 32 {
		wg.Go(func() { p.ReceivePacket(buildReliableEventPacket()) })
	}
	wg.Wait()
	require.Equal(t, int32(32), events.Load())
	require.Equal(t, int32(1), maximum.Load(), "capture interfaces must share one ordered parser callback stream")
}

func TestPhotonParserRejectsTruncatedParameterValues(t *testing.T) {
	for _, tc := range []struct {
		name string
		data []byte
	}{
		{"byte", []byte{3, 1, 252, typeByte}},
		{"float", []byte{3, 1, 252, typeFloat, 0, 0}},
		{"string", []byte{3, 1, 252, typeString, 2, 'x'}},
		{"array", []byte{3, 1, 252, typeArray | typeByte, 2, 1}},
		{"parameter count", []byte{3, 2, 252, typeByte, 3}},
		{"compressed count", []byte{3, 0x80}},
		{"overflow", []byte{3, 1, 252, typeCompressedInt, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}},
		{"unsupported type", []byte{3, 1, 252, 22}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			events := 0
			p := NewPhotonParser(func(*EventData) { events++ }, nil, nil)
			var reason string
			p.OnParseError = func(r string, _ int) { reason = r }
			require.False(t, p.ReceivePacket(newReliableMessagePacket(msgEvent, tc.data)))
			require.Zero(t, events, "a partial parameter must never become a trusted default value")
			require.Contains(t, reason, "deserialize event")
		})
	}
}

func TestPhotonParserRejectsExcessiveNestedValues(t *testing.T) {
	data := []byte{3, 1, 252, typeArray}
	for range 128 {
		data = append(data, 1, typeArray)
	}
	data = append(data, 1, typeByte, 3)
	p := NewPhotonParser(nil, nil, nil)
	var reason string
	p.OnParseError = func(r string, _ int) { reason = r }
	require.False(t, p.ReceivePacket(newReliableMessagePacket(msgEvent, data)))
	require.Contains(t, reason, "nesting")
}

func TestPhotonParserBoundsFragmentCountBeforeAllocation(t *testing.T) {
	packet := buildFragmentedEventPackets(2)[0]
	header := photonHeaderLength + commandHeaderLength
	binary.BigEndian.PutUint32(packet[header+4:], 1<<20)
	binary.BigEndian.PutUint32(packet[header+12:], 1<<20)
	p := NewPhotonParser(nil, nil, nil)
	require.False(t, p.ReceivePacket(packet), "tiny fragments must not create an unbounded interval map")
	require.Empty(t, p.pendingSegments)
}

func TestPhotonParserCountsEncryptedEventMessage(t *testing.T) {
	p := NewPhotonParser(nil, nil, nil)
	encrypted := 0
	p.OnEncrypted = func() { encrypted++ }
	require.True(t, p.ReceivePacket(newReliableMessagePacket(msgEvent|0x80, []byte{1, 2, 3})))
	require.Equal(t, 1, encrypted)
}
