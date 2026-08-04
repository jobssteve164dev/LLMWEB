package executor

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"llmweb/runner/internal/controlplane"
)

func (executor *Executor) prepareAndInspect(ctx context.Context, lease controlplane.Lease, emit EmitFunc) (map[string]any, error) {
	sourceType := stringValue(lease.Payload, "source_type")
	if sourceType != "huggingface" && sourceType != "modelscope" && sourceType != "s3" {
		return nil, fmt.Errorf("不支持的数据来源 %q", sourceType)
	}
	datasetID := stringValue(lease.Payload, "dataset_id")
	importDirectory := filepath.Join(executor.outputRoot, "llmweb", "imports", datasetID)
	cacheDirectory := filepath.Join(executor.outputRoot, "llmweb", "cache")
	for _, directory := range []string{importDirectory, cacheDirectory} {
		if err := os.MkdirAll(directory, 0o750); err != nil {
			return nil, fmt.Errorf("准备数据下载目录: %w", err)
		}
	}
	if executor.backend == "native_mps" {
		command := []string{
			filepath.Join(executor.runtimeRoot, "bin", "python"),
			filepath.Join(executor.runtimeRoot, "llmweb", "prepare_dataset.py"),
			"--source-type", sourceType,
			"--source", stringValue(lease.Payload, "source_ref"),
			"--format", stringValue(lease.Payload, "format"),
			"--output", filepath.Join(importDirectory, "source.jsonl"),
		}
		emit("progress", "正在从数据源下载到你的算力环境", map[string]any{"percent": 5})
		if err := executor.runNative(ctx, command, emit); err != nil {
			return nil, err
		}
		payload := make(map[string]any, len(lease.Payload))
		for key, value := range lease.Payload {
			payload[key] = value
		}
		payload["format"] = "jsonl"
		return inspectDatasetFile(payload, filepath.Join(importDirectory, "source.jsonl"), executor.outputRoot)
	}
	container := containerName(lease.JobID)
	executor.setContainer(container)
	defer executor.setContainer("")
	args := []string{
		"run", "--name", container,
		"--security-opt=no-new-privileges", "--cap-drop=ALL",
		"-v", importDirectory + ":/workspace/import",
		"-v", cacheDirectory + ":/root/.cache",
	}
	for _, variable := range []string{"HF_TOKEN", "MODELSCOPE_API_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_DEFAULT_REGION", "AWS_ENDPOINT_URL"} {
		if os.Getenv(variable) != "" {
			args = append(args, "-e", variable)
		}
	}
	args = append(args, approvedRuntimeImage,
		"python", "/opt/llmweb/prepare_dataset.py",
		"--source-type", sourceType,
		"--source", stringValue(lease.Payload, "source_ref"),
		"--format", stringValue(lease.Payload, "format"),
		"--output", "/workspace/import/source.jsonl",
	)
	emit("progress", "正在从数据源下载到你的算力环境", map[string]any{"percent": 5})
	if err := runDocker(ctx, container, args, emit); err != nil {
		if status, exists := dockerStatus(container); exists && status != "running" {
			_ = exec.Command("docker", "rm", container).Run()
		}
		return nil, err
	}
	_ = exec.Command("docker", "rm", container).Run()
	payload := make(map[string]any, len(lease.Payload))
	for key, value := range lease.Payload {
		payload[key] = value
	}
	payload["format"] = "jsonl"
	return inspectDatasetFile(payload, filepath.Join(importDirectory, "source.jsonl"), executor.outputRoot)
}
