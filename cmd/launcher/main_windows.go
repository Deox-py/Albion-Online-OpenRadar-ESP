//go:build windows

package main

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var (
	Version   = "2.3ESP_Deox"
	BuildTime = "unknown"
)

const (
	npcapVersion      = "1.89"
	npcapInstallerURL = "https://npcap.com/dist/npcap-1.89.exe"
	maxNpcapBytes     = 20 << 20
)

// The builder replaces payload.bin with the freshly-built CGO radar core before
// compiling this launcher. This keeps the distributed artifact to one EXE while
// allowing this bootstrapper to start even when wpcap.dll is not installed yet.
//
//go:embed payload.bin
var corePayload []byte

func main() {
	if hasArg("--version") || hasArg("-version") {
		fmt.Printf("OpenRadar v%s (built: %s)\n", Version, BuildTime)
		return
	}

	if !npcapRuntimePresent() {
		if !promptInstallNpcap() {
			messageBox("OpenRadar 2.3ESP_Deox",
				"Npcap es necesario para capturar paquetes. OpenRadar se cerrará sin realizar cambios.",
				mbOK|mbIconInformation)
			return
		}
		if err := installNpcap(); err != nil {
			messageBox("OpenRadar 2.3ESP_Deox",
				"No se pudo completar la instalación de Npcap:\n\n"+err.Error()+
					"\n\nPuedes instalarlo manualmente desde https://npcap.com/ y volver a abrir OpenRadar.",
				mbOK|mbIconError)
			return
		}
		if !waitForNpcap(20 * time.Second) {
			messageBox("OpenRadar 2.3ESP_Deox",
				"El instalador terminó, pero Npcap todavía no aparece disponible. Reinicia OpenRadar después de terminar la instalación.",
				mbOK|mbIconWarning)
			return
		}
	}

	corePath, err := materializeCore()
	if err != nil {
		messageBox("OpenRadar 2.3ESP_Deox", "No se pudo preparar el núcleo de OpenRadar:\n\n"+err.Error(), mbOK|mbIconError)
		return
	}

	cmd := exec.Command(corePath, os.Args[1:]...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			os.Exit(exitErr.ExitCode())
		}
		messageBox("OpenRadar 2.3ESP_Deox", "No se pudo iniciar OpenRadar:\n\n"+err.Error(), mbOK|mbIconError)
	}
}

func hasArg(target string) bool {
	for _, arg := range os.Args[1:] {
		if strings.EqualFold(arg, target) {
			return true
		}
	}
	return false
}

func npcapRuntimePresent() bool {
	windir := os.Getenv("WINDIR")
	if windir == "" {
		windir = `C:\Windows`
	}
	candidates := []string{
		filepath.Join(windir, "System32", "Npcap", "wpcap.dll"),
		filepath.Join(windir, "System32", "Npcap", "Packet.dll"),
		filepath.Join(windir, "System32", "wpcap.dll"),
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return true
		}
	}
	return false
}

func promptInstallNpcap() bool {
	text := "OpenRadar necesita Npcap para capturar paquetes y no se detectó una instalación válida.\n\n" +
		"¿Quieres descargar e iniciar el instalador oficial de Npcap ahora?\n\n" +
		"La descarga se realiza directamente desde npcap.com y el instalador se abrirá de forma visible."
	return messageBox("Npcap requerido — OpenRadar 2.3ESP_Deox", text, mbYesNo|mbIconQuestion) == idYes
}

func installNpcap() error {
	dir := filepath.Join(os.TempDir(), "OpenRadar-2.3ESP_Deox")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	installer := filepath.Join(dir, "npcap-"+npcapVersion+".exe")

	client := &http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Get(npcapInstallerURL)
	if err != nil {
		return fmt.Errorf("descarga de Npcap: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("descarga de Npcap devolvió HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > maxNpcapBytes {
		return fmt.Errorf("el instalador recibido es inesperadamente grande (%d bytes)", resp.ContentLength)
	}

	f, err := os.OpenFile(installer, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	n, copyErr := io.Copy(f, io.LimitReader(resp.Body, maxNpcapBytes+1))
	closeErr := f.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if n > maxNpcapBytes {
		_ = os.Remove(installer)
		return fmt.Errorf("la descarga superó el límite esperado")
	}

	if err := verifyAuthenticode(installer); err != nil {
		_ = os.Remove(installer)
		return fmt.Errorf("verificación de firma: %w", err)
	}

	cmd := exec.Command(installer)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("instalador de Npcap: %w", err)
	}
	return nil
}

func verifyAuthenticode(path string) error {
	escaped := strings.ReplaceAll(path, "'", "''")
	script := fmt.Sprintf(`$s=Get-AuthenticodeSignature -LiteralPath '%s'; if($s.Status -ne 'Valid'){Write-Error ('Firma no válida: ' + $s.Status); exit 1}; Write-Output $s.SignerCertificate.Subject`, escaped)
	out, err := exec.Command("powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func waitForNpcap(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if npcapRuntimePresent() {
			return true
		}
		time.Sleep(500 * time.Millisecond)
	}
	return npcapRuntimePresent()
}

func materializeCore() (string, error) {
	sum := sha256.Sum256(corePayload)
	hash := hex.EncodeToString(sum[:8])
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		var err error
		base, err = os.UserCacheDir()
		if err != nil {
			return "", err
		}
	}
	dir := filepath.Join(base, "OpenRadar-2.3ESP_Deox", "bin", hash)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	target := filepath.Join(dir, "OpenRadar-core.exe")

	if sameFileHash(target, corePayload) {
		return target, nil
	}
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, corePayload, 0o700); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return target, nil
}

func sameFileHash(path string, expected []byte) bool {
	data, err := os.ReadFile(path)
	if err != nil || len(data) != len(expected) {
		return false
	}
	a := sha256.Sum256(data)
	b := sha256.Sum256(expected)
	return a == b
}

const (
	mbOK              = 0x00000000
	mbYesNo           = 0x00000004
	mbIconError       = 0x00000010
	mbIconQuestion    = 0x00000020
	mbIconWarning     = 0x00000030
	mbIconInformation = 0x00000040
	idYes             = 6
)

func messageBox(title, text string, flags uintptr) int {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(title)
	ret, _, _ := proc.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags)
	return int(ret)
}
