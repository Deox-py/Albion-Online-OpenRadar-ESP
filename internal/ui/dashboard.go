package ui

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

const (
	headerHeight        = 5
	footerHeight        = 5
	maxLogs             = 1000
	sparklineHistory    = 60 // 60s of data
	sparklineDisplayLen = 42 // Display width (30% smaller)
)

// View tabs
type ViewTab int

const (
	TabLogs ViewTab = iota
	TabStats
	TabConfig
)

// Log levels for filtering
type LogLevel int

const (
	LevelAll LogLevel = iota
	LevelInfo
	LevelSuccess
	LevelWarn
	LevelError
)

// Message types
type LogMsg struct {
	Level   string
	Tag     string
	Message string
}

type StatsMsg struct {
	Packets              uint64
	Errors               uint64
	Encrypted            uint64
	TopParseReason       string
	TopParseCount        uint64
	LastParseReason      string
	LastPayloadLen       int
	PcapReceived         uint64
	PcapDropped          uint64
	PcapIfDropped        uint64
	PcapStatsErrors      uint64
	RecordingQueueDrops  uint64
	RecordingWriteErrors uint64
	WsReadErrors         uint64
	WsWriteFailures      uint64
	WsNormalCloses       uint64
	WsQueueDrops         uint64
	WsClientQueueDrops   uint64
	WsStreamResets       uint64
	WsNoClientMessages   uint64
	WsClients            int
	MemoryMB             float64
	MemorySysMB          float64
	Goroutines           int
	WsBatches            uint64
	WsMessages           uint64
	WsQueueSize          int
	BytesReceived        uint64
	BytesSent            uint64
	LogEntries           uint64
	LogBatches           uint64
	LogBufferSize        int
}

type StatusMsg struct {
	HTTPRunning    bool
	WSRunning      bool
	CaptureRunning bool
}

// CaptureSummary mirrors internal/capture.CaptureSummary so internal/ui has no
// dependency on internal/capture.
type CaptureSummary struct {
	Description string
	Address     string
	Category    string
}

type CaptureStateMsg struct {
	Active       []CaptureSummary
	LanAddresses []string
	Status       string
}

type RestartMsg struct{}

type TickMsg time.Time

// LogEntry stores a log with its metadata
type LogEntry struct {
	Time     time.Time
	Level    string
	Tag      string
	Message  string
	Rendered string
}

// Dashboard is the main Bubble Tea model
type Dashboard struct {
	ready            bool
	quitting         bool
	restartRequested bool

	// Static info
	version      string
	serverURL    string
	wsURL        string
	lanServerURL string
	lanWsURL     string
	mode         string
	port         int

	// Capture interfaces and LAN addresses (sourced from Manager.State() poll)
	captureInterfaces []CaptureSummary
	lanAddresses      []string
	captureStatus     string

	// Status indicators
	httpRunning    bool
	wsRunning      bool
	captureRunning bool

	// Real-time stats
	packets              uint64
	errors               uint64
	encrypted            uint64
	topParseReason       string
	topParseCount        uint64
	lastParseReason      string
	lastPayloadLen       int
	pcapReceived         uint64
	pcapDropped          uint64
	pcapIfDropped        uint64
	pcapStatsErrors      uint64
	recordingQueueDrops  uint64
	recordingWriteErrors uint64
	wsReadErrors         uint64
	wsWriteFailures      uint64
	wsNormalCloses       uint64
	wsQueueDrops         uint64
	wsClientQueueDrops   uint64
	wsStreamResets       uint64
	wsNoClientMessages   uint64
	wsClients            int
	memoryMB             float64
	memorySysMB          float64
	goroutines           int
	startTime            time.Time

	// WebSocket batching stats
	wsBatches   uint64
	wsMessages  uint64
	wsQueueSize int

	// Traffic stats
	bytesReceived     uint64
	bytesSent         uint64
	lastBytesReceived uint64
	lastBytesSent     uint64
	rxPerSec          uint64
	txPerSec          uint64

	// Log stats
	logEntries    uint64
	logBatches    uint64
	logBufferSize int

	// Sparkline history
	packetsHistory   []uint64
	memoryHistory    []float64
	memorySysHistory []float64
	wsBatchHistory   []uint64
	lastPackets      uint64
	lastWsBatches    uint64

	// Components
	viewport    viewport.Model
	searchInput textinput.Model
	logs        []LogEntry

	// UI State
	currentTab  ViewTab
	logFilter   LogLevel
	autoScroll  bool
	searching   bool
	searchQuery string

	// Dimensions
	width  int
	height int
}

// NewDashboard creates a new dashboard model
func NewDashboard(version string, port int, devMode bool, lanAddresses []string, captures []CaptureSummary) Dashboard {
	mode := "Producción"
	if devMode {
		mode = "Desarrollo"
	}

	ti := textinput.New()
	ti.Placeholder = "Buscar registros..."
	ti.CharLimit = 50

	d := Dashboard{
		version:           version,
		serverURL:         fmt.Sprintf("http://localhost:%d", port),
		wsURL:             fmt.Sprintf("ws://localhost:%d/ws", port),
		mode:              mode,
		port:              port,
		startTime:         time.Now(),
		logs:              make([]LogEntry, 0, maxLogs),
		packetsHistory:    make([]uint64, 0, sparklineHistory),
		memoryHistory:     make([]float64, 0, sparklineHistory),
		memorySysHistory:  make([]float64, 0, sparklineHistory),
		wsBatchHistory:    make([]uint64, 0, sparklineHistory),
		autoScroll:        true,
		currentTab:        TabLogs,
		logFilter:         LevelAll,
		searchInput:       ti,
		captureInterfaces: captures,
		lanAddresses:      lanAddresses,
	}
	if len(lanAddresses) > 0 && lanAddresses[0] != "127.0.0.1" {
		d.lanServerURL = fmt.Sprintf("http://%s:%d", lanAddresses[0], port)
		d.lanWsURL = fmt.Sprintf("ws://%s:%d/ws", lanAddresses[0], port)
	}
	return d
}

// RestartRequested returns true if user requested a restart
func (d Dashboard) RestartRequested() bool {
	return d.restartRequested
}

// Init initializes the dashboard
func (d Dashboard) Init() tea.Cmd {
	return tea.Batch(tickCmd(), tea.EnterAltScreen)
}

func tickCmd() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg {
		return TickMsg(t)
	})
}

// Update handles messages
func (d Dashboard) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var (
		cmd  tea.Cmd
		cmds []tea.Cmd
	)

	// Handle search input mode
	if d.searching {
		switch msg := msg.(type) {
		case tea.KeyMsg:
			switch msg.String() {
			case "enter":
				d.searchQuery = d.searchInput.Value()
				d.searching = false
				d.viewport.SetContent(d.renderLogs())
			case "esc":
				d.searching = false
				d.searchInput.SetValue("")
				d.searchQuery = ""
				d.viewport.SetContent(d.renderLogs())
			default:
				d.searchInput, cmd = d.searchInput.Update(msg)
				cmds = append(cmds, cmd)
			}
		}
		return d, tea.Batch(cmds...)
	}

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			d.quitting = true
			return d, tea.Quit
		case "r":
			d.restartRequested = true
			d.quitting = true
			return d, tea.Quit
		case "g":
			d.viewport.GotoTop()
			return d, nil
		case "G":
			d.viewport.GotoBottom()
			return d, nil
		case "p":
			d.autoScroll = !d.autoScroll
			return d, nil
		case "c":
			d.logs = make([]LogEntry, 0, maxLogs)
			d.viewport.SetContent(d.renderLogs())
			return d, nil
		case "f":
			d.logFilter = (d.logFilter + 1) % 5
			d.viewport.SetContent(d.renderLogs())
			return d, nil
		case "/":
			d.searching = true
			d.searchInput.Focus()
			return d, textinput.Blink
		case "1":
			d.currentTab = TabLogs
			return d, nil
		case "2":
			d.currentTab = TabStats
			return d, nil
		case "3":
			d.currentTab = TabConfig
			return d, nil
		case "tab":
			d.currentTab = (d.currentTab + 1) % 3
			return d, nil
		}

	case tea.WindowSizeMsg:
		d.width = msg.Width
		d.height = msg.Height

		viewportHeight := d.height - headerHeight - footerHeight - 2
		if !d.ready {
			d.viewport = viewport.New(d.width-2, viewportHeight)
			d.viewport.SetContent(d.renderLogs())
			d.ready = true
		} else {
			d.viewport.Width = d.width - 2
			d.viewport.Height = viewportHeight
		}

	case LogMsg:
		d.addLog(msg)
		if !d.ready {
			// unsized viewport → bubbles/viewport slice-bounds panic
			return d, nil
		}
		d.viewport.SetContent(d.renderLogs())
		if d.autoScroll {
			d.viewport.GotoBottom()
		}

	case StatsMsg:
		// Update sparkline histories
		packetsDiff := msg.Packets - d.lastPackets
		d.lastPackets = msg.Packets
		d.packetsHistory = append(d.packetsHistory, packetsDiff)
		if len(d.packetsHistory) > sparklineHistory {
			d.packetsHistory = d.packetsHistory[1:]
		}

		d.memoryHistory = append(d.memoryHistory, msg.MemoryMB)
		if len(d.memoryHistory) > sparklineHistory {
			d.memoryHistory = d.memoryHistory[1:]
		}

		d.memorySysHistory = append(d.memorySysHistory, msg.MemorySysMB)
		if len(d.memorySysHistory) > sparklineHistory {
			d.memorySysHistory = d.memorySysHistory[1:]
		}

		batchDiff := msg.WsBatches - d.lastWsBatches
		d.lastWsBatches = msg.WsBatches
		d.wsBatchHistory = append(d.wsBatchHistory, batchDiff)
		if len(d.wsBatchHistory) > sparklineHistory {
			d.wsBatchHistory = d.wsBatchHistory[1:]
		}

		d.packets = msg.Packets
		d.errors = msg.Errors
		d.encrypted = msg.Encrypted
		d.topParseReason = msg.TopParseReason
		d.topParseCount = msg.TopParseCount
		d.lastParseReason = msg.LastParseReason
		d.lastPayloadLen = msg.LastPayloadLen
		d.pcapReceived = msg.PcapReceived
		d.pcapDropped = msg.PcapDropped
		d.pcapIfDropped = msg.PcapIfDropped
		d.pcapStatsErrors = msg.PcapStatsErrors
		d.recordingQueueDrops = msg.RecordingQueueDrops
		d.recordingWriteErrors = msg.RecordingWriteErrors
		d.wsReadErrors = msg.WsReadErrors
		d.wsWriteFailures = msg.WsWriteFailures
		d.wsNormalCloses = msg.WsNormalCloses
		d.wsQueueDrops = msg.WsQueueDrops
		d.wsClientQueueDrops = msg.WsClientQueueDrops
		d.wsStreamResets = msg.WsStreamResets
		d.wsNoClientMessages = msg.WsNoClientMessages
		d.wsClients = msg.WsClients
		d.memoryMB = msg.MemoryMB
		d.memorySysMB = msg.MemorySysMB
		d.goroutines = msg.Goroutines
		d.wsBatches = msg.WsBatches
		d.wsMessages = msg.WsMessages
		d.wsQueueSize = msg.WsQueueSize

		// Traffic stats (per second). Capture handles may be reconfigured, which
		// can make their aggregate byte counter decrease. Treat that as a counter
		// reset instead of allowing uint64 subtraction to wrap to a huge value.
		d.rxPerSec = counterDelta(msg.BytesReceived, d.lastBytesReceived)
		d.txPerSec = counterDelta(msg.BytesSent, d.lastBytesSent)
		d.lastBytesReceived = msg.BytesReceived
		d.lastBytesSent = msg.BytesSent
		d.bytesReceived = msg.BytesReceived
		d.bytesSent = msg.BytesSent
		d.logEntries = msg.LogEntries
		d.logBatches = msg.LogBatches
		d.logBufferSize = msg.LogBufferSize

	case StatusMsg:
		d.httpRunning = msg.HTTPRunning
		d.wsRunning = msg.WSRunning
		d.captureRunning = msg.CaptureRunning

	case CaptureStateMsg:
		d.captureInterfaces = msg.Active
		d.lanAddresses = msg.LanAddresses
		d.captureStatus = msg.Status
		if len(msg.LanAddresses) > 0 && msg.LanAddresses[0] != "127.0.0.1" {
			d.lanServerURL = fmt.Sprintf("http://%s:%d", msg.LanAddresses[0], d.port)
			d.lanWsURL = fmt.Sprintf("ws://%s:%d/ws", msg.LanAddresses[0], d.port)
		} else {
			d.lanServerURL = ""
			d.lanWsURL = ""
		}

	case TickMsg:
		cmds = append(cmds, tickCmd())
	}

	// Only pass non-key messages to viewport (scroll is handled by arrow keys internally)
	if _, isKey := msg.(tea.KeyMsg); !isKey {
		d.viewport, cmd = d.viewport.Update(msg)
		cmds = append(cmds, cmd)
	} else {
		// Pass only arrow keys to viewport for scrolling
		if key, ok := msg.(tea.KeyMsg); ok {
			switch key.String() {
			case "up", "down", "pgup", "pgdown":
				d.viewport, cmd = d.viewport.Update(msg)
				cmds = append(cmds, cmd)
			}
		}
	}

	return d, tea.Batch(cmds...)
}

func (d *Dashboard) addLog(log LogMsg) {
	entry := LogEntry{
		Time:    time.Now(),
		Level:   log.Level,
		Tag:     log.Tag,
		Message: log.Message,
	}

	// Pre-render the log line
	ts := TimestampStyle.Render(fmt.Sprintf("[%s]", entry.Time.Format(time.TimeOnly)))
	tag := GetTagStyle(log.Level).Render(fmt.Sprintf("[%s]", log.Tag))
	entry.Rendered = fmt.Sprintf("%s %s %s", ts, tag, log.Message)

	d.logs = append(d.logs, entry)

	if len(d.logs) > maxLogs {
		d.logs = d.logs[len(d.logs)-maxLogs:]
	}
}

func (d *Dashboard) filterLogs() []LogEntry {
	if d.logFilter == LevelAll && d.searchQuery == "" {
		return d.logs
	}

	filtered := make([]LogEntry, 0)
	for _, log := range d.logs {
		// Filter by level
		if d.logFilter != LevelAll {
			switch d.logFilter {
			case LevelInfo:
				if log.Level != "INFO" {
					continue
				}
			case LevelSuccess:
				if log.Level != "SUCCESS" {
					continue
				}
			case LevelWarn:
				if log.Level != "WARN" {
					continue
				}
			case LevelError:
				if log.Level != "ERROR" {
					continue
				}
			}
		}

		// Filter by search query
		if d.searchQuery != "" {
			if !strings.Contains(strings.ToLower(log.Message), strings.ToLower(d.searchQuery)) &&
				!strings.Contains(strings.ToLower(log.Tag), strings.ToLower(d.searchQuery)) {
				continue
			}
		}

		filtered = append(filtered, log)
	}
	return filtered
}

func (d *Dashboard) renderLogs() string {
	logs := d.filterLogs()
	if len(logs) == 0 {
		if d.searchQuery != "" {
			return TimestampStyle.Render(fmt.Sprintf("  Sin registros que coincidan con '%s'", d.searchQuery))
		}
		return TimestampStyle.Render("  Esperando registros...")
	}

	lines := make([]string, len(logs))
	for i, log := range logs {
		lines[i] = log.Rendered
	}
	return strings.Join(lines, "\n")
}

// View renders the dashboard
func (d Dashboard) View() string {
	if d.quitting {
		return ""
	}

	if !d.ready {
		return "Inicializando..."
	}

	header := d.renderHeader()

	var content string
	switch d.currentTab {
	case TabLogs:
		content = BorderStyle.Width(d.width - 2).Render(d.viewport.View())
	case TabStats:
		content = BorderStyle.Width(d.width - 2).Render(d.renderStatsView())
	case TabConfig:
		content = BorderStyle.Width(d.width - 2).Render(d.renderConfigView())
	}

	footer := d.renderFooter()

	return lipgloss.JoinVertical(lipgloss.Left, header, content, footer)
}

func (d *Dashboard) renderHeader() string {
	// Title and status indicators
	title := TitleStyle.Render("OpenRadar v" + d.version)

	httpStatus := statusIndicator(d.httpRunning, "HTTP")
	wsStatus := statusIndicator(d.wsRunning, "WS")
	captureStatus := statusIndicator(d.captureRunning, "CAP")
	status := fmt.Sprintf("%s %s %s", httpStatus, wsStatus, captureStatus)

	// Mode and capture interfaces
	mode := ModeStyle.Render("Modo: " + d.mode)
	captureLine := "Captura: " + formatCaptureLine(d.captureInterfaces)
	adapter := TimestampStyle.Render(captureLine)

	httpLine := d.serverURL
	wsLine := d.wsURL
	if d.lanServerURL != "" {
		httpLine = httpLine + "  |  " + d.lanServerURL + " (LAN)"
		wsLine = wsLine + "  |  " + d.lanWsURL
	}
	httpURL := URLStyle.Render(httpLine)
	wsURL := URLStyle.Render(wsLine)

	// Started time
	startedAt := TimestampStyle.Render("Inicio: " + d.startTime.Format(time.TimeOnly))

	// Tabs
	tabs := d.renderTabs()

	left := lipgloss.JoinVertical(lipgloss.Left, title, mode, adapter, startedAt)
	right := lipgloss.JoinVertical(lipgloss.Right, status, httpURL, wsURL, "")

	leftWidth := lipgloss.Width(left)
	rightWidth := lipgloss.Width(right)
	spacing := max(d.width-leftWidth-rightWidth-4, 1)

	row := lipgloss.JoinHorizontal(lipgloss.Top, left, strings.Repeat(" ", spacing), right)
	headerContent := lipgloss.JoinVertical(lipgloss.Left, row, tabs)
	if d.captureStatus == "awaiting_interfaces" {
		warn := LogWarnStyle.Render("⚠ CAPTURA EN ESPERA — selecciona al menos una interfaz en Configuración → Red")
		headerContent = lipgloss.JoinVertical(lipgloss.Left, row, warn, tabs)
	}

	return HeaderStyle.Width(d.width).Render(headerContent)
}

func (d *Dashboard) renderTabs() string {
	tabs := []string{"[1] Registros", "[2] Estadísticas", "[3] Config"}
	rendered := make([]string, len(tabs))

	for i, tab := range tabs {
		if ViewTab(i) == d.currentTab {
			rendered[i] = TabActiveStyle.Render(tab)
		} else {
			rendered[i] = TabStyle.Render(tab)
		}
	}

	return strings.Join(rendered, "  ")
}

func statusIndicator(running bool, label string) string {
	if running {
		return StatusOnStyle.Render("●") + " " + StatLabelStyle.Render(label)
	}
	return StatusOffStyle.Render("●") + " " + StatLabelStyle.Render(label)
}

func (d *Dashboard) renderFooter() string {
	uptime := time.Since(d.startTime).Round(time.Second)

	// Sparkline
	packetsSparkline := renderSparkline(d.packetsHistory, ColorPrimary)

	// Stats line 1: Packets & Memory
	stats1 := fmt.Sprintf(
		"%s %s %s  |  %s %s  %s %s  |  %s %s",
		StatLabelStyle.Render("Paq:"),
		StatValueStyle.Render(formatNumber(d.packets)),
		packetsSparkline,
		StatLabelStyle.Render("Heap:"),
		StatValueStyle.Render(fmt.Sprintf("%.0fMB", d.memoryMB)),
		StatLabelStyle.Render("Sys:"),
		StatValueStyle.Render(fmt.Sprintf("%.0fMB", d.memorySysMB)),
		StatLabelStyle.Render("Act:"),
		StatValueStyle.Render(formatDuration(uptime)),
	)

	// Stats line 2: WS batching & system
	stats2 := fmt.Sprintf(
		"%s %s  |  %s %s  |  %s %s  |  %s %s",
		StatLabelStyle.Render("Batch:"),
		StatValueStyle.Render(fmt.Sprintf("%s/%s", formatNumber(d.wsBatches), formatNumber(d.wsMessages))),
		StatLabelStyle.Render("WS:"),
		StatValueStyle.Render(strconv.Itoa(d.wsClients)),
		StatLabelStyle.Render("Err:"),
		StatValueStyle.Render(formatNumber(d.errors)),
		StatLabelStyle.Render("Logs:"),
		StatValueStyle.Render(strconv.Itoa(len(d.logs))),
	)

	// Filter and scroll status
	filterStr := d.getFilterString()
	scrollStr := ""
	if !d.autoScroll {
		scrollStr = " | " + ModeStyle.Render("PAUSA")
	}
	if d.searchQuery != "" {
		scrollStr += " | " + URLStyle.Render("Buscar: "+d.searchQuery)
	}
	statusLine := filterStr + scrollStr

	// Help
	help := HelpStyle.Render(
		"q:salir  r:reiniciar  p:pausa  c:limpiar  f:filtro  /:buscar  tab:cambiar  ↑↓:desplazar",
	)

	// Search input if active
	if d.searching {
		searchBox := d.searchInput.View()
		return FooterStyle.Width(d.width).Align(lipgloss.Center).Render(
			lipgloss.JoinVertical(lipgloss.Center, stats1, stats2, searchBox, help),
		)
	}

	return FooterStyle.Width(d.width).Align(lipgloss.Center).Render(
		lipgloss.JoinVertical(lipgloss.Center, stats1, stats2, statusLine, help),
	)
}

func (d *Dashboard) getFilterString() string {
	switch d.logFilter {
	case LevelInfo:
		return LogInfoStyle.Render("Filtro: INFO")
	case LevelSuccess:
		return LogSuccessStyle.Render("Filtro: SUCCESS")
	case LevelWarn:
		return LogWarnStyle.Render("Filtro: WARN")
	case LevelError:
		return LogErrorStyle.Render("Filtro: ERROR")
	default:
		return StatLabelStyle.Render("Filtro: TODOS")
	}
}

func (d *Dashboard) renderStatsView() string {
	uptime := time.Since(d.startTime).Round(time.Second)

	avgMsgsPerBatch := float64(0)
	if d.wsBatches > 0 {
		avgMsgsPerBatch = float64(d.wsMessages) / float64(d.wsBatches)
	}
	errorRate := float64(0)
	if d.packets > 0 {
		errorRate = float64(d.errors) / float64(d.packets) * 100
	}
	packetsPerSec := float64(0)
	if len(d.packetsHistory) > 0 {
		packetsPerSec = float64(d.packetsHistory[len(d.packetsHistory)-1])
	}
	batchesPerSec := float64(0)
	if len(d.wsBatchHistory) > 0 {
		batchesPerSec = float64(d.wsBatchHistory[len(d.wsBatchHistory)-1])
	}

	labelStyle := StatLabelStyle.Width(15).Align(lipgloss.Right)
	valStyle := func(color lipgloss.Color) lipgloss.Style {
		return lipgloss.NewStyle().Bold(true).Foreground(color).Width(15)
	}
	stat := func(label, value string, color lipgloss.Color) string {
		return fmt.Sprintf(" %s %s", labelStyle.Render(label), valStyle(color).Render(value))
	}
	section := func(icon, title string) string {
		return fmt.Sprintf(" %s %s", icon, TitleStyle.Render(title))
	}

	topParse := "—"
	if d.topParseReason != "" {
		topParse = fmt.Sprintf("%s (%s)", d.topParseReason, formatNumber(d.topParseCount))
	}
	lastParse := "—"
	if d.lastParseReason != "" {
		lastParse = fmt.Sprintf("%s / %d B", d.lastParseReason, d.lastPayloadLen)
	}

	leftLines := []string{
		section("📊", "Servidor"),
		stat("Tiempo activo:", formatDuration(uptime), ColorHighlight),
		stat("Paquetes:", formatNumber(d.packets), ColorSuccess),
		stat("Paq/seg:", fmt.Sprintf("%.0f", packetsPerSec), ColorPrimary),
		stat("Errores parser:", formatNumber(d.errors), d.getErrorColor(errorRate)),
		stat("Tasa error:", fmt.Sprintf("%.2f%%", errorRate), d.getErrorColor(errorRate)),
		stat("Cifrados:", formatNumber(d.encrypted), ColorWarning),
		"",
		section("🧪", "Diagnóstico de captura"),
		stat("PCAP recibidos:", formatNumber(d.pcapReceived), ColorSuccess),
		stat("PCAP perdidos:", formatNumber(d.pcapDropped), d.getDropColor(d.pcapDropped)),
		stat("IF perdidos:", formatNumber(d.pcapIfDropped), d.getDropColor(d.pcapIfDropped)),
		stat("Stats fallos:", formatNumber(d.pcapStatsErrors), d.getDropColor(d.pcapStatsErrors)),
		stat("PCAP cola perdida:", formatNumber(d.recordingQueueDrops), d.getDropColor(d.recordingQueueDrops)),
		stat("PCAP disco fallos:", formatNumber(d.recordingWriteErrors), d.getDropColor(d.recordingWriteErrors)),
		stat("Error principal:", truncateText(topParse, 22), ColorWarning),
		stat("Último error:", truncateText(lastParse, 22), ColorWarning),
		"",
		section("📡", "Tráfico"),
		stat("RX total:", formatBytes(d.bytesReceived), ColorPrimary),
		stat("RX/seg:", formatBytes(d.rxPerSec)+"/s", ColorSuccess),
		stat("TX total:", formatBytes(d.bytesSent), ColorPrimary),
		stat("TX/seg:", formatBytes(d.txPerSec)+"/s", ColorWarning),
	}

	rightLines := []string{
		section("🔌", "WebSocket"),
		stat("Clientes:", strconv.Itoa(d.wsClients), ColorPrimary),
		stat("Lotes:", formatNumber(d.wsBatches), ColorSuccess),
		stat("Lotes/seg:", fmt.Sprintf("%.0f", batchesPerSec), ColorPrimary),
		stat("Mensajes:", formatNumber(d.wsMessages), ColorSuccess),
		stat("Prom/lote:", fmt.Sprintf("%.1f", avgMsgsPerBatch), ColorWarning),
		stat("Cola:", strconv.Itoa(d.wsQueueSize), d.getQueueColor()),
		stat("Cierres normales:", formatNumber(d.wsNormalCloses), ColorSuccess),
		stat("Errores lectura:", formatNumber(d.wsReadErrors), d.getDropColor(d.wsReadErrors)),
		stat("Fallos escritura:", formatNumber(d.wsWriteFailures), d.getDropColor(d.wsWriteFailures)),
		stat("Drops de cola:", formatNumber(d.wsQueueDrops), d.getDropColor(d.wsQueueDrops)),
		stat("Drops por cliente:", formatNumber(d.wsClientQueueDrops), d.getDropColor(d.wsClientQueueDrops)),
		stat("Estado invalidado:", formatNumber(d.wsStreamResets), d.getDropColor(d.wsStreamResets)),
		stat("Sin cliente:", formatNumber(d.wsNoClientMessages), ColorMuted),
		"",
		section("📈", "Paquetes/seg"),
		" " + renderSparkline(d.packetsHistory, ColorPrimary),
		" " + d.getSparklineStats(d.packetsHistory, ""),
		"",
		section("🧠", "Memoria"),
		" Heap " + renderSparkline(d.memoryHistory, ColorWarning),
		" " + d.getSparklineStatsFloat(d.memoryHistory, "MB"),
		" Sys  " + renderSparkline(d.memorySysHistory, ColorError),
		" " + d.getSparklineStatsFloat(d.memorySysHistory, "MB"),
		"",
		section("📝", "Registros"),
		stat("Entradas:", formatNumber(d.logEntries), ColorSuccess),
		stat("Lotes:", formatNumber(d.logBatches), ColorPrimary),
		stat("Buffer:", strconv.Itoa(d.logBufferSize), ColorWarning),
	}

	colWidth := (d.width - 4) / 2
	leftCol := lipgloss.NewStyle().Width(colWidth).Render(strings.Join(leftLines, "\n"))
	rightCol := lipgloss.NewStyle().Width(colWidth).Render(strings.Join(rightLines, "\n"))
	return lipgloss.JoinHorizontal(lipgloss.Top, " ", leftCol, " ", rightCol)
}

func counterDelta(current, previous uint64) uint64 {
	if current >= previous {
		return current - previous
	}
	return current
}

func (d *Dashboard) getDropColor(v uint64) lipgloss.Color {
	if v > 100 {
		return ColorError
	}
	if v > 0 {
		return ColorWarning
	}
	return ColorSuccess
}

func truncateText(v string, maxLen int) string {
	r := []rune(v)
	if len(r) <= maxLen {
		return v
	}
	if maxLen <= 1 {
		return string(r[:maxLen])
	}
	return string(r[:maxLen-1]) + "…"
}

func (d *Dashboard) getErrorColor(rate float64) lipgloss.Color {
	if rate > 5 {
		return ColorError
	} else if rate > 1 {
		return ColorWarning
	}
	return ColorSuccess
}

func (d *Dashboard) getQueueColor() lipgloss.Color {
	if d.wsQueueSize > 50 {
		return ColorError
	} else if d.wsQueueSize > 20 {
		return ColorWarning
	}
	return ColorSuccess
}

func (d *Dashboard) getSparklineStats(data []uint64, unit string) string {
	if len(data) == 0 {
		return StatLabelStyle.Render("Sin datos")
	}
	lo, hi, avg := float64(slices.Min(data)), float64(slices.Max(data)), avgVal(data)
	return StatLabelStyle.Render(fmt.Sprintf("min: %.0f  avg: %.0f  max: %.0f %s", lo, avg, hi, unit))
}

func (d *Dashboard) getSparklineStatsFloat(data []float64, unit string) string {
	if len(data) == 0 {
		return StatLabelStyle.Render("Sin datos")
	}
	lo, hi, avg := float64(slices.Min(data)), float64(slices.Max(data)), avgVal(data)
	return StatLabelStyle.Render(fmt.Sprintf("min: %.1f  avg: %.1f  max: %.1f %s", lo, avg, hi, unit))
}

func (d *Dashboard) renderConfigView() string {
	section := func(icon, title string) string {
		return fmt.Sprintf(" %s %s", icon, TitleStyle.Render(title))
	}
	labelStyle := StatLabelStyle.Width(12).Align(lipgloss.Right)
	cfgLine := func(label, value string, style lipgloss.Style) string {
		return fmt.Sprintf(" %s %s", labelStyle.Render(label), style.Render(value))
	}
	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(ColorPrimary).Width(6)
	keyLine := func(key, desc string) string {
		return fmt.Sprintf(" %s %s", keyStyle.Render(key), StatLabelStyle.Render(desc))
	}

	leftLines := []string{
		section("⚙️", "Configuración"),
		cfgLine("Versión:", d.version, StatValueStyle),
		cfgLine("Modo:", d.mode, ModeStyle),
		cfgLine("HTTP:", d.serverURL, URLStyle),
		cfgLine("WS:", d.wsURL, URLStyle),
		cfgLine("Captura:", formatCaptureLine(d.captureInterfaces), StatValueStyle),
		cfgLine("LAN:", strings.Join(d.lanAddresses, ", "), StatValueStyle),
		"",
		section("ℹ️", "Acerca de"),
		cfgLine("", "OpenRadar 2.3ESP_Deox", StatLabelStyle),
		cfgLine("", "Radar de paquetes en tiempo real", StatLabelStyle),
	}

	rightLines := []string{
		section("⌨️", "Atajos"),
		keyLine("q", "Salir"),
		keyLine("r", "Reiniciar aplicación"),
		keyLine("p", "Alternar auto-desplazamiento"),
		keyLine("c", "Limpiar registros"),
		keyLine("f", "Cambiar filtro de registros"),
		keyLine("/", "Buscar registros"),
		keyLine("↑↓", "Desplazar registros"),
		keyLine("g/G", "Ir al inicio/final"),
		keyLine("1-3", "Cambiar pestaña"),
		keyLine("tab", "Siguiente pestaña"),
		"",
		section("📋", "Niveles de registro"),
		" " + LogInfoStyle.Render("INFO") + " " + LogSuccessStyle.Render("SUCCESS") + " " + LogWarnStyle.Render("WARN") + " " + LogErrorStyle.Render("ERROR"),
	}

	colWidth := (d.width - 4) / 2
	leftCol := lipgloss.NewStyle().Width(colWidth).Render(strings.Join(leftLines, "\n"))
	rightCol := lipgloss.NewStyle().Width(colWidth).Render(strings.Join(rightLines, "\n"))
	return lipgloss.JoinHorizontal(lipgloss.Top, " ", leftCol, " ", rightCol)
}

// Sparkline rendering
var sparkChars = []rune{'▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'}

func renderSparkline[T uint64 | float64](data []T, color lipgloss.Color) string {
	if len(data) == 0 {
		return ""
	}

	// Downsample if needed (60 data points -> 42 display chars)
	displayData := data
	if len(data) > sparklineDisplayLen {
		displayData = make([]T, sparklineDisplayLen)
		ratio := float64(len(data)) / float64(sparklineDisplayLen)
		for i := range sparklineDisplayLen {
			// Average the values in each bucket
			start := int(float64(i) * ratio)
			end := min(int(float64(i+1)*ratio), len(data))
			var sum float64
			for j := start; j < end; j++ {
				sum += float64(data[j])
			}
			displayData[i] = T(sum / float64(end-start))
		}
	}

	peak := slices.Max(displayData)
	if peak == 0 {
		return lipgloss.NewStyle().
			Foreground(color).
			Render(strings.Repeat(string(sparkChars[0]), len(displayData)))
	}

	var sb strings.Builder
	for _, v := range displayData {
		idx := min(int(float64(v)/float64(peak)*float64(len(sparkChars)-1)), len(sparkChars)-1)
		sb.WriteRune(sparkChars[idx])
	}

	return lipgloss.NewStyle().Foreground(color).Render(sb.String())
}

func avgVal[T uint64 | float64](data []T) float64 {
	if len(data) == 0 {
		return 0
	}
	var sum float64
	for _, v := range data {
		sum += float64(v)
	}
	return sum / float64(len(data))
}

func formatNumber(n uint64) string {
	str := strconv.FormatUint(n, 10)
	if len(str) <= 3 {
		return str
	}

	var result strings.Builder
	for i, c := range str {
		if i > 0 && (len(str)-i)%3 == 0 {
			result.WriteRune(',')
		}
		result.WriteRune(c)
	}
	return result.String()
}

func formatBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

func formatCaptureLine(summaries []CaptureSummary) string {
	if len(summaries) == 0 {
		return "(en espera)"
	}
	parts := make([]string, 0, len(summaries))
	for _, c := range summaries {
		parts = append(parts, fmt.Sprintf("%s (%s)", c.Description, c.Address))
	}
	return strings.Join(parts, ", ")
}

func formatDuration(d time.Duration) string {
	d = d.Round(time.Second)

	h := d / time.Hour
	d -= h * time.Hour
	m := d / time.Minute
	d -= m * time.Minute
	s := d / time.Second

	if h > 0 {
		return fmt.Sprintf("%dh%dm", h, m)
	}
	if m > 0 {
		return fmt.Sprintf("%dm%ds", m, s)
	}
	return fmt.Sprintf("%ds", s)
}
