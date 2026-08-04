package executor

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"

	"llmweb/runner/internal/controlplane"
)

type EmitFunc func(eventType, message string, payload map[string]any)

type Executor struct {
	dataRoot    string
	outputRoot  string
	stateRoot   string
	backend     string
	runtimeRoot string
	mu          sync.Mutex
	container   string
	process     *os.Process
}

func New(dataRoot, outputRoot, stateRoot string, backend ...string) *Executor {
	selectedBackend := "docker_cuda"
	if len(backend) > 0 && backend[0] != "" {
		selectedBackend = backend[0]
	}
	return &Executor{dataRoot: dataRoot, outputRoot: outputRoot, stateRoot: stateRoot, backend: selectedBackend, runtimeRoot: os.Getenv("LLMWEB_RUNTIME_ROOT")}
}

func (executor *Executor) Run(ctx context.Context, lease controlplane.Lease, emit EmitFunc) (map[string]any, error) {
	if stringValue(lease.Payload, "schema_version") != "1.0" {
		return nil, fmt.Errorf("不支持的任务协议版本")
	}
	emit("progress", "任务已在本地环境开始", map[string]any{"percent": 2})
	switch lease.Kind {
	case "inspect":
		var result map[string]any
		var err error
		if sourceType := stringValue(lease.Payload, "source_type"); sourceType != "" && sourceType != "local" {
			result, err = executor.prepareAndInspect(ctx, lease, emit)
		} else {
			result, err = inspectDataset(lease.Payload, executor.dataRoot, executor.outputRoot)
		}
		if err == nil {
			emit("progress", "数据版本已准备完成", map[string]any{"percent": 100})
		}
		return result, err
	case "baseline", "train", "evaluate", "export":
		return executor.runRuntime(ctx, lease, emit)
	default:
		return nil, fmt.Errorf("不支持的任务类型 %q", lease.Kind)
	}
}

func (executor *Executor) Control(action string) error {
	executor.mu.Lock()
	container := executor.container
	process := executor.process
	executor.mu.Unlock()
	if container == "" && process == nil {
		return nil
	}
	if process != nil {
		return controlNativeProcess(process, action)
	}
	var command *exec.Cmd
	switch action {
	case "paused":
		command = exec.Command("docker", "pause", container)
	case "running":
		command = exec.Command("docker", "unpause", container)
	case "cancelled":
		command = exec.Command("docker", "stop", "--time", "30", container)
	default:
		return fmt.Errorf("不支持的任务控制动作 %q", action)
	}
	if output, err := command.CombinedOutput(); err != nil {
		message := sanitizeLog(string(output))
		if strings.Contains(message, "No such container") || strings.Contains(message, "is not paused") {
			return nil
		}
		return fmt.Errorf("控制训练容器: %s", message)
	}
	return nil
}

func (executor *Executor) setContainer(name string) {
	executor.mu.Lock()
	executor.container = name
	executor.mu.Unlock()
}

func (executor *Executor) setProcess(process *os.Process) {
	executor.mu.Lock()
	executor.process = process
	executor.mu.Unlock()
}

var secretPattern = regexp.MustCompile(`(?i)(token|secret|password|authorization|api[_-]?key)(\s*[:=]\s*)\S+`)

func sanitizeLog(value string) string {
	value = secretPattern.ReplaceAllString(value, "$1$2[已隐藏]")
	value = strings.ReplaceAll(value, executorHome(value), "[本地目录]")
	return strings.TrimSpace(value)
}

func executorHome(value string) string {
	// Avoid surfacing host paths in uploaded logs. The exact home is replaced by the caller when present.
	if strings.Contains(value, "/home/") {
		parts := strings.Split(value, "/")
		if len(parts) > 2 {
			return "/home/" + parts[2]
		}
	}
	return "\x00"
}
