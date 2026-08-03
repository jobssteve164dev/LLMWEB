package localstate

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"llmweb/runner/internal/controlplane"
)

type State struct {
	RunnerID      string              `json:"runner_id"`
	DeviceToken   string              `json:"device_token"`
	ControlURL    string              `json:"control_url"`
	Name          string              `json:"name"`
	DataRoot      string              `json:"data_root"`
	OutputRoot    string              `json:"output_root"`
	Active        *controlplane.Lease `json:"active,omitempty"`
	PendingEvents []QueuedEvents      `json:"pending_events,omitempty"`
}

type QueuedEvents struct {
	JobID   string               `json:"job_id"`
	LeaseID string               `json:"lease_id"`
	Events  []controlplane.Event `json:"events"`
}

type Store struct {
	directory string
	path      string
	mu        sync.Mutex
}

func New(directory string) *Store {
	return &Store{directory: directory, path: filepath.Join(directory, "state.json")}
}

func (store *Store) Directory() string { return store.directory }

func (store *Store) Load() (State, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	data, err := os.ReadFile(store.path)
	if os.IsNotExist(err) {
		return State{}, nil
	}
	if err != nil {
		return State{}, fmt.Errorf("read runner state: %w", err)
	}
	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return State{}, fmt.Errorf("decode runner state: %w", err)
	}
	return state, nil
}

func (store *Store) Save(state State) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if err := os.MkdirAll(store.directory, 0o700); err != nil {
		return fmt.Errorf("create runner state directory: %w", err)
	}
	payload, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode runner state: %w", err)
	}
	temporary := store.path + ".tmp"
	if err := os.WriteFile(temporary, payload, 0o600); err != nil {
		return fmt.Errorf("write runner state: %w", err)
	}
	if err := os.Rename(temporary, store.path); err != nil {
		return fmt.Errorf("commit runner state: %w", err)
	}
	return nil
}
