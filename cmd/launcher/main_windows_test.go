//go:build windows

package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestLauncherVersionSubprocess(t *testing.T) {
	if os.Getenv("OPENRADAR_TEST_LAUNCHER_VERSION") == "1" {
		main()
		return
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(executable, "-test.run=^TestLauncherVersionSubprocess$", "--", "--version")
	cmd.Env = append(os.Environ(), "OPENRADAR_TEST_LAUNCHER_VERSION=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("version failed: %v, %s", err, out)
	}
	if !strings.Contains(string(out), "OpenRadar v2.3ESP_Deox") {
		t.Fatalf("version did not bypass the source-payload guard: %s", out)
	}
}
