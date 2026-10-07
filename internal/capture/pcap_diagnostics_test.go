package capture

import (
	"testing"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
)

func TestCaptureDiagnosticsRejectsTruncatedPayload(t *testing.T) {
	c := &Capturer{}
	delivered := 0
	c.OnPacket(func([]byte) { delivered++ })
	p := buildUDPPacket(t, []byte("valid"))
	p.Metadata().CaptureLength = len(p.Data())
	p.Metadata().Length = len(p.Data()) + 10
	c.processPacket(p)
	if got := c.DiagnosticsStats(); got.TruncatedFrames != 1 || got.DecodeErrors != 0 || delivered != 0 || c.BytesReceived() != 0 {
		t.Fatalf("diagnostics=%+v delivered=%d bytes=%d", got, delivered, c.BytesReceived())
	}
}

func TestCaptureDiagnosticsCountsDecoderTruncationOnce(t *testing.T) {
	c := &Capturer{}
	p := gopacket.NewPacket([]byte{0, 1}, layers.LinkTypeEthernet, gopacket.Default)
	p.Metadata().CaptureLength = 2
	p.Metadata().Length = 30
	c.processPacket(p)
	if got := c.DiagnosticsStats(); got.TruncatedFrames != 1 || got.DecodeErrors != 1 {
		t.Fatalf("diagnostics=%+v, want one truncated frame and one decode error", got)
	}
}

func TestCaptureDiagnosticsSkipsIPv4Fragments(t *testing.T) {
	for _, fragment := range []struct {
		name   string
		flags  layers.IPv4Flag
		offset uint16
	}{{"first", layers.IPv4MoreFragments, 0}, {"later", 0, 1}} {
		t.Run(fragment.name, func(t *testing.T) {
			c := &Capturer{}
			delivered := 0
			c.OnPacket(func([]byte) { delivered++ })
			p := buildUDPPacket(t, []byte("fragment-data"))
			ip := p.Layer(layers.LayerTypeIPv4).(*layers.IPv4)
			ip.Flags, ip.FragOffset = fragment.flags, fragment.offset
			c.processPacket(p)
			if got := c.DiagnosticsStats(); got.IPv4FragmentsSkipped != 1 || got.TruncatedFrames != 0 || got.DecodeErrors != 0 || delivered != 0 {
				t.Fatalf("diagnostics=%+v delivered=%d", got, delivered)
			}
		})
	}
}

func TestCaptureDiagnosticsPreservesValidUDPDelivery(t *testing.T) {
	c := &Capturer{}
	var delivered string
	c.OnPacket(func(payload []byte) { delivered = string(payload) })
	c.processPacket(buildUDPPacket(t, []byte("photon-fragment")))
	if got := c.DiagnosticsStats(); got != (DiagnosticsStats{}) || delivered != "photon-fragment" || c.BytesReceived() != 15 {
		t.Fatalf("diagnostics=%+v delivered=%q bytes=%d", got, delivered, c.BytesReceived())
	}
}

func TestCaptureDiagnosticsAggregatesWithoutKernelStats(t *testing.T) {
	first, second := &Capturer{}, &Capturer{}
	for _, c := range []*Capturer{first, second} {
		packet := gopacket.NewPacket([]byte{0}, layers.LinkTypeEthernet, gopacket.Default)
		packet.Metadata().CaptureInfo = gopacket.CaptureInfo{CaptureLength: 1, Length: 30}
		c.processPacket(packet)
	}
	m := NewManager(t.Context())
	m.active["one"] = &managedCapturer{cap: first}
	m.active["two"] = &managedCapturer{cap: second}
	if got := m.Stats(); got.TruncatedFrames != 2 || got.DecodeErrors != 2 || got.IPv4FragmentsSkipped != 0 {
		t.Fatalf("aggregate diagnostics=%+v", got)
	}
}
