package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"runtime/metrics"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	assets "github.com/nospy/albion-openradar"
	"github.com/nospy/albion-openradar/internal/capture"
	"github.com/nospy/albion-openradar/internal/logger"
	"github.com/nospy/albion-openradar/internal/photon"
	"github.com/nospy/albion-openradar/internal/server"
	"github.com/nospy/albion-openradar/internal/ui"
)

// Version info (injected at build time via ldflags)
// Default values are used when running with 'go run' without ldflags
var (
	Version   = "2.3ESP_Deox"
	BuildTime = "unknown"
)

const (
	serverPort      = 5001
	shutdownTimeout = 10 * time.Second
)

type App struct {
	ctx            context.Context
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	logger         *logger.Logger
	httpServer     *server.HTTPServer
	wsHandler      *server.WebSocketHandler
	captureManager *capture.Manager
	photonParser   *photon.PhotonParser
	program        *tea.Program

	// Packet statistics (atomic for thread safety)
	packetsProcessed atomic.Uint64
	packetsErrors    atomic.Uint64
	packetsEncrypted atomic.Uint64

	// Parse diagnostics. The parser can fail for multiple reasons after a game
	// update; keeping a small histogram makes the TUI useful instead of exposing
	// only an opaque global error counter.
	parseErrMu           sync.Mutex
	parseErrorReasons    map[string]uint64
	lastParseErrorReason string
	lastParsePayloadLen  int

	// Server status (atomic for thread safety)
	httpRunning atomic.Bool
	lanAccess   bool
	autoOpen    bool
	dataDir     string
}

func main() {
	cfg := parseFlags()
	if cfg.showVersion {
		fmt.Printf("OpenRadar v%s (built: %s)\n", Version, BuildTime)
		return
	}

	printBanner()

	for {
		shouldRestart := runApp(cfg)
		if !shouldRestart {
			break
		}
		fmt.Println("Restarting...")
	}
}

func runApp(cfg Config) bool {
	sourceDir, err := os.Getwd()
	if err != nil {
		exitWithError("Failed to get working directory", err)
	}

	dataDir := sourceDir
	if !cfg.devMode {
		dataDir, err = resolveDataDir()
		if err != nil {
			exitWithError("Failed to prepare user data directory", err)
		}
		if err := migrateLegacyUserData(sourceDir, dataDir); err != nil {
			logger.PrintWarn("APP", "Could not migrate legacy config: %v", err)
		}
	}
	captureDir := filepath.Join(dataDir, "logs", "captures")

	ctx, cancel := context.WithCancel(context.Background())

	if runtime.GOOS == "windows" && !npcapRuntimePresent() {
		logger.PrintWarn("NET", "Npcap runtime was not detected. Packet capture may not work until Npcap is installed.")
	}

	allIfaces, err := capture.EnumerateInterfaces()
	if err != nil {
		cancel()
		if runtime.GOOS == "windows" && !npcapRuntimePresent() {
			exitWithError("Npcap is required for packet capture. Install Npcap and try again", err)
		}
		exitWithError("Failed to enumerate interfaces", err)
	}

	if _, mErr := capture.MigrateIPTxt(dataDir, capture.ResolveByIP); mErr != nil {
		logger.PrintWarn("NET", "ip.txt migration failed: %v", mErr)
	}

	cfgPersisted, _ := capture.ReadConfig(dataDir)
	target := resolvePersisted(cfgPersisted, allIfaces, cfg.ipAddr)
	if len(target) == 0 {
		target = autoPickDefaults(allIfaces)
		if len(target) > 0 {
			toPersist := make([]capture.PersistedInterface, 0, len(target))
			for _, i := range target {
				toPersist = append(toPersist, capture.PersistedInterface{Name: i.Name, Description: i.Description})
			}
			_ = capture.MutateConfig(dataDir, func(persisted *capture.Config) {
				persisted.CaptureInterfaces = toPersist
			})
			logger.PrintInfo("NET", "Auto-selected %d interface(s). Change in /settings if needed.", len(target))
		}
	}

	manager := capture.NewManager(ctx)

	app, err := newApp(sourceDir, dataDir, captureDir, cfg, ctx, cancel, manager, allIfaces, cfgPersisted.Logging.ServerLogsEnabled)
	if err != nil {
		cancel()
		manager.Close(context.Background())
		exitWithError("Failed to create app", err)
	}

	if err := manager.Reconfigure(target); err != nil {
		logger.PrintWarn("NET", "Some interfaces failed to open: %v", err)
	}

	if cfgPersisted.Logging.PcapRecording {
		if err := manager.StartRecording(captureDir); err != nil {
			logger.PrintWarn("PKT", "pcap recording could not start: %v", err)
			_ = capture.MutateConfig(dataDir, func(cfg *capture.Config) {
				cfg.Logging.PcapRecording = false
			})
		}
	}

	lanAddresses := []string(nil)
	if cfg.lanAccess {
		lanAddresses = capture.LANAddresses()
	}
	dashboard := ui.NewDashboard(Version, serverPort, cfg.devMode, lanAddresses, nil)
	app.program = tea.NewProgram(dashboard, tea.WithAltScreen())

	app.startCaptureStatePoll()

	// Set up log callback to send logs to dashboard
	logger.SetLogCallback(func(level, tag, message string) {
		app.program.Send(ui.LogMsg{
			Level:   level,
			Tag:     tag,
			Message: message,
		})
	})

	// Start servers in background (will also print session info)
	go app.startServers()

	// Start stats updater
	go app.updateStats()

	// Run dashboard (blocking)
	restartRequested := runInterface(app.program.Run, waitForInterrupt)

	// Cleanup
	logger.ClearLogCallback()
	app.shutdown()

	return restartRequested
}

func runInterface(runDashboard func() (tea.Model, error), waitForSignal func()) bool {
	model, err := runDashboard()
	if err != nil {
		logger.ClearLogCallback()
		logger.PrintWarn("APP", "Console dashboard unavailable: %v", err)
		logger.PrintInfo("APP", "Radar still running, press Ctrl+C to stop")
		waitForSignal()
		return false
	}

	if d, ok := model.(ui.Dashboard); ok {
		return d.RestartRequested()
	}
	return false
}

func waitForInterrupt() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
}

// Config holds command-line configuration
type Config struct {
	devMode     bool
	showVersion bool
	ipAddr      string
	lanAccess   bool
	noOpen      bool
}

func parseFlags() Config {
	cfg := Config{}
	flag.BoolVar(&cfg.devMode, "dev", false, "Run in development mode (read files from disk)")
	flag.BoolVar(&cfg.showVersion, "version", false, "Show version information")
	flag.StringVar(&cfg.ipAddr, "ip", "", "Capture on the interface holding this IP, this run only (network.json is not written)")
	flag.BoolVar(&cfg.lanAccess, "lan", false, "Expose the web UI on the local network (default: localhost only)")
	flag.BoolVar(&cfg.noOpen, "no-open", false, "Do not open the radar UI in the default browser")
	flag.Parse()
	return cfg
}

func printBanner() {
	fmt.Printf("OpenRadar v%s\n", Version)
	fmt.Println("====================")
}

func exitWithError(msg string, err error) {
	fmt.Printf("%s: %v\n", msg, err)
	os.Exit(1)
}

func newApp(
	sourceDir string,
	dataDir string,
	captureDir string,
	cfg Config,
	ctx context.Context,
	cancel context.CancelFunc,
	manager *capture.Manager,
	allIfaces []capture.NetworkInterface,
	serverLogsEnabled bool,
) (*App, error) {
	log := logger.New(filepath.Join(dataDir, "logs"), serverLogsEnabled)
	wsHandler := server.NewWebSocketHandler(log)

	httpServer, err := createHTTPServer(cfg.devMode, sourceDir, dataDir, captureDir, wsHandler, log, Version, BuildTime, manager, allIfaces, cfg.lanAccess)
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP server: %w", err)
	}

	app := &App{
		ctx:               ctx,
		cancel:            cancel,
		logger:            log,
		wsHandler:         wsHandler,
		httpServer:        httpServer,
		captureManager:    manager,
		parseErrorReasons: make(map[string]uint64),
		lanAccess:         cfg.lanAccess,
		autoOpen:          !cfg.noOpen,
		dataDir:           dataDir,
	}
	app.photonParser = photon.NewPhotonParser(
		app.onPhotonEvent,
		app.onPhotonRequest,
		app.onPhotonResponse,
	)
	app.photonParser.OnEncrypted = app.onPhotonEncrypted
	app.photonParser.OnParseError = app.onPhotonParseError

	app.captureManager.OnPacketInfo(app.handlePacketInfo)
	app.captureManager.OnCaptureChange(func() {
		app.photonParser.ResetFragments()
		app.wsHandler.InvalidateMapContext("capture-changed")
	})

	return app, nil
}

func createHTTPServer(
	devMode bool,
	sourceDir string,
	dataDir string,
	captureDir string,
	wsHandler *server.WebSocketHandler,
	log *logger.Logger,
	version string,
	buildTime string,
	mgr *capture.Manager,
	allIfaces []capture.NetworkInterface,
	lanAccess bool,
) (*server.HTTPServer, error) {
	if devMode {
		logger.PrintInfo("MODE", "Development mode: reading files from disk")
		return server.NewHTTPServerDev(serverPort, sourceDir, wsHandler, log, version, buildTime, mgr, allIfaces, mgr, captureDir, lanAccess)
	}
	logger.PrintInfo("MODE", "Production mode: using embedded assets")
	return server.NewHTTPServer(
		serverPort,
		assets.Images,
		assets.Scripts,
		assets.Data,
		assets.Sounds,
		assets.Styles,
		assets.Templates,
		wsHandler,
		log,
		version,
		buildTime,
		mgr,
		allIfaces,
		dataDir,
		mgr,
		captureDir,
		lanAccess,
	)
}

func (app *App) startServers() {
	app.logger.PrintSessionInfo()
	logger.PrintInfo("APP", "Starting servers...")

	app.wg.Go(func() {
		app.httpRunning.Store(true)
		if err := app.httpServer.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) &&
			app.ctx.Err() == nil {
			logger.PrintError("HTTP", "Error: %v", err)
		}
		app.httpRunning.Store(false)
	})

	time.Sleep(100 * time.Millisecond)

	logger.PrintSuccess("HTTP", "Server: http://localhost:%d", serverPort)
	if app.lanAccess {
		for _, ip := range capture.LANAddresses() {
			logger.PrintSuccess("HTTP", "Server: http://%s:%d  (LAN)", ip, serverPort)
		}
	}
	logger.PrintSuccess("WS", "WebSocket: ws://localhost:%d/ws", serverPort)
	logger.PrintInfo("APP", "User data: %s", app.dataDir)
	if app.autoOpen {
		url := fmt.Sprintf("http://localhost:%d", serverPort)
		if err := openBrowser(url); err != nil {
			logger.PrintWarn("APP", "Could not open browser automatically: %v", err)
		}
	}
	if app.lanAccess {
		for _, ip := range capture.LANAddresses() {
			logger.PrintSuccess("WS", "WebSocket: ws://%s:%d/ws  (LAN)", ip, serverPort)
		}
	}
	logger.PrintInfo("PKT", "Listening for Albion packets on UDP port 5056...")
	for _, s := range app.captureManager.State().Active {
		logger.PrintInfo("NET", "Capturing on %s [%s]", s.Description, s.Address)
	}
}

func (app *App) updateStats() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-app.ctx.Done():
			return
		case <-ticker.C:
			if app.program != nil {
				heapMB, sysMB := memoryStatsMB()
				wsStats := app.wsHandler.Stats()
				pcapStats := app.captureManager.Stats()
				logStats := app.logger.GetStats()
				topReason, topCount, lastReason, lastPayloadLen := app.parseDiagnostics()
				app.program.Send(ui.StatsMsg{
					Packets:              app.packetsProcessed.Load(),
					Errors:               app.packetsErrors.Load(),
					Encrypted:            app.packetsEncrypted.Load(),
					TopParseReason:       topReason,
					TopParseCount:        topCount,
					LastParseReason:      lastReason,
					LastPayloadLen:       lastPayloadLen,
					PcapReceived:         pcapStats.PacketsReceived,
					PcapDropped:          pcapStats.PacketsDropped,
					PcapIfDropped:        pcapStats.PacketsIfDropped,
					PcapStatsErrors:      pcapStats.ReadErrors,
					RecordingQueueDrops:  pcapStats.RecordingQueueDrops,
					RecordingWriteErrors: pcapStats.RecordingWriteErrors,
					WsReadErrors:         wsStats.ReadErrors,
					WsWriteFailures:      wsStats.WriteFailures,
					WsNormalCloses:       wsStats.NormalCloses,
					WsQueueDrops:         wsStats.QueueDrops,
					WsClientQueueDrops:   wsStats.ClientQueueDrops,
					WsStreamResets:       wsStats.StreamResets,
					WsNoClientMessages:   wsStats.NoClientMessages,
					WsClients:            app.wsHandler.ClientCount(),
					MemoryMB:             heapMB,
					MemorySysMB:          sysMB,
					Goroutines:           runtime.NumGoroutine(),
					WsBatches:            wsStats.BatchesSent,
					WsMessages:           wsStats.MessagesSent,
					WsQueueSize:          wsStats.MessagesQueue,
					BytesReceived:        app.captureManager.BytesReceived(),
					BytesSent:            wsStats.BytesSent,
					LogEntries:           logStats.TotalEntries,
					LogBatches:           logStats.TotalBatches,
					LogBufferSize:        logStats.BufferSize,
				})

				captureActive := len(app.captureManager.State().Active) > 0
				app.program.Send(ui.StatusMsg{
					HTTPRunning:    app.httpRunning.Load(),
					WSRunning:      app.wsHandler.ClientCount() >= 0,
					CaptureRunning: captureActive,
				})
			}
		}
	}
}

func memoryStatsMB() (heapMB, sysMB float64) {
	samples := []metrics.Sample{
		{Name: "/memory/classes/heap/objects:bytes"},
		{Name: "/memory/classes/total:bytes"},
	}
	metrics.Read(samples)
	return float64(samples[0].Value.Uint64()) / 1024 / 1024, float64(samples[1].Value.Uint64()) / 1024 / 1024
}

func (app *App) handlePacketInfo(info capture.PacketInfo) {
	if app.photonParser.ReceivePacketFlow(info.FlowKey(), info.Payload) {
		app.packetsProcessed.Add(1)
	}
}

func (app *App) onPhotonParseError(reason string, payloadLen int) {
	n := app.packetsErrors.Add(1)
	app.parseErrMu.Lock()
	app.parseErrorReasons[reason]++
	app.lastParseErrorReason = reason
	app.lastParsePayloadLen = payloadLen
	app.parseErrMu.Unlock()
	if n%100 == 1 {
		logger.PrintWarn("PKT", "Parsing errors: %d (last reason: %s, payload len: %d)",
			n, reason, payloadLen)
	}
}

func (app *App) parseDiagnostics() (topReason string, topCount uint64, lastReason string, lastPayloadLen int) {
	app.parseErrMu.Lock()
	defer app.parseErrMu.Unlock()
	for reason, count := range app.parseErrorReasons {
		if count > topCount {
			topReason, topCount = reason, count
		}
	}
	return topReason, topCount, app.lastParseErrorReason, app.lastParsePayloadLen
}

func (app *App) onPhotonEvent(event *photon.EventData) {
	photon.PostProcessEvent(event)
	realCode := event.Parameters[252]
	app.logger.Debug("EVENT_CAPTURE", fmt.Sprintf("Event_%v", realCode), map[string]any{
		"code":       realCode,
		"paramCount": len(event.Parameters),
	}, nil)
	app.wsHandler.BroadcastEvent(event)
}

func (app *App) onPhotonRequest(req *photon.OperationRequest) {
	photon.PostProcessRequest(req)
	app.wsHandler.BroadcastRequest(req)
}

func (app *App) onPhotonResponse(resp *photon.OperationResponse) {
	photon.PostProcessResponse(resp)
	app.wsHandler.BroadcastResponse(resp)
}

func (app *App) onPhotonEncrypted() {
	n := app.packetsEncrypted.Add(1)
	if n%100 == 1 {
		logger.PrintWarn("PKT", "Encrypted traffic seen (%d so far, ignored)", n)
	}
}

func (app *App) shutdown() {
	logger.PrintInfo("APP", "Shutting down gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	app.cancel()
	app.captureManager.Close(ctx)
	app.logger.Stop()

	if err := app.httpServer.Shutdown(ctx); err != nil {
		logger.PrintError("HTTP", "Shutdown error: %v", err)
	}

	done := make(chan struct{})
	go func() {
		app.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		logger.PrintSuccess("APP", "Shutdown complete")
	case <-ctx.Done():
		logger.PrintWarn("APP", "Shutdown timed out")
	}
}

func resolveDataDir() (string, error) {
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		dir := filepath.Join(local, "OpenRadar-2.3ESP_Deox")
		if err := os.MkdirAll(dir, 0o755); err != nil { // #nosec G703 -- Fixed application directory beneath the local user's app-data root, never a request path.
			return "", err
		}
		return dir, nil
	}
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(cacheDir, "OpenRadar-2.3ESP_Deox")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func migrateLegacyUserData(sourceDir, dataDir string) error {
	if sourceDir == dataDir {
		return nil
	}
	for _, name := range []string{"network.json", "ip.txt"} {
		dst := filepath.Join(dataDir, name)
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		src := filepath.Join(sourceDir, name)
		data, err := os.ReadFile(src)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		if err := os.WriteFile(dst, data, 0o644); err != nil { // #nosec G703 -- Migrates only the two fixed legacy filenames into the resolved local app-data directory.
			return err
		}
	}
	return nil
}

func npcapRuntimePresent() bool {
	if runtime.GOOS != "windows" {
		return true
	}
	windir := os.Getenv("WINDIR")
	if windir == "" {
		windir = `C:\Windows`
	}
	candidates := []string{
		filepath.Join(windir, "System32", "Npcap", "wpcap.dll"),
		filepath.Join(windir, "System32", "wpcap.dll"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil { // #nosec G703 -- Checks fixed Npcap DLL names beneath the local Windows directory, never a request path.
			return true
		}
	}
	return false
}

func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url) // #nosec G204 -- Fixed OS launcher receives the generated localhost URL as an argument, without a shell.
	case "darwin":
		cmd = exec.Command("open", url) // #nosec G204 -- Fixed OS launcher receives the generated localhost URL as an argument, without a shell.
	default:
		cmd = exec.Command("xdg-open", url) // #nosec G204 -- Fixed OS launcher receives the generated localhost URL as an argument, without a shell.
	}
	return cmd.Start()
}

// resolvePersisted maps a persisted (or CLI-overridden) selection to currently
// available NetworkInterface entries. Returns nil if the override IP no longer
// resolves; the caller falls back to autoPickDefaults.
func resolvePersisted(cfg capture.Config, all []capture.NetworkInterface, ipOverride string) []capture.NetworkInterface {
	if ipOverride != "" {
		for _, i := range all {
			if i.Address == ipOverride {
				return []capture.NetworkInterface{i}
			}
		}
		return nil
	}
	available := make(map[string]capture.NetworkInterface, len(all))
	for _, i := range all {
		available[i.Name] = i
	}
	out := make([]capture.NetworkInterface, 0, len(cfg.CaptureInterfaces))
	for _, p := range cfg.CaptureInterfaces {
		if i, ok := available[p.Name]; ok {
			out = append(out, i)
		}
	}
	return out
}

func autoPickDefaults(all []capture.NetworkInterface) []capture.NetworkInterface {
	out := make([]capture.NetworkInterface, 0)
	for _, i := range capture.RankCandidates(all) {
		c := capture.Categorize(i.Name, i.Description)
		if (c == capture.CategoryEthernet || c == capture.CategoryWiFi || c == capture.CategoryExitLag) && capture.IsRFC1918(i.Address) {
			out = append(out, i)
		}
	}
	return out
}

// startCaptureStatePoll pushes a CaptureStateMsg to the TUI every 2s so
// header and Config tab reflect live Manager state without coupling ui to capture.
func (app *App) startCaptureStatePoll() {
	app.wg.Go(func() {
		t := time.NewTicker(2 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-app.ctx.Done():
				return
			case <-t.C:
				if app.program == nil {
					continue
				}
				s := app.captureManager.State()
				summaries := make([]ui.CaptureSummary, 0, len(s.Active))
				for _, a := range s.Active {
					summaries = append(summaries, ui.CaptureSummary{
						Description: a.Description,
						Address:     a.Address,
						Category:    string(a.Category),
					})
				}
				lanAddresses := []string(nil)
				if app.lanAccess {
					lanAddresses = capture.LANAddresses()
				}
				app.program.Send(ui.CaptureStateMsg{
					Active:       summaries,
					LanAddresses: lanAddresses,
					Status:       string(s.Status),
				})
			}
		}
	})
}
