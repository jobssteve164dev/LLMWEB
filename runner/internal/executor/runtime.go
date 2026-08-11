package executor

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"llmweb/runner/internal/controlplane"
)

const (
	approvedRuntimeImage    = "llmweb/runtime:0.1.0"
	approvedCPURuntimeImage = "llmweb/runtime-cpu:0.1.0"
)

var approvedModels = map[string]string{
	"Qwen/Qwen2.5-0.5B-Instruct": "7ae557604adf67be50417f59c2c2f167def9a775",
	"Qwen/Qwen2.5-1.5B-Instruct": "989aa7980e4cf806f80c7fef2b1adb7bc71aa306",
	"Qwen/Qwen2.5-3B-Instruct":   "aa8e72537993ba99e69dfaafa59ed015b17504d1",
	"karpathy/nanoGPT":           "3adf61e154c3fe3fca428ad6bc3818b27a3b8291",
}

type runtimeSpec struct {
	ExperimentID string
	DatasetID    string
	ModelID      string
	Revision     string
	Template     string
	Method       string
	Epochs       float64
	LearningRate float64
	MaxLength    int
	BatchSize    int
	Accumulation int
	Iterations   int
	Formats      []string
	Image        string
	Preview      bool
	Checkpoint   string
	Destination  string
	S3URI        string
	S3Endpoint   string
}

type runtimePaths struct {
	data         string
	output       string
	config       string
	python       string
	evaluator    string
	llamaConvert string
	cli          string
}

func (executor *Executor) runRuntime(ctx context.Context, lease controlplane.Lease, emit EmitFunc) (map[string]any, error) {
	spec, err := parseRuntimeSpec(lease.Payload)
	if err != nil {
		return nil, err
	}
	if spec.Image != approvedRuntimeImage && spec.Image != approvedCPURuntimeImage {
		return nil, fmt.Errorf("训练镜像不在首版批准范围内")
	}
	if executor.backend == "docker_cpu" && (spec.Image != approvedCPURuntimeImage || spec.Method != "starter") {
		return nil, fmt.Errorf("CPU 算力只接受固定的入门训练方案")
	}
	if executor.backend != "docker_cpu" && spec.Image == approvedCPURuntimeImage {
		return nil, fmt.Errorf("入门 CPU 训练方案与当前算力不匹配")
	}
	datasetDirectory := filepath.Join(executor.outputRoot, "llmweb", "datasets", spec.DatasetID)
	experimentDirectory := filepath.Join(executor.outputRoot, "llmweb", "experiments", spec.ExperimentID)
	configDirectory := filepath.Join(executor.stateRoot, "jobs", lease.JobID)
	cacheDirectory := filepath.Join(executor.outputRoot, "llmweb", "cache", "huggingface")
	for _, directory := range []string{experimentDirectory, configDirectory, cacheDirectory} {
		if err := os.MkdirAll(directory, 0o750); err != nil {
			return nil, fmt.Errorf("准备本地训练目录: %w", err)
		}
	}
	if lease.Kind == "export" && contains(spec.Formats, "gguf") {
		if err := os.MkdirAll(filepath.Join(experimentDirectory, "gguf"), 0o750); err != nil {
			return nil, fmt.Errorf("准备 GGUF 结果目录: %w", err)
		}
	}

	configPath := filepath.Join(configDirectory, "task.yaml")
	paths := containerRuntimePaths()
	if executor.backend == "native_mps" {
		if spec.Method == "qlora" && lease.Kind != "export" {
			return nil, errors.New("Apple Silicon 当前使用 LoRA 训练；4 位 QLoRA 依赖的 CUDA 量化后端不可用")
		}
		paths = executor.nativeRuntimePaths(datasetDirectory, experimentDirectory, configPath)
	}
	config, command, requiresGPU, err := buildRuntimeConfigForPaths(lease.Kind, spec, paths, executor.backend == "native_mps")
	if executor.backend == "docker_cpu" {
		config, command, requiresGPU, err = buildCPUStarterCommand(lease.Kind, spec, paths)
	}
	if err != nil {
		return nil, err
	}
	if err := atomicWrite(configPath, []byte(config)); err != nil {
		return nil, err
	}
	containerName := containerName(lease.JobID)
	if executor.backend == "native_mps" {
		emit("progress", stageMessage(lease.Kind), map[string]any{"percent": 8})
		if err := executor.runNative(ctx, command, emit); err != nil {
			return nil, err
		}
	} else {
		executor.setContainer(containerName)
		defer executor.setContainer("")

		args := []string{"run", "--name", containerName, "--ipc=host", "--security-opt=no-new-privileges", "--cap-drop=ALL"}
		if requiresGPU {
			args = append(args, "--gpus=all")
		}
		args = append(args,
			"-v", datasetDirectory+":/workspace/data:ro",
			"-v", experimentDirectory+":/workspace/output",
			"-v", configDirectory+":/workspace/config:ro",
			"-v", cacheDirectory+":/root/.cache/huggingface",
			spec.Image,
		)
		args = append(args, command...)

		emit("progress", stageMessage(lease.Kind), map[string]any{"percent": 8})
		if err := runDocker(ctx, containerName, args, emit); err != nil {
			if status, exists := dockerStatus(containerName); exists && status != "running" {
				_ = exec.Command("docker", "rm", containerName).Run()
			}
			return nil, err
		}
		_ = exec.Command("docker", "rm", containerName).Run()
	}
	emit("progress", "本地执行完成，正在整理结果", map[string]any{"percent": 94})

	switch lease.Kind {
	case "baseline":
		return readEvaluationResult(filepath.Join(experimentDirectory, "baseline"), spec.Preview)
	case "evaluate":
		return readEvaluationResult(filepath.Join(experimentDirectory, "evaluation"), spec.Preview)
	case "train":
		if spec.Method == "starter" {
			return readCPUStarterTrainingResult(experimentDirectory)
		}
		checkpoints, err := collectCheckpoints(filepath.Join(experimentDirectory, "adapter"))
		if err != nil {
			return nil, err
		}
		return map[string]any{"adapter_reference": filepath.Join("llmweb", "experiments", spec.ExperimentID, "adapter"), "checkpoints": checkpoints}, nil
	case "export":
		if spec.Destination == "user_s3" {
			if err := executor.uploadArtifacts(ctx, lease.JobID, experimentDirectory, spec, emit); err != nil {
				return nil, err
			}
		}
		artifacts := make([]map[string]any, 0, len(spec.Formats))
		for _, format := range spec.Formats {
			reference := filepath.Join("llmweb", "experiments", spec.ExperimentID, format)
			if format == "adapter" {
				reference = filepath.Join("llmweb", "experiments", spec.ExperimentID, spec.Checkpoint)
			}
			if format == "huggingface" {
				reference = filepath.Join("llmweb", "experiments", spec.ExperimentID, "huggingface")
			}
			if spec.Destination == "user_s3" {
				reference = strings.TrimRight(spec.S3URI, "/") + "/" + format
			}
			artifacts = append(artifacts, map[string]any{"format": format, "reference": reference})
		}
		return map[string]any{"artifacts": artifacts}, nil
	}
	return map[string]any{}, nil
}

func buildCPUStarterCommand(kind string, spec runtimeSpec, paths runtimePaths) (string, []string, bool, error) {
	if !contains([]string{"baseline", "train", "evaluate", "export"}, kind) {
		return "", nil, false, fmt.Errorf("不支持的入门训练阶段 %q", kind)
	}
	command := []string{
		"python", "/opt/llmweb/cpu_starter.py", kind,
		"--data", paths.data,
		"--output", paths.output,
		"--checkpoint", spec.Checkpoint,
		"--iterations", strconv.Itoa(spec.Iterations),
	}
	return "# LLMWEB fixed CPU starter preset.\n", command, false, nil
}

func readCPUStarterTrainingResult(experimentDirectory string) (map[string]any, error) {
	payload, err := os.ReadFile(filepath.Join(experimentDirectory, "training_state.json"))
	if err != nil {
		return nil, fmt.Errorf("读取入门训练结果: %w", err)
	}
	var state struct {
		BestValidationLoss float64 `json:"best_validation_loss"`
		Iterations         int     `json:"iterations"`
	}
	if err := json.Unmarshal(payload, &state); err != nil {
		return nil, fmt.Errorf("解析入门训练结果: %w", err)
	}
	return map[string]any{"checkpoints": []map[string]any{{
		"reference": "model.pt", "label": "效果最好的训练结果", "recommended": true,
		"step": state.Iterations, "validation_loss": state.BestValidationLoss,
	}}}, nil
}

func buildRuntimeConfig(kind string, spec runtimeSpec) (string, []string, bool, error) {
	return buildRuntimeConfigForPaths(kind, spec, containerRuntimePaths(), false)
}

func containerRuntimePaths() runtimePaths {
	return runtimePaths{
		data: "/workspace/data", output: "/workspace/output", config: "/workspace/config/task.yaml",
		python: "python", evaluator: "/opt/llmweb/evaluate.py", llamaConvert: "/opt/llama.cpp/convert_hf_to_gguf.py", cli: "llamafactory-cli",
	}
}

func (executor *Executor) nativeRuntimePaths(datasetDirectory, experimentDirectory, configPath string) runtimePaths {
	return runtimePaths{
		data: datasetDirectory, output: experimentDirectory, config: configPath,
		python:       filepath.Join(executor.runtimeRoot, "bin", "python"),
		evaluator:    filepath.Join(executor.runtimeRoot, "llmweb", "evaluate.py"),
		llamaConvert: filepath.Join(executor.runtimeRoot, "llama.cpp", "convert_hf_to_gguf.py"),
		cli:          filepath.Join(executor.runtimeRoot, "bin", "llamafactory-cli"),
	}
}

func buildRuntimeConfigForPaths(kind string, spec runtimeSpec, paths runtimePaths, mps bool) (string, []string, bool, error) {
	quote := strconv.Quote
	base := "model_name_or_path: " + quote(spec.ModelID) + "\n" +
		"model_revision: " + quote(spec.Revision) + "\n" +
		"trust_remote_code: false\n" +
		"stage: sft\n" +
		"finetuning_type: lora\n" +
		"template: " + quote(spec.Template) + "\n" +
		"dataset_dir: " + quote(paths.data) + "\n" +
		"cutoff_len: " + strconv.Itoa(spec.MaxLength) + "\n" +
		"overwrite_cache: false\n" +
		"preprocessing_num_workers: " + map[bool]string{true: "1", false: "4"}[mps] + "\n" +
		"report_to: none\n"
	if spec.Method == "qlora" && kind != "export" {
		base += "quantization_bit: 4\nquantization_method: bitsandbytes\n"
	}
	switch kind {
	case "train":
		config := base +
			"do_train: true\n" +
			"dataset: llmweb_train\n" +
			"eval_dataset: llmweb_validation\n" +
			"output_dir: " + quote(filepath.Join(paths.output, "adapter")) + "\n" +
			"per_device_train_batch_size: " + strconv.Itoa(spec.BatchSize) + "\n" +
			"per_device_eval_batch_size: 1\n" +
			"gradient_accumulation_steps: " + strconv.Itoa(spec.Accumulation) + "\n" +
			"learning_rate: " + strconv.FormatFloat(spec.LearningRate, 'g', -1, 64) + "\n" +
			"num_train_epochs: " + strconv.FormatFloat(spec.Epochs, 'g', -1, 64) + "\n" +
			"lr_scheduler_type: cosine\n" +
			"warmup_ratio: 0.1\n" +
			"logging_steps: 1\n" +
			"save_strategy: epoch\n" +
			"eval_strategy: epoch\n" +
			"load_best_model_at_end: true\n" +
			"plot_loss: true\n" +
			"fp16: true\n" +
			"overwrite_output_dir: true\n"
		return config, []string{paths.cli, "train", paths.config}, true, nil
	case "baseline", "evaluate":
		outputName := "baseline"
		adapterArgs := []string{}
		if kind == "evaluate" {
			outputName = "evaluation"
			adapterArgs = []string{"--adapter", filepath.Join(paths.output, spec.Checkpoint)}
		}
		command := []string{paths.python, paths.evaluator, "--model", spec.ModelID, "--revision", spec.Revision, "--data", filepath.Join(paths.data, "test.json"), "--output", filepath.Join(paths.output, outputName)}
		command = append(command, adapterArgs...)
		if spec.Method == "qlora" {
			command = append(command, "--quantization", "4")
		}
		return "# Evaluation uses the pinned LLMWEB evaluator.\n", command, true, nil
	case "export":
		needsMerged := contains(spec.Formats, "huggingface") || contains(spec.Formats, "gguf")
		if !needsMerged {
			if !mps {
				return "# Adapter already produced by training.\n", []string{"/bin/sh", "-c", "test -d /workspace/output/adapter"}, false, nil
			}
			return "# Adapter already produced by training.\n", []string{"/usr/bin/test", "-d", filepath.Join(paths.output, "adapter")}, false, nil
		}
		config := base +
			"adapter_name_or_path: " + quote(filepath.Join(paths.output, spec.Checkpoint)) + "\n" +
			"export_dir: " + quote(filepath.Join(paths.output, "huggingface")) + "\n" +
			"export_size: 2\n" +
			"export_device: cpu\n" +
			"export_legacy_format: false\n"
		if contains(spec.Formats, "gguf") {
			command := shellQuote(paths.cli) + " export " + shellQuote(paths.config) + " && " + shellQuote(paths.python) + " " + shellQuote(paths.llamaConvert) + " " + shellQuote(filepath.Join(paths.output, "huggingface")) + " --outfile " + shellQuote(filepath.Join(paths.output, "gguf", "model-f16.gguf")) + " --outtype f16"
			return config, []string{"/bin/sh", "-c", command}, false, nil
		}
		return config, []string{paths.cli, "export", paths.config}, false, nil
	default:
		return "", nil, false, fmt.Errorf("不支持的训练阶段 %q", kind)
	}
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func runDocker(ctx context.Context, containerName string, args []string, emit EmitFunc) error {
	status, exists := dockerStatus(containerName)
	if exists && status == "running" {
		return followExistingContainer(ctx, containerName, emit)
	}
	if exists && status == "exited" {
		return finishExistingContainer(containerName, emit)
	}
	command := exec.CommandContext(ctx, "docker", args...)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return fmt.Errorf("读取训练输出: %w", err)
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return fmt.Errorf("读取训练错误: %w", err)
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("启动训练容器: %w", err)
	}
	done := make(chan struct{}, 2)
	go streamLogs(stdout, emit, done)
	go streamLogs(stderr, emit, done)
	err = command.Wait()
	<-done
	<-done
	if err != nil {
		return fmt.Errorf("训练容器执行失败: %w", err)
	}
	return nil
}

func streamLogs(reader io.Reader, emit EmitFunc, done chan<- struct{}) {
	defer func() { done <- struct{}{} }()
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
	lastSent := time.Time{}
	for scanner.Scan() {
		line := sanitizeLog(scanner.Text())
		if line == "" {
			continue
		}
		now := time.Now()
		if now.Sub(lastSent) >= 500*time.Millisecond || strings.Contains(line, "loss") || strings.Contains(line, "error") {
			emit("log", line, parseTrainingMetric(line))
			lastSent = now
		}
	}
}

func dockerStatus(name string) (string, bool) {
	output, err := exec.Command("docker", "inspect", "--format", "{{.State.Status}}", name).Output()
	if err != nil {
		return "", false
	}
	return strings.TrimSpace(string(output)), true
}

func followExistingContainer(ctx context.Context, name string, emit EmitFunc) error {
	emit("log", "已接续主机重启前的本地训练", map[string]any{})
	logs := exec.CommandContext(ctx, "docker", "logs", "--follow", name)
	stdout, _ := logs.StdoutPipe()
	stderr, _ := logs.StderrPipe()
	if err := logs.Start(); err == nil {
		done := make(chan struct{}, 2)
		go streamLogs(stdout, emit, done)
		go streamLogs(stderr, emit, done)
		_ = logs.Wait()
		<-done
		<-done
	}
	wait := exec.CommandContext(ctx, "docker", "wait", name)
	output, err := wait.Output()
	if err != nil {
		return fmt.Errorf("等待已恢复的训练容器: %w", err)
	}
	if strings.TrimSpace(string(output)) != "0" {
		return fmt.Errorf("已恢复的训练容器退出码为 %s", strings.TrimSpace(string(output)))
	}
	return nil
}

func finishExistingContainer(name string, emit EmitFunc) error {
	logs, _ := exec.Command("docker", "logs", "--tail", "200", name).Output()
	for _, line := range strings.Split(string(logs), "\n") {
		if clean := sanitizeLog(line); clean != "" {
			emit("log", clean, parseTrainingMetric(clean))
		}
	}
	exitCode, err := exec.Command("docker", "inspect", "--format", "{{.State.ExitCode}}", name).Output()
	if err != nil {
		return fmt.Errorf("读取训练容器结果: %w", err)
	}
	if strings.TrimSpace(string(exitCode)) != "0" {
		return fmt.Errorf("训练容器退出码为 %s", strings.TrimSpace(string(exitCode)))
	}
	return nil
}

func readEvaluationResult(directory string, previewAllowed bool) (map[string]any, error) {
	metricsPayload, err := os.ReadFile(filepath.Join(directory, "metrics.json"))
	if err != nil {
		return nil, fmt.Errorf("读取评测结果: %w", err)
	}
	var metrics map[string]any
	if err := json.Unmarshal(metricsPayload, &metrics); err != nil {
		return nil, fmt.Errorf("解析评测指标: %w", err)
	}
	result := map[string]any{"metrics": metrics}
	if !previewAllowed {
		return result, nil
	}
	file, err := os.Open(filepath.Join(directory, "predictions.jsonl"))
	if err != nil {
		return nil, fmt.Errorf("读取授权的评测预览: %w", err)
	}
	defer file.Close()
	preview := make([]map[string]any, 0, 3)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	for scanner.Scan() && len(preview) < 3 {
		var row map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
			continue
		}
		preview = append(preview, row)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("读取授权的评测预览: %w", err)
	}
	result["preview"] = preview
	return result, nil
}

var metricPattern = regexp.MustCompile(`['"]?(loss|eval_loss|learning_rate|epoch)['"]?\s*[:=]\s*([0-9.eE+-]+)`)

func parseTrainingMetric(line string) map[string]any {
	metrics := map[string]any{}
	for _, match := range metricPattern.FindAllStringSubmatch(line, -1) {
		if value, err := strconv.ParseFloat(match[2], 64); err == nil {
			metrics[match[1]] = value
		}
	}
	return metrics
}

func parseRuntimeSpec(payload map[string]any) (runtimeSpec, error) {
	model := anyMap(payload["model"])
	training := anyMap(payload["training"])
	runtime := anyMap(payload["runtime"])
	output := anyMap(payload["output"])
	spec := runtimeSpec{
		ExperimentID: stringValue(payload, "experiment_id"),
		DatasetID:    stringValue(payload, "dataset_id"),
		ModelID:      stringValue(model, "id"),
		Revision:     stringValue(model, "revision"),
		Template:     stringValue(model, "template"),
		Method:       stringValue(training, "method"),
		Epochs:       numberValue(training, "epochs", 3),
		LearningRate: numberValue(training, "learning_rate", 0.0002),
		MaxLength:    int(numberValue(training, "max_length", 2048)),
		BatchSize:    int(numberValue(training, "batch_size", 1)),
		Accumulation: int(numberValue(training, "gradient_accumulation", 8)),
		Iterations:   int(numberValue(training, "iterations", 500)),
		Formats:      stringSlice(output["formats"]),
		Image:        stringValue(runtime, "image"),
		Preview:      boolValue(output, "preview_allowed"),
		Checkpoint:   stringValue(payload, "selected_checkpoint"),
		Destination:  stringValue(output, "destination"),
		S3URI:        stringValue(output, "s3_uri"),
		S3Endpoint:   stringValue(output, "s3_endpoint"),
	}
	if spec.ExperimentID == "" || spec.DatasetID == "" || spec.ModelID == "" {
		return runtimeSpec{}, errors.New("训练任务缺少实验、数据或模型信息")
	}
	if approvedModels[spec.ModelID] != spec.Revision {
		return runtimeSpec{}, errors.New("基础模型或版本不在首版批准范围内")
	}
	if spec.Method != "starter" && (spec.Template == "default" || spec.Template == "") {
		return runtimeSpec{}, fmt.Errorf("暂时无法为模型 %q 自动确定对话模板，请改用 Qwen、Llama 3、Mistral 或 Gemma 指令模型", spec.ModelID)
	}
	if spec.Checkpoint == "" {
		if spec.Method == "starter" {
			spec.Checkpoint = "model.pt"
		} else {
			spec.Checkpoint = "adapter"
		}
	}
	validStarterCheckpoint := spec.Method == "starter" && spec.Checkpoint == "model.pt"
	if !validStarterCheckpoint && spec.Checkpoint != "adapter" && (!strings.HasPrefix(spec.Checkpoint, "adapter/checkpoint-") || strings.Contains(spec.Checkpoint, "..")) {
		return runtimeSpec{}, errors.New("选择的模型版本引用无效")
	}
	if spec.Destination == "" {
		spec.Destination = "local"
	}
	if spec.Destination == "user_s3" && !strings.HasPrefix(spec.S3URI, "s3://") {
		return runtimeSpec{}, errors.New("S3 产物目标无效")
	}
	return spec, nil
}

func (executor *Executor) uploadArtifacts(ctx context.Context, jobID, experimentDirectory string, spec runtimeSpec, emit EmitFunc) error {
	if executor.backend == "native_mps" {
		command := []string{
			filepath.Join(executor.runtimeRoot, "bin", "python"),
			filepath.Join(executor.runtimeRoot, "llmweb", "upload_artifacts.py"),
			"--source", experimentDirectory,
			"--destination", spec.S3URI,
			"--formats", strings.Join(spec.Formats, ","),
			"--checkpoint", spec.Checkpoint,
		}
		if spec.S3Endpoint != "" {
			command = append(command, "--endpoint", spec.S3Endpoint)
		}
		emit("progress", "正在把模型产物保存到你的对象存储", map[string]any{"percent": 96})
		return executor.runNative(ctx, command, emit)
	}
	container := containerName(jobID) + "-upload"
	args := []string{
		"run", "--name", container,
		"--security-opt=no-new-privileges", "--cap-drop=ALL",
		"-v", experimentDirectory + ":/workspace/output:ro",
	}
	for _, variable := range []string{"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_DEFAULT_REGION"} {
		if os.Getenv(variable) != "" {
			args = append(args, "-e", variable)
		}
	}
	args = append(args, approvedRuntimeImage,
		"python", "/opt/llmweb/upload_artifacts.py",
		"--source", "/workspace/output",
		"--destination", spec.S3URI,
		"--formats", strings.Join(spec.Formats, ","),
		"--checkpoint", spec.Checkpoint,
	)
	if spec.S3Endpoint != "" {
		args = append(args, "--endpoint", spec.S3Endpoint)
	}
	emit("progress", "正在把模型产物保存到你的对象存储", map[string]any{"percent": 96})
	if err := runDocker(ctx, container, args, emit); err != nil {
		if status, exists := dockerStatus(container); exists && status != "running" {
			_ = exec.Command("docker", "rm", container).Run()
		}
		return err
	}
	_ = exec.Command("docker", "rm", container).Run()
	return nil
}

func collectCheckpoints(adapterDirectory string) ([]map[string]any, error) {
	entries, err := os.ReadDir(adapterDirectory)
	if err != nil {
		return nil, fmt.Errorf("读取训练产生的模型版本: %w", err)
	}
	validationLoss := map[int]float64{}
	bestReference := "adapter"
	statePayload, stateErr := os.ReadFile(filepath.Join(adapterDirectory, "trainer_state.json"))
	if stateErr == nil {
		var state struct {
			BestModelCheckpoint string `json:"best_model_checkpoint"`
			LogHistory          []struct {
				Step     int      `json:"step"`
				EvalLoss *float64 `json:"eval_loss"`
			} `json:"log_history"`
		}
		if json.Unmarshal(statePayload, &state) == nil {
			if marker := "checkpoint-"; strings.Contains(state.BestModelCheckpoint, marker) {
				bestReference = "adapter/" + state.BestModelCheckpoint[strings.LastIndex(state.BestModelCheckpoint, marker):]
			}
			for _, item := range state.LogHistory {
				if item.EvalLoss != nil {
					validationLoss[item.Step] = *item.EvalLoss
				}
			}
		}
	}
	checkpoints := []map[string]any{{"reference": "adapter", "label": "训练完成结果", "recommended": bestReference == "adapter"}}
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "checkpoint-") {
			continue
		}
		step, err := strconv.Atoi(strings.TrimPrefix(entry.Name(), "checkpoint-"))
		if err != nil {
			continue
		}
		reference := "adapter/" + entry.Name()
		item := map[string]any{"reference": reference, "label": fmt.Sprintf("训练进度 %d", step), "recommended": reference == bestReference, "step": step}
		if loss, exists := validationLoss[step]; exists {
			item["validation_loss"] = loss
		}
		checkpoints = append(checkpoints, item)
	}
	sort.SliceStable(checkpoints[1:], func(left, right int) bool {
		return checkpoints[left+1]["step"].(int) < checkpoints[right+1]["step"].(int)
	})
	return checkpoints, nil
}

func anyMap(value any) map[string]any {
	result, _ := value.(map[string]any)
	return result
}

func numberValue(payload map[string]any, key string, fallback float64) float64 {
	value, ok := payload[key].(float64)
	if !ok {
		return fallback
	}
	return value
}

func stringSlice(value any) []string {
	items, _ := value.([]any)
	result := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			result = append(result, text)
		}
	}
	return result
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func containerName(jobID string) string {
	clean := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, jobID)
	return "llmweb-" + clean
}

func stageMessage(kind string) string {
	switch kind {
	case "baseline":
		return "正在建立基础模型基线"
	case "train":
		return "正在训练模型"
	case "evaluate":
		return "正在用同一测试集复测"
	case "export":
		return "正在生成模型产物"
	default:
		return "正在执行"
	}
}

func atomicWrite(path string, content []byte) error {
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, content, 0o640); err != nil {
		return fmt.Errorf("写入训练配置: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		return fmt.Errorf("保存训练配置: %w", err)
	}
	return nil
}
