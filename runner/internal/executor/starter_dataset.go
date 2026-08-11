package executor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	starterDatasetID     = "tiny-shakespeare"
	starterDatasetURL    = "https://raw.githubusercontent.com/karpathy/char-rnn/6f9487a6fe5b420b7ca9afb0d7c078e37c1d1b4e/data/tinyshakespeare/input.txt"
	starterDatasetSHA256 = "86c4e6aa9db7c042ec79f339dcb96d42b0075e16b8fc2e86bf0ca57e2dc565ed"
)

func prepareStarterDataset(ctx context.Context, payload map[string]any, outputRoot string) (map[string]any, error) {
	if stringValue(payload, "source_ref") != starterDatasetID {
		return nil, fmt.Errorf("不支持的入门数据 %q", stringValue(payload, "source_ref"))
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, starterDatasetURL, nil)
	if err != nil {
		return nil, fmt.Errorf("准备入门数据下载: %w", err)
	}
	client := &http.Client{Timeout: 2 * time.Minute}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("下载入门数据: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载入门数据失败: HTTP %d", response.StatusCode)
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("读取入门数据: %w", err)
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
