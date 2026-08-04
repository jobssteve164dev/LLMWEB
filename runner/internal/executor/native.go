package executor

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"syscall"
)

func (executor *Executor) runNative(ctx context.Context, command []string, emit EmitFunc) error {
	if len(command) == 0 {
		return fmt.Errorf("原生训练命令为空")
	}
	process := exec.CommandContext(ctx, command[0], command[1:]...)
	process.Env = append(os.Environ(), "PYTORCH_ENABLE_MPS_FALLBACK=1")
	process.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdout, err := process.StdoutPipe()
	if err != nil {
		return fmt.Errorf("读取原生训练输出: %w", err)
	}
	stderr, err := process.StderrPipe()
	if err != nil {
		return fmt.Errorf("读取原生训练错误: %w", err)
	}
	if err := process.Start(); err != nil {
		return fmt.Errorf("启动 Apple Silicon 训练: %w", err)
	}
	executor.setProcess(process.Process)
	defer executor.setProcess(nil)
	done := make(chan struct{}, 2)
	go streamLogs(stdout, emit, done)
	go streamLogs(stderr, emit, done)
	err = process.Wait()
	<-done
	<-done
	if err != nil {
		return fmt.Errorf("Apple Silicon 训练执行失败: %w", err)
	}
	return nil
}

func controlNativeProcess(process *os.Process, action string) error {
	var signal syscall.Signal
	switch action {
	case "paused":
		signal = syscall.SIGSTOP
	case "running":
		signal = syscall.SIGCONT
	case "cancelled":
		signal = syscall.SIGTERM
	default:
		return fmt.Errorf("不支持的任务控制动作 %q", action)
	}
	if err := syscall.Kill(-process.Pid, signal); err != nil && err != syscall.ESRCH {
		return fmt.Errorf("控制 Apple Silicon 训练进程: %w", err)
	}
	return nil
}
