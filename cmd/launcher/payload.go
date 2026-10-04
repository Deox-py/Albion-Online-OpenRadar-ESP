package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
)

// A plain go build of this package embeds the source placeholder. Fail before
// offering Npcap installation or creating a cached executable in that case.
func validateEmbeddedCore(payload []byte) error {
	if len(payload) < 10<<20 || payload[0] != 'M' || payload[1] != 'Z' {
		return errors.New("Este ejecutable no incluye el núcleo compilado de OpenRadar. Genera la distribución con AUTO-BUILD-2.3ESP_Deox.ps1 y usa el EXE de la carpeta dist.") //nolint:staticcheck // ST1005: This complete Spanish UI instruction is also displayed directly in a message box.
	}
	return nil
}

// materializeCoreAt uses a content-addressed cache and a unique staging file so
// simultaneous launchers cannot truncate or rename each other's payload.
func materializeCoreAt(base string, payload []byte) (string, error) {
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])
	dir := filepath.Join(base, "OpenRadar-2.3ESP_Deox", "bin", hash)
	if err := os.MkdirAll(dir, 0o755); err != nil { // #nosec G703 -- Local user-cache root plus fixed subdirectories and a hexadecimal payload hash; no request input.
		return "", err
	}
	target := filepath.Join(dir, "OpenRadar-core.exe")
	if sameFileHash(target, payload) {
		return target, nil
	}
	f, err := os.CreateTemp(dir, "core-*.tmp")
	if err != nil {
		return "", err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err := f.Write(payload); err != nil {
		f.Close()
		return "", err
	}
	if err := f.Chmod(0o700); err != nil {
		f.Close()
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	// Publishing a hard link never replaces a valid executable another launcher
	// is opening or running. Rename is only needed to repair a corrupt cache or
	// when the cache filesystem does not support hard links.
	if err := os.Link(name, target); err != nil {
		if sameFileHash(target, payload) {
			return target, nil
		}
		if err := os.Rename(name, target); err != nil { // #nosec G703 -- Both paths are created inside the same local content-addressed core cache.
			if sameFileHash(target, payload) {
				return target, nil
			}
			return "", err
		}
	}
	return target, nil
}

func sameFileHash(path string, expected []byte) bool {
	data, err := os.ReadFile(path) // #nosec G703 -- Only called for the fixed executable in the local content-addressed core cache.
	if err != nil || len(data) != len(expected) {
		return false
	}
	return sha256.Sum256(data) == sha256.Sum256(expected)
}
