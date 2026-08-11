package executor

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrepareStarterTextCreatesFixedCharacterSplits(t *testing.T) {
	content := strings.Repeat("ROMEO:\nA rose by any other name.\n", 100)
	payload := map[string]any{
		"dataset_id":      "data_starter",
		"split":           map[string]any{"train": float64(80), "validation": float64(10), "test": float64(10)},
		"preview_allowed": true,
	}
	result, err := prepareStarterText(payload, content, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if result["version_hash"] == "" {
		t.Fatal("expected an immutable starter dataset version")
	}
	stats := result["statistics"].(map[string]any)
	if stats["vocabulary_size"].(int) < 10 {
		t.Fatalf("unexpected vocabulary: %#v", stats["vocabulary_size"])
	}
}

func TestPrepareStarterTextWritesAllThreeSplits(t *testing.T) {
	outputRoot := t.TempDir()
	payload := map[string]any{
		"dataset_id": "data_starter",
		"split":      map[string]any{"train": float64(80), "validation": float64(10), "test": float64(10)},
	}
	_, err := prepareStarterText(payload, strings.Repeat("To be, or not to be.\n", 100), outputRoot)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"train.txt", "validation.txt", "test.txt"} {
		if _, err := os.Stat(filepath.Join(outputRoot, "llmweb", "datasets", "data_starter", name)); err != nil {
			t.Fatalf("expected %s: %v", name, err)
		}
	}
}
