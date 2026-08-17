package executor

import (
	"archive/zip"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"llmweb/runner/internal/controlplane"
)

func TestInspectDatasetReadsSingleFileZipArchive(t *testing.T) {
	dataRoot := t.TempDir()
	outputRoot := t.TempDir()
	archivePath := filepath.Join(dataRoot, "support.zip")
	archiveFile, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(archiveFile)
	entry, err := writer.Create("support.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	encoder := json.NewEncoder(entry)
	for index := 0; index < 10; index++ {
		if err := encoder.Encode(map[string]string{"instruction": "问题 " + string(rune('A'+index)), "input": "", "output": "答案 " + string(rune('A'+index))}); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := archiveFile.Close(); err != nil {
		t.Fatal(err)
	}

	result, err := inspectDataset(map[string]any{
		"dataset_id": "data_zip", "source_ref": "support.zip", "format": "archive",
		"mapping": map[string]any{"instruction": "instruction", "input": "input", "output": "output"},
		"split":   map[string]any{"train": float64(80), "validation": float64(10), "test": float64(10)},
	}, dataRoot, outputRoot)
	if err != nil {
		t.Fatal(err)
	}
	if result["statistics"].(map[string]any)["valid_rows"] != 10 {
		t.Fatalf("expected 10 valid rows, got %#v", result)
	}
}

func TestInspectDatasetCreatesLocalImmutableVersion(t *testing.T) {
	dataRoot := t.TempDir()
	outputRoot := t.TempDir()
	sourcePath := filepath.Join(dataRoot, "support.jsonl")
	file, err := os.Create(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	encoder := json.NewEncoder(file)
	for index := 0; index < 12; index++ {
		if err := encoder.Encode(map[string]string{
			"question": "问题 " + string(rune('A'+index)),
			"context":  "产品资料",
			"answer":   "答案 " + string(rune('A'+index)),
		}); err != nil {
			t.Fatal(err)
		}
	}
	_ = encoder.Encode(map[string]string{"question": "问题 A", "context": "产品资料", "answer": "答案 A"})
	_ = encoder.Encode(map[string]string{"question": "", "answer": "空问题"})
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	payload := map[string]any{
		"dataset_id": "data_test",
		"source_ref": "support.jsonl",
		"format":     "jsonl",
		"mapping": map[string]any{
			"instruction": "question", "input": "context", "output": "answer",
		},
		"split":           map[string]any{"train": float64(80), "validation": float64(10), "test": float64(10)},
		"preview_allowed": true,
	}
	result, err := inspectDataset(payload, dataRoot, outputRoot)
	if err != nil {
		t.Fatal(err)
	}
	statistics := result["statistics"].(map[string]any)
	if statistics["valid_rows"] != 12 {
		t.Fatalf("expected 12 valid rows, got %#v", statistics["valid_rows"])
	}
	if statistics["duplicates"] != 1 {
		t.Fatalf("expected one duplicate, got %#v", statistics["duplicates"])
	}
	if statistics["empty_rows"] != 1 {
		t.Fatalf("expected one empty row, got %#v", statistics["empty_rows"])
	}
	versionDirectory := filepath.Join(outputRoot, "llmweb", "datasets", "data_test")
	for _, name := range []string{"train.json", "validation.json", "test.json", "train.txt", "validation.txt", "test.txt", "dataset_info.json"} {
		if _, err := os.Stat(filepath.Join(versionDirectory, name)); err != nil {
			t.Fatalf("expected generated %s: %v", name, err)
		}
	}
	trainingText, err := os.ReadFile(filepath.Join(versionDirectory, "train.txt"))
	if err != nil || !strings.Contains(string(trainingText), "问题") || !strings.Contains(string(trainingText), "答案") {
		t.Fatalf("expected CPU-ready text to preserve the instruction and answer: %v", err)
	}
	original, err := os.ReadFile(sourcePath)
	if err != nil || len(original) == 0 {
		t.Fatalf("original data was not preserved: %v", err)
	}
}

func TestInspectDatasetRejectsEscapingDataRoot(t *testing.T) {
	_, err := inspectDataset(map[string]any{
		"dataset_id": "data_test",
		"source_ref": "../secret.jsonl",
		"format":     "jsonl",
	}, t.TempDir(), t.TempDir())
	if err == nil {
		t.Fatal("expected traversal to be rejected")
	}
}

func TestRuntimeConfigIsStructuredAndPinned(t *testing.T) {
	spec := runtimeSpec{
		ModelID: "Qwen/Qwen2.5-0.5B-Instruct", Revision: "main", Template: "qwen",
		Method: "qlora", Epochs: 3, LearningRate: 0.0002, MaxLength: 2048,
		BatchSize: 1, Accumulation: 8,
	}
	config, command, requiresGPU, err := buildRuntimeConfig("train", spec)
	if err != nil {
		t.Fatal(err)
	}
	if !requiresGPU || len(command) != 3 || command[0] != "llamafactory-cli" {
		t.Fatalf("unexpected training command: %#v", command)
	}
	for _, expected := range []string{"quantization_bit: 4", "dataset: llmweb_train", "eval_dataset: llmweb_validation"} {
		if !strings.Contains(config, expected) {
			t.Fatalf("config missing %q", expected)
		}
	}
}

func TestNativeMPSRuntimeConfigUsesHostPathsAndLoRA(t *testing.T) {
	spec := runtimeSpec{
		ModelID: "Qwen/Qwen2.5-0.5B-Instruct", Revision: "main", Template: "qwen",
		Method: "lora", Epochs: 1, LearningRate: 0.0002, MaxLength: 1024,
		BatchSize: 1, Accumulation: 4,
	}
	paths := runtimePaths{
		data: "/Users/test/llmweb/data", output: "/Users/test/llmweb/output",
		config: "/Users/test/Library/Application Support/LLMWEB/task.yaml",
		cli:    "/Library/Application Support/LLMWEB/runtime-mps/bin/llamafactory-cli",
	}
	config, command, requiresGPU, err := buildRuntimeConfigForPaths("train", spec, paths, true)
	if err != nil {
		t.Fatal(err)
	}
	if !requiresGPU || command[0] != paths.cli || command[2] != paths.config {
		t.Fatalf("unexpected MPS command: %#v", command)
	}
	for _, expected := range []string{"dataset_dir: \"/Users/test/llmweb/data\"", "preprocessing_num_workers: 1", "output_dir: \"/Users/test/llmweb/output/adapter\""} {
		if !strings.Contains(config, expected) {
			t.Fatalf("MPS config missing %q", expected)
		}
	}
	if strings.Contains(config, "bitsandbytes") {
		t.Fatal("MPS LoRA config must not include CUDA quantization")
	}
}

func TestChatRequestKeepsPromptOutOfProcessArguments(t *testing.T) {
	spec := runtimeSpec{
		ModelID: "Qwen/Qwen2.5-0.5B-Instruct", Revision: approvedModels["Qwen/Qwen2.5-0.5B-Instruct"], Template: "qwen",
		Method: "lora", Prompt: "包含空格和敏感内容的测试问题", MaxNewTokens: 128, Checkpoint: "adapter",
	}
	config, command, _, err := buildRuntimeConfig("chat", spec)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(config, spec.Prompt) {
		t.Fatal("expected prompt in the local request file")
	}
	if strings.Contains(strings.Join(command, " "), spec.Prompt) {
		t.Fatal("prompt must not be exposed in process arguments")
	}
}

func TestExecutorRejectsUnsupportedProtocol(t *testing.T) {
	executor := New(t.TempDir(), t.TempDir(), t.TempDir())
	_, err := executor.Run(context.Background(), controlplane.Lease{Kind: "inspect", Payload: map[string]any{"schema_version": "2.0"}}, func(string, string, map[string]any) {})
	if err == nil || !strings.Contains(err.Error(), "协议版本") {
		t.Fatalf("expected unsupported protocol rejection, got %v", err)
	}
}

func TestRuntimeSpecRejectsUnapprovedModelRevision(t *testing.T) {
	_, err := parseRuntimeSpec(map[string]any{
		"experiment_id": "exp_test",
		"dataset_id":    "data_test",
		"model": map[string]any{
			"id": "Qwen/Qwen2.5-0.5B-Instruct", "revision": "main", "template": "qwen",
		},
		"training": map[string]any{"method": "qlora"},
		"runtime":  map[string]any{"image": approvedRuntimeImage},
		"output":   map[string]any{"formats": []any{"adapter"}},
	})
	if err == nil || !strings.Contains(err.Error(), "批准范围") {
		t.Fatalf("expected unapproved revision rejection, got %v", err)
	}
}
