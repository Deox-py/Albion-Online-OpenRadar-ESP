package capture

import (
	"context"
	"errors"
	"io"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcapgo"
)

func TestCapturerCloseWaitsForInFlightPacket(t *testing.T) {
	c := newCapturerFromOffline(t, photonFixture)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	c.OnPacket(func([]byte) { once.Do(func() { close(entered); <-release }) })
	runDone := make(chan struct{})
	go func() { _ = c.Start(); close(runDone) }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("fixture callback did not start")
	}
	closed := make(chan struct{})
	go func() { c.Close(); close(closed) }()
	premature := false
	select {
	case <-closed:
		premature = true
	case <-time.After(30 * time.Millisecond):
	}
	close(release)
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("Close did not finish after callback returned")
	}
	<-runDone
	if premature {
		t.Error("Close returned while the capture reader was still delivering a packet")
	}
}

func TestManagerTimeoutDefersRecorderCloseUntilReaderStops(t *testing.T) {
	previous := captureFactory
	var c *Capturer
	captureFactory = func(ctx context.Context, iface NetworkInterface) (*Capturer, error) {
		c = newCapturerFromOffline(t, photonFixture)
		c.iface = iface
		return c, nil
	}
	t.Cleanup(func() { captureFactory = previous })
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	m := NewManager(t.Context())
	m.OnPacket(func([]byte) { once.Do(func() { close(entered); <-release }) })
	if err := m.Reconfigure([]NetworkInterface{{Name: "offline"}}); err != nil {
		t.Fatal(err)
	}
	if err := m.StartRecording(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("fixture callback did not start")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Millisecond)
	defer cancel()
	m.Close(ctx)
	stillRecording := c.IsRecording()
	close(release)
	m.wg.Wait()
	c.Close()
	if !stillRecording {
		t.Error("shutdown deadline closed the recorder before capture reader stopped")
	}
}

func TestCapturerPassesDirectionalFlowMetadata(t *testing.T) {
	c := newStubCapturer(t.Context(), NetworkInterface{Name: "adapter-a"})
	defer c.Close()
	method := reflect.ValueOf(c).MethodByName("OnPacketInfo")
	if !method.IsValid() {
		t.Fatal("capture must expose flow metadata alongside payload")
	}
	var got reflect.Value
	callback := reflect.MakeFunc(method.Type().In(0), func(args []reflect.Value) []reflect.Value { got = args[0]; return nil })
	method.Call([]reflect.Value{callback})
	c.processPacket(buildUDPPacket(t, []byte("photon")))
	if !got.IsValid() {
		t.Fatal("flow callback was not called")
	}
	for field, want := range map[string]string{"Interface": "adapter-a", "Source": "127.0.0.1:5056", "Destination": "127.0.0.1:5056"} {
		value := got.FieldByName(field)
		if !value.IsValid() || value.String() != want {
			t.Errorf("%s = %v, want %s", field, value, want)
		}
	}
	if payload := got.FieldByName("Payload").Bytes(); string(payload) != "photon" {
		t.Errorf("payload=%q", payload)
	}
}

type pausedRecordSink struct {
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (w *pausedRecordSink) Write(data []byte) (int, error) {
	w.once.Do(func() { close(w.entered); <-w.release })
	return len(data), nil
}

func TestRecorderDoesNotDelayPacketDelivery(t *testing.T) {
	c := newStubCapturer(t.Context(), NetworkInterface{Name: "slow-disk"})
	defer c.Close()
	if err := c.StartRecording(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	sink := &pausedRecordSink{entered: make(chan struct{}), release: make(chan struct{})}
	c.recordMu.Lock()
	c.recordWriter = pcapgo.NewWriter(sink)
	c.recordMu.Unlock()
	delivered := make(chan struct{}, 1)
	c.OnPacket(func([]byte) { delivered <- struct{}{} })
	packetDone := make(chan struct{})
	packet := buildUDPPacket(t, []byte("still-live"))
	go func() { c.processPacket(packet); close(packetDone) }()
	select {
	case <-sink.entered:
	case <-time.After(time.Second):
		t.Fatal("recorder did not start writing")
	}
	blocked := false
	select {
	case <-delivered:
	case <-time.After(30 * time.Millisecond):
		blocked = true
	}
	close(sink.release)
	<-packetDone
	if err := c.StopRecording(); err != nil {
		t.Fatal(err)
	}
	if blocked {
		t.Error("a stalled pcap disk writer delayed the live packet handler")
	}
}

func TestRecordingRestartWithinSameSecondPreservesBothFiles(t *testing.T) {
	c := newStubCapturer(t.Context(), NetworkInterface{Name: "quick-toggle"})
	defer c.Close()
	dir := t.TempDir()
	for _, payload := range []string{"first", "second"} {
		if err := c.StartRecording(dir); err != nil {
			t.Fatal(err)
		}
		c.processPacket(buildUDPPacket(t, []byte(payload)))
		if err := c.StopRecording(); err != nil {
			t.Fatal(err)
		}
	}
	files, err := filepathGlob(t, dir, "capture_*.pcap")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 {
		t.Fatalf("quick recording restart overwrote capture: files=%v", files)
	}
}

func TestRecorderBoundsQueueWhileDeliveryContinues(t *testing.T) {
	c := newStubCapturer(t.Context(), NetworkInterface{Name: "queue-bound"})
	defer c.Close()
	if err := c.StartRecording(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	sink := &pausedRecordSink{entered: make(chan struct{}), release: make(chan struct{})}
	c.recordMu.Lock()
	c.recordWriter = pcapgo.NewWriter(sink)
	c.recordMu.Unlock()
	delivered := 0
	c.OnPacket(func([]byte) { delivered++ })
	c.processPacket(buildUDPPacket(t, []byte("first")))
	<-sink.entered
	for range 512 {
		c.processPacket(buildUDPPacket(t, []byte("live")))
	}
	stats := c.RecordingStats()
	close(sink.release)
	if err := c.StopRecording(); err != nil {
		t.Fatal(err)
	}
	if delivered != 513 {
		t.Errorf("delivered=%d, want 513 despite recording pressure", delivered)
	}
	if stats.QueueDrops != 256 {
		t.Errorf("recording overflow drops=%d, want 256", stats.QueueDrops)
	}
}

func TestRecorderReportsWriteFailuresAtStop(t *testing.T) {
	c := newStubCapturer(t.Context(), NetworkInterface{Name: "write-error"})
	defer c.Close()
	if err := c.StartRecording(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := c.recordFile.Close(); err != nil {
		t.Fatal(err)
	}
	c.processPacket(buildUDPPacket(t, []byte("cannot-write")))
	if err := c.StopRecording(); err == nil {
		t.Error("a failed recording write must be reported when stopping")
	}
	if stats := c.RecordingStats(); stats.WriteErrors != 1 {
		t.Errorf("write errors=%d, want 1", stats.WriteErrors)
	}
}

func TestManagerRetiresCaptureWhenOfflineSourceEnds(t *testing.T) {
	previous := captureFactory
	captureFactory = func(ctx context.Context, iface NetworkInterface) (*Capturer, error) {
		c := newCapturerFromOffline(t, photonFixture)
		c.iface = iface
		return c, nil
	}
	t.Cleanup(func() { captureFactory = previous })
	m := NewManager(t.Context())
	m.OnPacket(func([]byte) {})
	if err := m.Reconfigure([]NetworkInterface{{Name: "ended-source"}}); err != nil {
		t.Fatal(err)
	}
	m.wg.Wait()
	state := m.State()
	m.Close(t.Context())
	if len(state.Active) != 0 {
		t.Errorf("a stopped reader is still advertised as active: %+v", state.Active)
	}
	if state.LastErrors["ended-source"] == "" {
		t.Error("unexpected source closure needs an actionable diagnostic")
	}
}

type pausedFileWriter struct {
	pausedRecordSink
	file *os.File
}

func (w *pausedFileWriter) Write(data []byte) (int, error) {
	w.once.Do(func() { close(w.entered); <-w.release })
	return w.file.Write(data)
}

func TestRecorderOwnsBytesUntilAsynchronousWriteCompletes(t *testing.T) {
	c := newStubCapturer(t.Context(), NetworkInterface{Name: "owned-bytes"})
	defer c.Close()
	dir := t.TempDir()
	if err := c.StartRecording(dir); err != nil {
		t.Fatal(err)
	}
	sink := &pausedFileWriter{pausedRecordSink: pausedRecordSink{entered: make(chan struct{}), release: make(chan struct{})}, file: c.recordFile}
	c.recordMu.Lock()
	c.recordWriter = pcapgo.NewWriter(sink)
	c.recordMu.Unlock()
	c.processPacket(buildUDPPacket(t, []byte("first")))
	<-sink.entered
	second := buildUDPPacket(t, []byte("original"))
	c.processPacket(second)
	second.Data()[len(second.Data())-1] = 'X'
	close(sink.release)
	if err := c.StopRecording(); err != nil {
		t.Fatal(err)
	}
	files, _ := filepathGlob(t, dir, "capture_*.pcap")
	if len(files) != 1 {
		t.Fatalf("recording files=%v", files)
	}
	f, err := os.Open(files[0])
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	reader, err := pcapgo.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"first", "original"} {
		data, _, err := reader.ReadPacketData()
		if err != nil {
			t.Fatal(err)
		}
		packet := gopacket.NewPacket(data, reader.LinkType(), gopacket.Default)
		udp, ok := packet.Layer(layers.LayerTypeUDP).(*layers.UDP)
		if !ok || string(udp.Payload) != want {
			t.Errorf("recorded payload=%v, want %q", udp, want)
		}
	}
	if _, _, err = reader.ReadPacketData(); err != io.EOF {
		t.Errorf("recording EOF=%v", err)
	}
}

func setCaptureChangeHandler(t *testing.T, m *Manager, callback func()) {
	t.Helper()
	method := reflect.ValueOf(m).MethodByName("OnCaptureChange")
	if !method.IsValid() {
		t.Fatal("manager must expose an actual capture source change callback")
	}
	method.Call([]reflect.Value{reflect.ValueOf(callback)})
}

func TestManagerCaptureChangeJoinsAllPreviousReadersBeforeInvalidating(t *testing.T) {
	previous := captureFactory
	var old *Capturer
	captureFactory = func(ctx context.Context, iface NetworkInterface) (*Capturer, error) {
		if iface.Name == "old" && old == nil {
			old = newCapturerFromOffline(t, photonFixture)
			old.iface = iface
			return old, nil
		}
		return newStubCapturer(ctx, iface), nil
	}
	t.Cleanup(func() { captureFactory = previous })
	m := NewManager(t.Context())
	entered, release := make(chan struct{}), make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
		m.Close(t.Context())
	}()
	var once sync.Once
	m.OnPacket(func([]byte) { once.Do(func() { close(entered); <-release }) })
	if err := m.Reconfigure([]NetworkInterface{{Name: "old", Device: "old"}, {Name: "retained", Device: "retained"}}); err != nil {
		t.Fatal(err)
	}
	<-entered
	oldRetained := m.active["retained"].cap
	changes := make(chan struct{}, 1)
	setCaptureChangeHandler(t, m, func() {
		if old.ctx.Err() == nil || oldRetained.ctx.Err() == nil {
			t.Error("source changed before every previous reader was canceled")
		}
		old.lifecycleMu.Lock()
		closed := old.closed
		old.lifecycleMu.Unlock()
		if !closed {
			t.Error("source changed before the previous capture was joined and closed")
		}
		if state := m.State(); len(state.Active) != 0 {
			t.Errorf("new reader exposed before invalidation: %+v", state.Active)
		}
		changes <- struct{}{}
	})
	done := make(chan error, 1)
	go func() {
		done <- m.Reconfigure([]NetworkInterface{{Name: "new", Device: "new"}, {Name: "retained", Device: "retained"}})
	}()
	select {
	case <-changes:
		t.Error("invalidation ran while an old packet callback was active")
	case <-time.After(30 * time.Millisecond):
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	select {
	case <-changes:
	default:
		t.Fatal("capture change never invalidated retained context")
	}
	if m.active["retained"].cap == oldRetained {
		t.Fatal("unchanged reader must also retire at a real source selection boundary")
	}
}

func TestManagerCaptureChangeSkipsRescansAndFailedExtraInterface(t *testing.T) {
	opens := map[string]error{}
	defer withStubFactory(t, opens)()
	m := NewManager(t.Context())
	defer m.Close(t.Context())
	m.OnPacket(func([]byte) {})
	changes := 0
	setCaptureChangeHandler(t, m, func() { changes++ })
	target := []NetworkInterface{{Name: "a", Device: "device-a"}}
	if err := m.Reconfigure(target); err != nil {
		t.Fatal(err)
	}
	original := m.active["a"].cap
	if changes != 1 {
		t.Fatalf("initial source callbacks=%d", changes)
	}
	if err := m.Reconfigure(target); err != nil {
		t.Fatal(err)
	}
	if changes != 1 || m.active["a"].cap != original {
		t.Fatal("unchanged rescan invalidated or restarted a working source")
	}
	opens["bad"] = errors.New("unavailable")
	if err := m.Reconfigure(append(target, NetworkInterface{Name: "bad", Device: "bad"})); err == nil {
		t.Fatal("expected partial open failure")
	}
	if changes != 1 || m.active["a"].cap != original {
		t.Fatal("a failed extra source changed the working source")
	}
	if err := m.Reconfigure([]NetworkInterface{{Name: "a", Device: "replacement"}}); err != nil {
		t.Fatal(err)
	}
	if changes != 2 || m.active["a"].cap == original {
		t.Fatal("changed device did not replace and invalidate the source")
	}
	if err := m.Reconfigure(nil); err != nil {
		t.Fatal(err)
	}
	if changes != 3 {
		t.Fatalf("selection removal callbacks=%d", changes)
	}
}

func TestManagerCaptureChangeFailedRetainedReopenRollsBack(t *testing.T) {
	opens := map[string]error{}
	defer withStubFactory(t, opens)()
	m := NewManager(t.Context())
	defer m.Close(t.Context())
	m.OnPacket(func([]byte) {})
	changes := 0
	setCaptureChangeHandler(t, m, func() { changes++ })
	target := []NetworkInterface{{Name: "a", Device: "a"}}
	if err := m.Reconfigure(target); err != nil {
		t.Fatal(err)
	}
	original := m.active["a"].cap
	if err := m.StartRecording(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	opens["a"] = errors.New("second handle unavailable")
	for _, newFailure := range []error{errors.New("unavailable extra interface"), nil} {
		opens["b"] = newFailure
		if err := m.Reconfigure(append(target, NetworkInterface{Name: "b", Device: "b"})); err == nil {
			t.Fatal("expected failed retained reopen to be reported")
		}
		if changes != 1 || m.active["a"] == nil || m.active["a"].cap != original {
			t.Fatal("failed prepared replacement must not retire the working retained source")
		}
		if !original.IsRecording() {
			t.Fatal("rollback stopped the retained recording")
		}
		if len(m.active) != 1 {
			t.Fatal("a partially prepared selection must not start new readers")
		}
	}
}
