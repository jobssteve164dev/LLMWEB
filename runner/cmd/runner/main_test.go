package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"llmweb/runner/internal/localstate"
)

func TestReadPairingCodeFileRequiresProtectedRegularFile(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "pairing-code")
	if err := os.WriteFile(path, []byte("pair-once\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	value, err := readPairingCodeFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if value != "pair-once" {
		t.Fatalf("unexpected pairing code %q", value)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := readPairingCodeFile(path); err == nil {
		t.Fatal("expected world-readable pairing code to be rejected")
	}
}

func TestReadPairingCodeFileRejectsSymlinkAndMultilineContent(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target")
	if err := os.WriteFile(target, []byte("pair-once\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := readPairingCodeFile(link); err == nil {
		t.Fatal("expected symlink pairing code to be rejected")
	}
	if err := os.WriteFile(target, []byte("first\nsecond\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readPairingCodeFile(target); err == nil {
		t.Fatal("expected multiline pairing code to be rejected")
	}
}

func TestAuthorizeUpgradeRejectsAnotherControlPlaneBeforeNetwork(t *testing.T) {
	stateRoot := t.TempDir()
	if err := localstate.New(stateRoot).Save(localstate.State{
		RunnerID:    "runner-one",
		DeviceToken: "device-secret",
		ControlURL:  "https://workspace-one.example",
		Name:        "fixture",
		DataRoot:    t.TempDir(),
		OutputRoot:  t.TempDir(),
	}); err != nil {
		t.Fatal(err)
	}
	codePath := filepath.Join(t.TempDir(), "pairing-code")
	if err := os.WriteFile(codePath, []byte("pair_once_123\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := runAuthorizeUpgrade([]string{
		"--url", "https://workspace-two.example",
		"--code-file", codePath,
		"--state-dir", stateRoot,
	})
	if err == nil || !strings.Contains(err.Error(), "另一个控制面") {
		t.Fatalf("expected cross-control-plane rejection, got %v", err)
	}
}
