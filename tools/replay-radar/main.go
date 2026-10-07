// replay-radar serves the real radar UI from anonymized PCAP fixtures. It never
// opens a live capture interface or sends any packets to the game.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcapgo"
	assets "github.com/nospy/albion-openradar"
	"github.com/nospy/albion-openradar/internal/logger"
	"github.com/nospy/albion-openradar/internal/photon"
	"github.com/nospy/albion-openradar/internal/server"
)

type capturedPacket struct {
	flow    string
	payload []byte
	delay   time.Duration
}

func readCapture(path string) ([]capturedPacket, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r, err := pcapgo.NewReader(f)
	if err != nil {
		return nil, err
	}
	var result []capturedPacket
	var previous time.Time
	var bytes int
	for {
		data, info, err := r.ReadPacketData()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read PCAP: %w", err)
		}
		bytes += len(data)
		if bytes > 64<<20 || len(result) >= 100000 {
			return nil, errors.New("replay exceeds 64 MiB or 100000 packets; split the capture first")
		}
		p := gopacket.NewPacket(data, r.LinkType(), gopacket.Default)
		udp, ok := p.Layer(layers.LayerTypeUDP).(*layers.UDP)
		if !ok || len(udp.Payload) == 0 || p.NetworkLayer() == nil {
			continue
		}
		if udp.SrcPort != 5056 && udp.DstPort != 5056 {
			continue
		}
		flow := p.NetworkLayer().NetworkFlow().String() + "/" + udp.TransportFlow().String()
		delay := time.Duration(0)
		if !previous.IsZero() && info.Timestamp.After(previous) {
			delay = info.Timestamp.Sub(previous)
		}
		previous = info.Timestamp
		result = append(result, capturedPacket{flow, append([]byte(nil), udp.Payload...), delay})
	}
	if len(result) == 0 {
		return nil, errors.New("capture contains no UDP 5056 payloads")
	}
	return result, nil
}

func main() {
	input := flag.String("in", "internal/photon/testdata/harvestables/single-spawn.pcap", "anonymized PCAP fixture")
	port := flag.Int("port", 5002, "localhost HTTP port (1-65535)")
	speed := flag.Float64("speed", 10, "replay speed multiplier; long pauses are capped at one second")
	duration := flag.Duration("duration", 2*time.Minute, "maximum lifetime of the offline server")
	qaMap := flag.Bool("qa-map-before-client", false, "QA only: seed a synthetic Join for zone1000 before any browser connects (no coordinates)")
	flag.Parse()
	if *port < 1 || *port > 65535 || *speed <= 0 || math.IsNaN(*speed) || math.IsInf(*speed, 0) || *duration <= 0 {
		fmt.Fprintln(os.Stderr, "invalid port, speed or duration")
		os.Exit(2)
	}
	if err := run(*input, *port, *speed, *duration, *qaMap); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(input string, port int, speed float64, duration time.Duration, qaMap bool) error {
	packets, err := readCapture(input)
	if err != nil {
		return err
	}
	dataDir, err := os.MkdirTemp("", "OpenRadar-offline-replay-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dataDir)
	log := logger.New(dataDir, false)
	defer log.Stop()
	ws := server.NewWebSocketHandler(log)
	if qaMap {
		// Explicitly synthetic test metadata, separate from the real PCAP.
		// No player coordinates or entities are introduced by this seed.
		ws.BroadcastResponse(&photon.OperationResponse{ReturnCode: 0,
			Parameters: map[byte]any{253: int16(2), 8: "1000"}})
	}
	s, err := server.NewHTTPServer(port, assets.Images, assets.Scripts, assets.Data,
		assets.Sounds, assets.Styles, assets.Templates, ws, log, "QA-REPLAY", "offline", nil, nil, dataDir, nil, dataDir, false)
	if err != nil {
		ws.CloseAllClients()
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, duration)
	defer cancel()
	serverDone := make(chan error, 1)
	go func() { serverDone <- s.Start() }()
	defer func() {
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = s.Shutdown(shutdown)
	}()
	fmt.Printf("OFFLINE_REPLAY http://127.0.0.1:%d packets=%d (no live capture)\n", port, len(packets))
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for ws.RadarClientCount() == 0 {
		select {
		case <-ctx.Done():
			return nil
		case err := <-serverDone:
			return err
		case <-ticker.C:
		}
	}
	parser := photon.NewPhotonParser(func(ev *photon.EventData) { photon.PostProcessEvent(ev); ws.BroadcastEvent(ev) },
		func(req *photon.OperationRequest) { photon.PostProcessRequest(req); ws.BroadcastRequest(req) },
		func(resp *photon.OperationResponse) { photon.PostProcessResponse(resp); ws.BroadcastResponse(resp) })
	for _, packet := range packets {
		delay := time.Duration(float64(packet.delay) / speed)
		if delay > time.Second {
			delay = time.Second
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
		parser.ReceivePacketFlow(packet.flow, packet.payload)
	}
	fmt.Println("OFFLINE_REPLAY complete; UI remains available until duration expires")
	select {
	case <-ctx.Done():
		return nil
	case err := <-serverDone:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
