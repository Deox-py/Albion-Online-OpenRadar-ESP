package capture

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"regexp"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcap"
	"github.com/google/gopacket/pcapgo"

	"github.com/nospy/albion-openradar/internal/logger"
)

var reUnsafeFilename = regexp.MustCompile(`[^A-Za-z0-9_\-]`)

const (
	AlbionPort          = 5056
	SnapLen             = 65536
	Promiscuous         = false
	ReadTimeout         = 100 * time.Millisecond
	recordQueueCapacity = 256
)

type NetworkInterface struct {
	Name        string
	Description string
	Address     string
	Device      string
}

type PacketHandler func(payload []byte)

// PacketInfo preserves the directional transport identity needed for Photon reassembly.
// Payload is valid for the synchronous callback; retain a copy for asynchronous use.
type PacketInfo struct {
	Payload     []byte
	Interface   string
	Source      string
	Destination string
	Timestamp   time.Time
}

func (p PacketInfo) FlowKey() string {
	return strconv.Quote(p.Interface) + "|" + p.Source + ">" + p.Destination
}

type PacketInfoHandler func(PacketInfo)

type recordedPacket struct {
	info gopacket.CaptureInfo
	data []byte
}

type RecordingStats struct{ QueueDrops, WriteErrors uint64 }

// DiagnosticsStats counts capture-layer problems, independently of Photon
// decoding/reassembly. Counts can overlap (a truncated frame can fail decoding).
type DiagnosticsStats struct {
	TruncatedFrames      uint64 `json:"truncatedFrames"`
	DecodeErrors         uint64 `json:"decodeErrors"`
	IPv4FragmentsSkipped uint64 `json:"ipv4FragmentsSkipped"`
}

type Capturer struct {
	handle       *pcap.Handle
	iface        NetworkInterface
	onPacket     PacketHandler
	onPacketInfo PacketInfoHandler
	handlerMu    sync.RWMutex
	ctx          context.Context
	cancel       context.CancelFunc
	closeOnce    sync.Once
	lifecycleMu  sync.Mutex
	runDone      chan struct{}
	started      bool
	closed       bool
	handleMu     sync.Mutex

	bytesReceived        atomic.Uint64
	truncatedFrames      atomic.Uint64
	decodeErrors         atomic.Uint64
	ipv4FragmentsSkipped atomic.Uint64

	recordMu          sync.Mutex
	recordControlMu   sync.Mutex
	recordFile        *os.File
	recordWriter      *pcapgo.Writer
	recordWriteErrors atomic.Uint64
	recordQueueDrops  atomic.Uint64
	recordQueue       chan recordedPacket
	recordDone        chan struct{}
	recordErr         error
}

// captureFactory is overridable in tests; restore via t.Cleanup.
var captureFactory = openLiveCapture

// findAllDevs is overridable in tests; restore via t.Cleanup.
var findAllDevs = pcap.FindAllDevs

func openLiveCapture(ctx context.Context, iface NetworkInterface) (*Capturer, error) {
	handle, err := pcap.OpenLive(iface.Device, SnapLen, Promiscuous, ReadTimeout)
	if err != nil {
		return nil, fmt.Errorf("open device %q: %w", iface.Device, err)
	}
	filter := fmt.Sprintf("udp and (dst port %d or src port %d)", AlbionPort, AlbionPort)
	if err := handle.SetBPFFilter(filter); err != nil {
		handle.Close()
		return nil, fmt.Errorf("set BPF filter on %q: %w", iface.Device, err)
	}
	//nolint:gosec // G118: cancel is stored on Capturer and invoked by Close().
	cctx, cancel := context.WithCancel(ctx)
	return &Capturer{
		handle: handle,
		iface:  iface,
		ctx:    cctx,
		cancel: cancel,
	}, nil
}

func (c *Capturer) OnPacket(h PacketHandler) {
	c.handlerMu.Lock()
	c.onPacket = h
	c.handlerMu.Unlock()
}

// OnPacketInfo selects the metadata callback when non-nil; OnPacket remains
// available for payload-only callers and is not called a second time.
func (c *Capturer) OnPacketInfo(h PacketInfoHandler) {
	c.handlerMu.Lock()
	c.onPacketInfo = h
	c.handlerMu.Unlock()
}

func (c *Capturer) Start() error {
	c.lifecycleMu.Lock()
	if c.closed || c.started {
		c.lifecycleMu.Unlock()
		return errors.New("capture already started or closed")
	}
	c.started = true
	c.runDone = make(chan struct{})
	done := c.runDone
	c.lifecycleMu.Unlock()
	defer close(done)
	if c.handle == nil {
		// stub-mode for tests: block until cancellation, no real pcap source.
		<-c.ctx.Done()
		return c.ctx.Err()
	}
	// Read directly: PacketSource.Packets starts an untracked reader goroutine
	// that can outlive cancellation and race handle closure.
	linkType := c.handle.LinkType()
	for {
		if c.ctx.Err() != nil {
			return c.ctx.Err()
		}
		data, info, err := c.handle.ReadPacketData()
		if errors.Is(err, pcap.NextErrorTimeoutExpired) {
			continue
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read capture %q: %w", c.iface.Name, err)
		}
		if c.ctx.Err() != nil {
			return c.ctx.Err()
		}
		packet := gopacket.NewPacket(data, linkType, gopacket.Default)
		packet.Metadata().CaptureInfo = info
		c.processPacket(packet)
	}
}

// Close cancels and joins the direct reader before closing its native handle.
// Manager may defer this join past its shutdown deadline, but never closes an active reader.
func (c *Capturer) Close() {
	c.closeOnce.Do(func() {
		c.lifecycleMu.Lock()
		c.closed = true
		done := c.runDone
		if c.cancel != nil {
			c.cancel()
		}
		c.lifecycleMu.Unlock()
		if done != nil {
			<-done
		}
		c.StopRecording() //nolint:errcheck // file close error is non-actionable during shutdown
		c.handleMu.Lock()
		defer c.handleMu.Unlock()
		if c.handle != nil {
			c.handle.Close()
		}
	})
}

func (c *Capturer) Iface() NetworkInterface { return c.iface }

func (c *Capturer) BytesReceived() uint64 { return c.bytesReceived.Load() }

func (c *Capturer) DiagnosticsStats() DiagnosticsStats {
	return DiagnosticsStats{
		TruncatedFrames:      c.truncatedFrames.Load(),
		DecodeErrors:         c.decodeErrors.Load(),
		IPv4FragmentsSkipped: c.ipv4FragmentsSkipped.Load(),
	}
}

func (c *Capturer) Stats() (*pcap.Stats, error) {
	c.handleMu.Lock()
	defer c.handleMu.Unlock()
	c.lifecycleMu.Lock()
	closed := c.closed
	c.lifecycleMu.Unlock()
	if closed {
		return nil, nil
	}
	if c.handle == nil {
		return nil, nil
	}
	return c.handle.Stats()
}

// sanitizeIfaceName replaces characters not in [A-Za-z0-9_-] with underscores.
// Returns "unknown" if the result is empty.
func sanitizeIfaceName(name string) string {
	s := reUnsafeFilename.ReplaceAllString(name, "_")
	if s == "" {
		return "unknown"
	}
	return s
}

// StartRecording begins a new capture_<TS>_<unique>_<iface>.pcap in dir.
// A bounded queue decouples packet delivery from disk latency.
// Returns an error if already recording or if the file cannot be created.
func (c *Capturer) StartRecording(dir string) error {
	c.recordControlMu.Lock()
	defer c.recordControlMu.Unlock()
	c.lifecycleMu.Lock()
	closed := c.closed
	c.lifecycleMu.Unlock()
	if closed {
		return errors.New("capture closed")
	}
	c.recordMu.Lock()
	defer c.recordMu.Unlock()

	if c.recordWriter != nil {
		return errors.New("recording already in progress")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create recording dir: %w", err)
	}

	ts := time.Now().Format("2006-01-02T15-04-05.000000000")
	iface := sanitizeIfaceName(c.iface.Name)
	// A random exclusive suffix also handles platforms with a coarse system clock.
	f, err := os.CreateTemp(dir, fmt.Sprintf("capture_%s_*_%s.pcap", ts, iface))
	if err != nil {
		return fmt.Errorf("create recording file: %w", err)
	}

	w := pcapgo.NewWriter(f)
	var linkType layers.LinkType
	if c.handle != nil {
		linkType = c.handle.LinkType()
	} else {
		linkType = layers.LinkTypeEthernet
	}
	if err := w.WriteFileHeader(SnapLen, linkType); err != nil {
		f.Close()
		return fmt.Errorf("write pcap header: %w", err)
	}

	c.recordFile = f
	c.recordWriter = w
	c.recordErr = nil
	c.recordQueue = make(chan recordedPacket, recordQueueCapacity)
	c.recordDone = make(chan struct{})
	go c.writeRecording(c.recordQueue, c.recordDone)
	return nil
}

// StopRecording flushes and closes the current recording. Returns nil if not recording.
func (c *Capturer) StopRecording() error {
	c.recordControlMu.Lock()
	defer c.recordControlMu.Unlock()
	c.recordMu.Lock()

	if c.recordWriter == nil {
		c.recordMu.Unlock()
		return nil
	}
	close(c.recordQueue)
	c.recordQueue = nil
	done := c.recordDone
	c.recordMu.Unlock()
	<-done // Drain accepted packets before closing the file.
	c.recordMu.Lock()
	defer c.recordMu.Unlock()
	err := errors.Join(c.recordErr, c.recordFile.Close())
	c.recordFile = nil
	c.recordWriter = nil
	c.recordDone = nil
	return err
}

// IsRecording reports whether a recording is currently active.
func (c *Capturer) IsRecording() bool {
	c.recordMu.Lock()
	defer c.recordMu.Unlock()
	return c.recordQueue != nil
}

func (c *Capturer) RecordingStats() RecordingStats {
	return RecordingStats{QueueDrops: c.recordQueueDrops.Load(), WriteErrors: c.recordWriteErrors.Load()}
}

func (c *Capturer) writeRecording(queue <-chan recordedPacket, done chan<- struct{}) {
	defer close(done)
	for packet := range queue {
		c.recordMu.Lock()
		writer := c.recordWriter
		c.recordMu.Unlock()
		if err := writer.WritePacket(packet.info, packet.data); err != nil {
			c.recordMu.Lock()
			if c.recordErr == nil {
				c.recordErr = err
			}
			c.recordMu.Unlock()
			n := c.recordWriteErrors.Add(1)
			if n%100 == 1 {
				logger.PrintWarn("PKT", "pcap recorder write error: %v", err)
			}
		}
	}
}

func (c *Capturer) processPacket(p gopacket.Packet) {
	c.recordMu.Lock()
	if c.recordQueue != nil {
		select {
		case c.recordQueue <- recordedPacket{info: p.Metadata().CaptureInfo, data: append([]byte(nil), p.Data()...)}:
		default:
			n := c.recordQueueDrops.Add(1)
			if n%100 == 1 {
				logger.PrintWarn("PKT", "pcap recorder queue full on %s: %d packets dropped", c.iface.Name, n)
			}
		}
	}
	c.recordMu.Unlock()

	// Record the frame first so an explicitly requested pcap retains diagnostic
	// evidence. Never deliver a partial UDP datagram to the Photon decoder.
	metadata := p.Metadata()
	truncated := metadata.Truncated || metadata.CaptureLength < metadata.Length
	decodeFailed := p.ErrorLayer() != nil
	fragmented := false
	if ip, ok := p.Layer(layers.LayerTypeIPv4).(*layers.IPv4); ok {
		fragmented = ip.Flags&layers.IPv4MoreFragments != 0 || ip.FragOffset != 0
	}
	if truncated {
		c.truncatedFrames.Add(1)
	}
	if decodeFailed {
		c.decodeErrors.Add(1)
	}
	if fragmented {
		c.ipv4FragmentsSkipped.Add(1)
	}
	if truncated || decodeFailed || fragmented {
		return
	}

	udpLayer := p.Layer(layers.LayerTypeUDP)
	if udpLayer == nil {
		return
	}
	udp, ok := udpLayer.(*layers.UDP)
	if !ok || len(udp.Payload) == 0 {
		return
	}
	c.handlerMu.RLock()
	handler, infoHandler := c.onPacket, c.onPacketInfo
	c.handlerMu.RUnlock()
	if handler == nil && infoHandler == nil {
		return
	}
	c.bytesReceived.Add(uint64(len(udp.Payload)))
	if infoHandler != nil {
		info := PacketInfo{Payload: udp.Payload, Interface: c.iface.Name, Timestamp: p.Metadata().Timestamp}
		if network := p.NetworkLayer(); network != nil {
			flow := network.NetworkFlow()
			info.Source = net.JoinHostPort(flow.Src().String(), strconv.Itoa(int(udp.SrcPort)))
			info.Destination = net.JoinHostPort(flow.Dst().String(), strconv.Itoa(int(udp.DstPort)))
		}
		infoHandler(info)
	} else {
		handler(udp.Payload)
	}
}

func EnumerateInterfaces() ([]NetworkInterface, error) {
	devs, err := findAllDevs()
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}
	var out []NetworkInterface
	for _, d := range devs {
		for _, addr := range d.Addresses {
			ip4 := addr.IP.To4()
			if ip4 == nil {
				continue
			}
			out = append(out, NetworkInterface{
				Name:        d.Name,
				Description: d.Description,
				Address:     ip4.String(),
				Device:      d.Name,
			})
			break
		}
	}
	return out, nil
}

func ResolveByIP(ip string) (PersistedInterface, error) {
	ifaces, err := EnumerateInterfaces()
	if err != nil {
		return PersistedInterface{}, err
	}
	for _, i := range ifaces {
		if i.Address == ip {
			return PersistedInterface{Name: i.Name, Description: i.Description}, nil
		}
	}
	return PersistedInterface{}, fmt.Errorf("no interface with IP %s", ip)
}
