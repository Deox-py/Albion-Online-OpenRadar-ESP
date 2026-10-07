package capture

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/nospy/albion-openradar/internal/logger"
)

type Status string

const (
	StatusRunning  Status = "running"
	StatusAwaiting Status = "awaiting_interfaces"
)

// AggregateStats summarizes libpcap kernel counters across every active capture
// handle. These counters are diagnostic only; capture continues if a handle does
// not expose stats on the current platform.
type AggregateStats struct {
	PacketsReceived      uint64
	PacketsDropped       uint64
	PacketsIfDropped     uint64
	ReadErrors           uint64
	RecordingQueueDrops  uint64
	RecordingWriteErrors uint64
	TruncatedFrames      uint64
	DecodeErrors         uint64
	IPv4FragmentsSkipped uint64
}

type CaptureSummary struct {
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Address     string    `json:"address"`
	Category    Category  `json:"category"`
	StartedAt   time.Time `json:"startedAt"`
}

type State struct {
	Status     Status
	Active     []CaptureSummary
	LastErrors map[string]string
}

var managerStartWorker = startWorker

type Manager struct {
	parentCtx context.Context

	mu               sync.Mutex
	reconfigureMu    sync.Mutex
	active           map[string]*managedCapturer
	wg               sync.WaitGroup
	onPacket         PacketHandler
	onPacketInfo     PacketInfoHandler
	onCaptureChange  func()
	lastErrors       map[string]string
	closed           bool
	recordingEnabled bool
	recordingDir     string
	closeDone        chan struct{}
}

type managedCapturer struct {
	cap       *Capturer
	startedAt time.Time
	cancel    context.CancelFunc
}

func NewManager(parentCtx context.Context) *Manager {
	return &Manager{
		parentCtx:  parentCtx,
		active:     make(map[string]*managedCapturer),
		lastErrors: make(map[string]string),
	}
}

func (m *Manager) OnPacket(h PacketHandler) {
	m.mu.Lock()
	m.onPacket = h
	for _, mc := range m.active {
		mc.cap.OnPacket(h)
	}
	m.mu.Unlock()
}

func (m *Manager) OnPacketInfo(h PacketInfoHandler) {
	m.mu.Lock()
	m.onPacketInfo = h
	for _, mc := range m.active {
		mc.cap.OnPacketInfo(h)
	}
	m.mu.Unlock()
}

// OnCaptureChange runs after every previous reader has stopped and before any
// replacement reader starts. Unchanged discovery does not invalidate state.
// The callback may inspect State, but must not call Reconfigure or Close.
func (m *Manager) OnCaptureChange(h func()) {
	m.mu.Lock()
	m.onCaptureChange = h
	m.mu.Unlock()
}

func (m *Manager) Reconfigure(target []NetworkInterface) error {
	m.reconfigureMu.Lock()
	defer m.reconfigureMu.Unlock()
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return errors.New("manager closed")
	}
	if m.onPacket == nil && m.onPacketInfo == nil {
		m.mu.Unlock()
		return errors.New("OnPacket must be called before Reconfigure")
	}

	desired := make(map[string]NetworkInterface, len(target))
	for _, i := range target {
		desired[i.Name] = i
	}
	unchanged := len(desired) == len(m.active)
	for name, iface := range desired {
		mc := m.active[name]
		if mc == nil || mc.cap.iface.Device != iface.Device {
			unchanged = false
		}
	}
	if unchanged {
		m.mu.Unlock()
		return nil
	}

	var openErrs []string
	retainedReopenFailed := false
	prepared := make(map[string]*Capturer, len(desired))
	for name, iface := range desired {
		c, err := captureFactory(m.parentCtx, iface)
		if err != nil {
			if old := m.active[name]; old != nil && old.cap.iface.Device == iface.Device {
				retainedReopenFailed = true
			}
			m.lastErrors[name] = err.Error()
			openErrs = append(openErrs, fmt.Sprintf("%s: %v", name, err))
			continue
		}
		prepared[name] = c
	}
	// If only an extra interface failed to open, preserve the working readers
	// and their retained metadata. Prepared handles have not started delivery.
	unchanged = len(prepared) == len(m.active)
	for name, c := range prepared {
		mc := m.active[name]
		if mc == nil || mc.cap.iface.Device != c.iface.Device {
			unchanged = false
		}
	}
	if unchanged || retainedReopenFailed {
		m.mu.Unlock()
		for _, c := range prepared {
			c.Close()
		}
		if len(openErrs) > 0 {
			return fmt.Errorf("partial open failures: %v", openErrs)
		}
		return nil
	}

	removed := make([]*Capturer, 0, len(m.active))
	for name, mc := range m.active {
		mc.cancel()
		removed = append(removed, mc.cap)
		if _, keep := desired[name]; !keep {
			delete(m.lastErrors, name)
		}
	}
	m.active = make(map[string]*managedCapturer, len(prepared))
	onChange := m.onCaptureChange
	m.mu.Unlock()
	// Joining all old readers also covers interfaces retained in the selection:
	// none can repopulate metadata while the source boundary is invalidated.
	for _, c := range removed {
		c.Close()
	}
	if onChange != nil {
		onChange()
	}

	m.mu.Lock()
	for name, c := range prepared {
		c.OnPacket(m.onPacket)
		c.OnPacketInfo(m.onPacketInfo)
		mc := &managedCapturer{cap: c, startedAt: time.Now(), cancel: c.cancel}
		m.active[name] = mc
		delete(m.lastErrors, name)
		if m.recordingEnabled {
			if rErr := c.StartRecording(m.recordingDir); rErr != nil {
				m.lastErrors[name] = rErr.Error()
			}
		}
		managerStartWorker(c, &m.wg, func(n string, e error) {
			m.mu.Lock()
			// A late error from a removed reader must not remove its replacement.
			if m.active[n] == mc {
				m.lastErrors[n] = e.Error()
				delete(m.active, n)
			}
			m.mu.Unlock()
		})
	}

	m.mu.Unlock()

	if len(openErrs) > 0 {
		return fmt.Errorf("partial open failures: %v", openErrs)
	}
	return nil
}

// StartRecording enables recording on all active capturers and on any future
// ones added via Reconfigure. If a capturer fails to start, the error is
// logged as a warning and the others continue.
func (m *Manager) StartRecording(dir string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.recordingEnabled = true
	m.recordingDir = dir
	var firstErr error
	for name, mc := range m.active {
		if err := mc.cap.StartRecording(dir); err != nil {
			logger.PrintWarn("PKT", "pcap recording could not start on %s: %v", name, err)
			if firstErr == nil {
				firstErr = fmt.Errorf("%s: %w", name, err)
			}
		}
	}
	return firstErr
}

// StopRecording disables recording on all active capturers.
func (m *Manager) StopRecording() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.recordingEnabled = false
	m.recordingDir = ""
	var firstErr error
	for name, mc := range m.active {
		if err := mc.cap.StopRecording(); err != nil {
			logger.PrintWarn("PKT", "pcap recording could not stop on %s: %v", name, err)
			if firstErr == nil {
				firstErr = fmt.Errorf("%s: %w", name, err)
			}
		}
	}
	return firstErr
}

// IsRecording reports whether the Manager has recording enabled.
func (m *Manager) IsRecording() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.recordingEnabled
}

// BytesReceived sums per-handle bytes across active capturers.
// pcap.Stats is not aggregated here; per-handle kernel stats are out of scope.
func (m *Manager) BytesReceived() uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	var sum uint64
	for _, mc := range m.active {
		sum += mc.cap.BytesReceived()
	}
	return sum
}

// Stats aggregates pcap.Stats across all active interfaces. Keeping the manager
// lock while sampling prevents a handle from being closed by Reconfigure at the
// same time pcap.Stats is reading it.
func (m *Manager) Stats() AggregateStats {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out AggregateStats
	for _, mc := range m.active {
		recording := mc.cap.RecordingStats()
		out.RecordingQueueDrops += recording.QueueDrops
		out.RecordingWriteErrors += recording.WriteErrors
		diagnostics := mc.cap.DiagnosticsStats()
		out.TruncatedFrames += diagnostics.TruncatedFrames
		out.DecodeErrors += diagnostics.DecodeErrors
		out.IPv4FragmentsSkipped += diagnostics.IPv4FragmentsSkipped
		st, err := mc.cap.Stats()
		if err != nil {
			out.ReadErrors++
			continue
		}
		if st == nil {
			continue
		}
		if st.PacketsReceived > 0 {
			out.PacketsReceived += uint64(st.PacketsReceived)
		}
		if st.PacketsDropped > 0 {
			out.PacketsDropped += uint64(st.PacketsDropped)
		}
		if st.PacketsIfDropped > 0 {
			out.PacketsIfDropped += uint64(st.PacketsIfDropped)
		}
	}
	return out
}

func (m *Manager) State() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := State{
		LastErrors: make(map[string]string, len(m.lastErrors)),
	}
	maps.Copy(out.LastErrors, m.lastErrors)
	for _, mc := range m.active {
		i := mc.cap.iface
		out.Active = append(out.Active, CaptureSummary{
			Name:        i.Name,
			Description: i.Description,
			Address:     i.Address,
			Category:    Categorize(i.Name, i.Description),
			StartedAt:   mc.startedAt,
		})
	}
	slices.SortFunc(out.Active, func(a, b CaptureSummary) int { return strings.Compare(a.Name, b.Name) })
	if len(out.Active) == 0 {
		out.Status = StatusAwaiting
	} else {
		out.Status = StatusRunning
	}
	return out
}

// Close cancels all read loops, waits for workers, then closes handles.
// libpcap is unsafe to close while a Read poll is in flight, so handles
// are closed only after wg.Wait, including when closeCtx expires first.
func (m *Manager) Close(closeCtx context.Context) {
	m.reconfigureMu.Lock()
	m.mu.Lock()
	if m.closed {
		done := m.closeDone
		m.mu.Unlock()
		m.reconfigureMu.Unlock()
		select {
		case <-done:
		case <-closeCtx.Done():
		}
		return
	}
	m.closed = true
	for _, mc := range m.active {
		mc.cancel()
	}
	captures := make([]*Capturer, 0, len(m.active))
	for _, mc := range m.active {
		captures = append(captures, mc.cap)
	}
	m.active = nil
	m.closeDone = make(chan struct{})
	done := m.closeDone
	m.mu.Unlock()
	m.reconfigureMu.Unlock()

	go func() {
		m.wg.Wait()
		for _, c := range captures {
			c.Close()
		}
		close(done)
	}()
	select {
	case <-done:
	case <-closeCtx.Done():
	}
}

func startWorker(c *Capturer, wg *sync.WaitGroup, onError func(string, error)) {
	wg.Go(func() {
		defer c.Close()
		err := c.Start()
		if c.ctx.Err() != nil {
			return
		}
		if err == nil {
			err = errors.New("capture source stopped unexpectedly; reselect the interface to restart")
		}
		onError(c.iface.Name, err)
	})
}
