package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/nospy/albion-openradar/internal/photon"
)

func TestReadCapturePreservesRealHarvestableEvents(t *testing.T) {
	packets, err := readCapture("../../internal/photon/testdata/harvestables/single-spawn.pcap")
	if err != nil {
		t.Fatal(err)
	}
	if len(packets) == 0 {
		t.Fatal("fixture has no UDP packets")
	}
	spawns := 0
	anchorFound := false
	p := photon.NewPhotonParser(func(ev *photon.EventData) {
		photon.PostProcessEvent(ev)
		if ev.Parameters[252] == int16(40) || ev.Parameters[252] == byte(40) {
			spawns++
			if fmt.Sprint(ev.Parameters[0]) == "2246" {
				anchorFound = fmt.Sprint(ev.Parameters[8]) == "[-307.5 59.5]" && fmt.Sprint(ev.Parameters[7]) == "5"
			}
		}
	}, nil, nil)
	for _, packet := range packets {
		p.ReceivePacketFlow(packet.flow, packet.payload)
	}
	if spawns == 0 {
		t.Fatal("real PCAP did not reach the resource parser")
	}
	if !anchorFound {
		t.Fatal("real PCAP resource 2246 coordinates/tier did not survive flow-aware decoding")
	}
	if packets[0].flow == "" {
		t.Fatal("connection identity was discarded")
	}
}

func TestReadCaptureRejectsInvalidPCAP(t *testing.T) {
	path := filepath.Join(t.TempDir(), "invalid.pcap")
	if err := os.WriteFile(path, []byte("invalid"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readCapture(path); err == nil {
		t.Fatal("malformed PCAP accepted")
	}
}
