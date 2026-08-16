package executor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	starterDatasetID     = "tiny-shakespeare"
	starterDatasetPath   = "/opt/llmweb/starter/tiny-shakespeare.txt"
	starterDatasetSHA256 = "86c4e6aa9db7c042ec79f339dcb96d42b0075e16b8fc2e86bf0ca57e2dc565ed"
)

func prepareStarterDataset(ctx context.Context, payload map[string]any, outputRoot string) (map[string]any, error) {
	if stringValue(payload, "source_ref") != starterDatasetID {
		return nil, fmt.Errorf("不支持的入门数据 %q", stringValue(payload, "source_ref"))
	}
	version := os.Getenv("LLMWEB_TRAINING_ENVIRONMENT_VERSION")
	if version == "" || version == "legacy-0.1.0" {
		return nil, fmt.Errorf("当前训练环境不包含固定入门数据")
	}
	image := "llmweb/runtime-cpu:" + version
	command := exec.CommandContext(ctx, "docker", "run", "--rm", "--network=none", "--security-opt=no-new-privileges", "--cap-drop=ALL", image, "cat", starterDatasetPath)
	content, err := command.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("读取训练环境内置入门数据: %s", sanitizeLog(string(content)))
	}
	if len(content) == 0 || len(content) > 2*1024*1024 {
		return nil, fmt.Errorf("训练环境内置入门数据大小无效")
	}
	digest := sha256.Sum256(content)
	if hex.EncodeToString(digest[:]) != starterDatasetSHA256 {
		return nil, fmt.Errorf("入门数据版本校验失败")
	}
	return prepareStarterText(payload, string(content), outputRoot)
}

func prepareStarterText(payload map[string]any, content, outputRoot string) (map[string]any, error) {
	datasetID := stringValue(payload, "dataset_id")
	if datasetID == "" {
		return nil, fmt.Errorf("入门数据任务缺少数据版本")
	}
	characters := []rune(strings.ReplaceAll(content, "\r\n", "\n"))
	if len(characters) < 1000 {
		return nil, fmt.Errorf("入门数据内容不完整")
	}
	split := intMap(payload["split"])
	trainEnd := len(characters) * split["train"] / 100
	validationEnd := trainEnd + len(characters)*split["validation"]/100
	if trainEnd <= 0 || validationEnd <= trainEnd || validationEnd >= len(characters) {
		return nil, fmt.Errorf("入门数据切分比例无效")
	}
	directory := filepath.Join(outputRoot, "llmweb", "datasets", datasetID)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return nil, fmt.Errorf("创建入门数据目录: %w", err)
	}
	parts := map[string][]rune{
		"train.txt":      characters[:trainEnd],
		"validation.txt": characters[trainEnd:validationEnd],
		"test.txt":       characters[validationEnd:],
	}
	for name, part := range parts {
		if err := atomicWrite(filepath.Join(directory, name), []byte(string(part))); err != nil {
			return nil, err
		}
	}
	unique := map[rune]struct{}{}
	for _, character := range characters {
		unique[character] = struct{}{}
	}
	result := map[string]any{
		"version_hash": "sha256:" + starterDatasetSHA256,
		"statistics": map[string]any{
			"rows": len(characters), "valid_rows": len(characters), "invalid_rows": 0,
			"empty_rows": 0, "duplicates": 0, "similar_duplicates": 0,
			"characters": len(characters), "vocabulary_size": len(unique),
			"token_length": map[string]int{"p50": 64, "p95": 64, "max": 64},
			"splits":       map[string]int{"train": trainEnd, "validation": validationEnd - trainEnd, "test": len(characters) - validationEnd},
			"leakage":      map[string]int{"exact_matches": 0},
		},
	}
	if boolValue(payload, "preview_allowed") {
		previewEnd := 180
		if len(characters) < previewEnd {
			previewEnd = len(characters)
		}
		result["preview"] = []map[string]string{{
			"instruction": "让模型续写这段莎士比亚风格的文本",
			"input":       strings.TrimSpace(string(characters[:previewEnd])),
			"output":      "训练完成后由模型继续生成",
		}}
	}
	return result, nil
}
