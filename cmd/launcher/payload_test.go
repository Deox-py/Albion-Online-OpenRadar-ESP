package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestEmbeddedCoreGuardRejectsSourcePlaceholder(t *testing.T) {
	for _, payload := range [][]byte{nil, []byte("OPENRADAR_CORE_PAYLOAD_PLACEHOLDER\n"), []byte("MZ")} {
		err := validateEmbeddedCore(payload)
		if err == nil || !strings.Contains(err.Error(), "AUTO-BUILD-2.3ESP_Deox.ps1") {
			t.Fatalf("source placeholder was accepted or lacked build instructions: %v", err)
		}
	}
}

func TestEmbeddedCoreGuardAcceptsCompiledWindowsCore(t *testing.T) {
	payload := make([]byte, 10<<20)
	payload[0], payload[1] = 'M', 'Z'
	if err := validateEmbeddedCore(payload); err != nil {
		t.Fatalf("compiled payload rejected: %v", err)
	}
}

func TestMaterializeCoreReplacesCorruptCache(t *testing.T) {
	base := t.TempDir()
	payload := []byte("MZ-test-core")
	target, err := materializeCoreAt(base, payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("corrupt"), 0o600); err != nil {
		t.Fatal(err)
	}
	again, err := materializeCoreAt(base, payload)
	if err != nil {
		t.Fatal(err)
	}
	if again != target {
		t.Fatalf("cache path changed: %q != %q", again, target)
	}
	content, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "MZ-test-core" {
		t.Fatalf("corrupt cached core returned: %q", content)
	}
}

func TestMaterializeCoreConcurrentLaunchers(t *testing.T) {
	base := t.TempDir()
	payload := []byte("MZ-concurrent-core")
	var wg sync.WaitGroup
	for range 32 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			target, err := materializeCoreAt(base, payload)
			if err != nil {
				t.Errorf("concurrent materialize: %v", err)
				return
			}
			data, err := os.ReadFile(target)
			if err != nil || !bytes.Equal(data, payload) {
				t.Errorf("invalid core: %q, %v", data, err)
			}
		}()
	}
	wg.Wait()
	leftovers, err := filepath.Glob(filepath.Join(base, "OpenRadar-2.3ESP_Deox", "bin", "*", "*.tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(leftovers) != 0 {
		t.Fatalf("temporary payloads leaked: %v", leftovers)
	}
}
