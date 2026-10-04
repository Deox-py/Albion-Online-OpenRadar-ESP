package photon

import (
	"bytes"
	"encoding/binary"
	"sync"
	"time"
)

const (
	photonHeaderLength   = 12
	commandHeaderLength  = 12
	fragmentHeaderLength = 20
	// Bound memory globally across every interface and connection.
	maxPendingSegments = 64
	maxFragmentCount   = 4096
	fragmentTTL        = 30 * time.Second
)

const (
	cmdDisconnect     = byte(4)
	cmdSendReliable   = byte(6)
	cmdSendUnreliable = byte(7)
	cmdSendFragment   = byte(8)
)

const (
	msgRequest     = byte(2)
	msgResponse    = byte(3)
	msgEvent       = byte(4)
	msgResponseAlt = byte(7)
	msgEncrypted   = byte(131)
)

type segmentKey struct {
	flow      string
	peer      uint16
	challenge uint32
	channel   byte
	sequence  uint32
}

type fragmentRange struct{ offset, length int }

type segmentedPackage struct {
	totalLength   int
	fragmentCount int
	bytesWritten  int
	payload       []byte
	createdAt     time.Time
	fragments     map[int]fragmentRange
}

type PhotonParser struct {
	// The callbacks form the same serial stream as the reassembly state.
	// Register callbacks before capture starts; callbacks must not reenter this parser.
	mu              sync.Mutex
	pendingSegments map[segmentKey]*segmentedPackage

	OnEvent      func(*EventData)
	OnRequest    func(*OperationRequest)
	OnResponse   func(*OperationResponse)
	OnEncrypted  func()
	OnParseError func(reason string, payloadLen int)
}

func NewPhotonParser(onEvent func(*EventData), onRequest func(*OperationRequest), onResponse func(*OperationResponse)) *PhotonParser {
	return &PhotonParser{pendingSegments: make(map[segmentKey]*segmentedPackage), OnEvent: onEvent, OnRequest: onRequest, OnResponse: onResponse}
}

// ResetFragments retires incomplete messages at an actual capture source change.
// Callers must stop previous delivery before resuming a replacement source.
func (p *PhotonParser) ResetFragments() {
	p.mu.Lock()
	clear(p.pendingSegments)
	p.mu.Unlock()
}

// ReceivePacket retains the payload-only API for offline fixtures and single-flow callers.
// Concurrent network captures should supply a directional transport identity with ReceivePacketFlow.
func (p *PhotonParser) ReceivePacket(payload []byte) bool { return p.ReceivePacketFlow("", payload) }

// ReceivePacketFlow parses a packet in its interface/source/destination namespace.
// Peer, challenge and channel from the Photon headers further isolate sessions.
func (p *PhotonParser) ReceivePacketFlow(flow string, payload []byte) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.expireSegments(time.Now())
	if len(payload) < photonHeaderLength {
		p.reportError("payload shorter than photon header", len(payload))
		return false
	}
	if payload[2] == 1 {
		if p.OnEncrypted != nil {
			p.OnEncrypted()
		}
		return false
	}
	key := segmentKey{flow: flow, peer: binary.BigEndian.Uint16(payload), challenge: binary.BigEndian.Uint32(payload[8:12])}
	offset := photonHeaderLength
	for range int(payload[3]) {
		var reason string
		offset, reason = p.handleCommand(payload, offset, key)
		if reason != "" {
			p.reportError(reason, len(payload))
			return false
		}
	}
	return true
}

func (p *PhotonParser) reportError(reason string, payloadLen int) {
	if p.OnParseError != nil {
		p.OnParseError(reason, payloadLen)
	}
}

func (p *PhotonParser) handleCommand(src []byte, offset int, key segmentKey) (nextOffset int, reason string) {
	if !available(src, offset, commandHeaderLength) {
		return offset, "handleCommand: truncated command header"
	}
	cmdType := src[offset]
	key.channel = src[offset+1]
	cmdLen := int(binary.BigEndian.Uint32(src[offset+4:])) - commandHeaderLength
	offset += commandHeaderLength
	if cmdLen < 0 || !available(src, offset, cmdLen) {
		return offset, "handleCommand: invalid command length"
	}
	end := offset + cmdLen
	switch cmdType {
	case cmdDisconnect:
		for pending := range p.pendingSegments {
			if pending.flow == key.flow && pending.peer == key.peer && pending.challenge == key.challenge {
				delete(p.pendingSegments, pending)
			}
		}
	case cmdSendUnreliable:
		if cmdLen < 4 {
			return end, "handleCommand: truncated unreliable header"
		}
		return end, p.handleSendReliable(src[offset+4 : end])
	case cmdSendReliable:
		return end, p.handleSendReliable(src[offset:end])
	case cmdSendFragment:
		return end, p.handleSendFragment(src[offset:end], key)
	}
	return end, ""
}

func (p *PhotonParser) handleSendReliable(data []byte) string {
	if len(data) < 2 {
		return "reliable message header truncated"
	}
	msgType := data[1]
	data = data[2:]
	if msgType&0x80 != 0 {
		if p.OnEncrypted != nil {
			p.OnEncrypted()
		}
		return ""
	}
	switch msgType {
	case msgRequest:
		req, err := DeserializeRequest(data)
		if err != nil {
			return "deserialize request failed: " + err.Error()
		}
		if p.OnRequest != nil {
			p.OnRequest(req)
		}
	case msgResponse, msgResponseAlt:
		resp, err := DeserializeResponse(data)
		if err != nil {
			return "deserialize response failed: " + err.Error()
		}
		if p.OnResponse != nil {
			p.OnResponse(resp)
		}
	case msgEvent:
		ev, err := DeserializeEvent(data)
		if err != nil {
			return "deserialize event failed: " + err.Error()
		}
		if p.OnEvent != nil {
			p.OnEvent(ev)
		}
	}
	return ""
}

func (p *PhotonParser) handleSendFragment(data []byte, key segmentKey) string {
	if len(data) < fragmentHeaderLength {
		return "fragment header truncated"
	}
	key.sequence = binary.BigEndian.Uint32(data)
	count := int(binary.BigEndian.Uint32(data[4:]))
	number := int(binary.BigEndian.Uint32(data[8:]))
	total := int(binary.BigEndian.Uint32(data[12:]))
	offset := int(binary.BigEndian.Uint32(data[16:]))
	chunk := data[fragmentHeaderLength:]
	reject := func(reason string) string { delete(p.pendingSegments, key); return reason }
	if total < 2 || total > maxArraySize*16 || count < 1 || count > maxFragmentCount || count > total || number < 0 || number >= count || len(chunk) == 0 || offset > total || len(chunk) > total-offset {
		return reject("fragment bounds or count invalid")
	}
	seg := p.pendingSegments[key]
	if seg == nil {
		p.evictIfFull()
		seg = &segmentedPackage{totalLength: total, fragmentCount: count, payload: make([]byte, total), createdAt: time.Now(), fragments: make(map[int]fragmentRange)}
		p.pendingSegments[key] = seg
	} else if seg.totalLength != total || seg.fragmentCount != count {
		return reject("fragment metadata mismatch")
	}
	end := offset + len(chunk)
	if prior, duplicate := seg.fragments[number]; duplicate {
		if prior.offset == offset && prior.length == len(chunk) && bytes.Equal(seg.payload[offset:end], chunk) {
			return ""
		}
		return reject("fragment duplicate mismatch")
	}
	for _, prior := range seg.fragments {
		if offset < prior.offset+prior.length && prior.offset < end {
			return reject("fragment overlap")
		}
	}
	copy(seg.payload[offset:end], chunk)
	seg.fragments[number] = fragmentRange{offset: offset, length: len(chunk)}
	seg.bytesWritten += len(chunk)
	if len(seg.fragments) == count {
		if seg.bytesWritten != total {
			return reject("fragment assembly has gaps")
		}
		delete(p.pendingSegments, key)
		return p.handleSendReliable(seg.payload)
	}
	return ""
}

func (p *PhotonParser) expireSegments(now time.Time) {
	for key, seg := range p.pendingSegments {
		if now.Sub(seg.createdAt) >= fragmentTTL {
			delete(p.pendingSegments, key)
			p.reportError("fragment reassembly expired", seg.totalLength)
		}
	}
}

func (p *PhotonParser) evictIfFull() {
	if len(p.pendingSegments) < maxPendingSegments {
		return
	}
	var oldestKey segmentKey
	var oldestTime time.Time
	for key, seg := range p.pendingSegments {
		if oldestTime.IsZero() || seg.createdAt.Before(oldestTime) {
			oldestKey, oldestTime = key, seg.createdAt
		}
	}
	seg := p.pendingSegments[oldestKey]
	delete(p.pendingSegments, oldestKey)
	p.reportError("fragment reassembly capacity exceeded", seg.totalLength)
}

func available(src []byte, offset, count int) bool {
	return count >= 0 && offset >= 0 && len(src)-offset >= count
}
