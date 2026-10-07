package main

import (
	"encoding/binary"
	"errors"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/nospy/albion-openradar/internal/capture"
	"github.com/nospy/albion-openradar/internal/photon"
	"github.com/nospy/albion-openradar/internal/ui"
)

func TestResolvePersistedWithIPOverride(t *testing.T) {
	all := []capture.NetworkInterface{
		{Name: "n1", Description: "Wi-Fi", Address: "192.168.1.1"},
		{Name: "n2", Description: "Eth", Address: "192.168.1.2"},
	}
	got := resolvePersisted(capture.Config{}, all, "192.168.1.2")
	if len(got) != 1 || got[0].Name != "n2" {
		t.Errorf("override match: got %+v", got)
	}
	got = resolvePersisted(capture.Config{}, all, "10.0.0.99")
	if got != nil {
		t.Errorf("override miss should return nil, got %+v", got)
	}
}

func TestAppPacketInfoPreservesFlowIsolation(t *testing.T) {
	events := 0
	app := &App{photonParser: photon.NewPhotonParser(func(*photon.EventData) { events++ }, nil, nil)}
	handler, ok := any(app).(interface{ handlePacketInfo(capture.PacketInfo) })
	if !ok {
		t.Fatal("application capture path must preserve transport identity")
	}
	makeFragment := func(number uint32, offset uint32, data []byte) []byte {
		packet := make([]byte, 44+len(data))
		packet[3] = 1
		packet[12] = 8
		binary.BigEndian.PutUint32(packet[16:], uint32(32+len(data)))
		binary.BigEndian.PutUint32(packet[24:], 100)
		binary.BigEndian.PutUint32(packet[28:], 2)
		binary.BigEndian.PutUint32(packet[32:], number)
		binary.BigEndian.PutUint32(packet[36:], 7)
		binary.BigEndian.PutUint32(packet[40:], offset)
		copy(packet[44:], data)
		return packet
	}
	first := makeFragment(0, 0, []byte{0, 4, 3, 1})
	second := makeFragment(1, 4, []byte{252, 3, 3})
	info := capture.PacketInfo{Interface: "a", Source: "192.0.2.1:5056", Destination: "192.0.2.2:3000", Payload: first}
	handler.handlePacketInfo(info)
	info.Interface, info.Payload = "b", second
	handler.handlePacketInfo(info)
	if events != 0 {
		t.Fatalf("mixed packet flows emitted %d events", events)
	}
	info.Interface = "a"
	handler.handlePacketInfo(info)
	info.Interface, info.Payload = "b", first
	handler.handlePacketInfo(info)
	if events != 2 || app.packetsProcessed.Load() != 4 {
		t.Errorf("events=%d packets=%d, want 2 and 4", events, app.packetsProcessed.Load())
	}
}

func TestResolvePersistedFromConfig(t *testing.T) {
	all := []capture.NetworkInterface{
		{Name: "n1", Description: "Wi-Fi", Address: "192.168.1.1"},
		{Name: "n2", Description: "Eth", Address: "192.168.1.2"},
	}
	cfg := capture.Config{CaptureInterfaces: []capture.PersistedInterface{
		{Name: "n2"},
		{Name: "missing"},
	}}
	got := resolvePersisted(cfg, all, "")
	if len(got) != 1 || got[0].Name != "n2" {
		t.Errorf("got %+v, want one entry n2", got)
	}
}

func TestAutoPickDefaults(t *testing.T) {
	all := []capture.NetworkInterface{
		{Name: "lo", Description: "Software Loopback", Address: "127.0.0.1"},
		{Name: "vbox", Description: "VirtualBox Host-Only", Address: "192.168.56.1"},
		{Name: "wifi", Description: "Wi-Fi", Address: "192.168.1.42"},
		{Name: "eth", Description: "Realtek PCIe GbE Family Controller", Address: "10.0.0.10"},
		{Name: "publicEth", Description: "Some Ethernet", Address: "8.8.8.8"},
		{Name: "exitlag", Description: "ExitLag LightWeight Filter", Address: "192.168.99.1"},
	}
	got := autoPickDefaults(all)
	if len(got) != 3 {
		t.Fatalf("len=%d, want 3 (eth, wifi, exitlag)", len(got))
	}
	names := []string{got[0].Name, got[1].Name, got[2].Name}
	want := []string{"eth", "wifi", "exitlag"}
	for i, w := range want {
		if names[i] != w {
			t.Errorf("position %d: got %q, want %q (full: %v)", i, names[i], w, names)
		}
	}
}

func TestAutoPickDefaultsExcludesNonRFC1918(t *testing.T) {
	all := []capture.NetworkInterface{
		{Name: "publicEth", Description: "Some Ethernet", Address: "8.8.8.8"},
		{Name: "publicWifi", Description: "Wi-Fi", Address: "1.2.3.4"},
	}
	got := autoPickDefaults(all)
	if len(got) != 0 {
		t.Errorf("got %d, want 0 (no RFC1918)", len(got))
	}
}

func TestAutoPickDefaultsExcludesVirtualAndVPN(t *testing.T) {
	all := []capture.NetworkInterface{
		{Name: "tun0", Description: "WireGuard", Address: "10.8.0.5"},
		{Name: "vbox", Description: "VirtualBox Host-Only", Address: "192.168.56.1"},
	}
	got := autoPickDefaults(all)
	if len(got) != 0 {
		t.Errorf("got %d, want 0 (vpn+virtual excluded)", len(got))
	}
}

func TestRunInterfaceKeepsRunningWhenTheDashboardCannotStart(t *testing.T) {
	waited := false

	restart := runInterface(
		func() (tea.Model, error) { return nil, errors.New("error making raw: The parameter is incorrect.") },
		func() { waited = true },
	)

	if !waited {
		t.Error("a dashboard that cannot start must leave the radar running until a signal, capture and the web server are unaffected")
	}
	if restart {
		t.Error("a failed dashboard must not request a restart")
	}
}

func TestRunInterfaceDoesNotWaitWhenTheDashboardExitsNormally(t *testing.T) {
	waited := false

	restart := runInterface(
		func() (tea.Model, error) { return ui.Dashboard{}, nil },
		func() { waited = true },
	)

	if waited {
		t.Error("a clean dashboard exit means the user asked to quit, no extra wait")
	}
	if restart {
		t.Error("a dashboard that did not ask for a restart must report false")
	}
}

func TestMemoryStatsMB(t *testing.T) {
	heap, sys := memoryStatsMB()
	if heap <= 0 || sys <= 0 || sys < heap {
		t.Errorf("heap=%.2f sys=%.2f, want 0 < heap <= sys", heap, sys)
	}
}
