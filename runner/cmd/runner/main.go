package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"llmweb/runner/internal/capabilities"
	"llmweb/runner/internal/controlplane"
	"llmweb/runner/internal/localstate"
	"llmweb/runner/internal/worker"
)

const version = "0.2.0"

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(2)
	}

	var err error
	switch os.Args[1] {
	case "doctor":
		err = runDoctor()
	case "register":
		err = runConnect(os.Args[2:], true)
	case "authorize-upgrade":
		err = runAuthorizeUpgrade(os.Args[2:])
	case "connect":
		err = runConnect(os.Args[2:], false)
	case "version":
		fmt.Println(version)
	default:
		printUsage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "llmweb-runner: %v\n", err)
		os.Exit(1)
	}
}

func runAuthorizeUpgrade(arguments []string) error {
	flags := flag.NewFlagSet("authorize-upgrade", flag.ContinueOnError)
	controlURL := flags.String("url", "", "LLMWEB 控制面地址")
	codeFile := flags.String("code-file", "", "包含一次性配对码的受保护文件")
	stateRoot := flags.String("state-dir", ".runner/llmweb", "Runner 本地状态目录")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if *controlURL == "" || *codeFile == "" {
		return errors.New("升级授权需要同时提供 --url 和 --code-file")
	}
	pairingCode, err := readPairingCodeFile(*codeFile)
	if err != nil {
		return fmt.Errorf("读取配对码文件: %w", err)
	}
	state, err := localstate.New(*stateRoot).Load()
	if err != nil {
		return err
	}
	if state.DeviceToken == "" || state.ControlURL == "" {
		return errors.New("本地 Runner 身份不完整，不能原位升级")
	}
	if strings.TrimRight(state.ControlURL, "/") != strings.TrimRight(*controlURL, "/") {
		return errors.New("本地 Runner 属于另一个控制面，不能原位升级")
	}
	if err := controlplane.New(state.ControlURL, state.DeviceToken).AuthorizeUpgrade(context.Background(), pairingCode); err != nil {
		return fmt.Errorf("确认原工作区升级授权: %w", err)
	}
	fmt.Println("已确认原工作区升级授权")
	return nil
}

func runDoctor() error {
	report := capabilities.Probe(context.Background())
	payload := struct {
		capabilities.Report
		Ready bool `json:"ready"`
	}{Report: report, Ready: report.Ready()}

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(payload); err != nil {
		return fmt.Errorf("输出检查结果: %w", err)
	}
	return nil
}

func runConnect(arguments []string, registerOnly bool) error {
	flags := flag.NewFlagSet("connect", flag.ContinueOnError)
	controlURL := flags.String("url", "", "LLMWEB 控制面地址")
	code := flags.String("code", "", "网页生成的一次性配对码")
	codeFile := flags.String("code-file", "", "包含一次性配对码的受保护文件")
	dataRoot := flags.String("data-root", "", "允许 LLMWEB 读取的本地数据目录")
	outputRoot := flags.String("output-root", "", "模型与数据版本的本地保存目录")
	stateRoot := flags.String("state-dir", ".runner/llmweb", "Runner 本地状态目录")
	name, _ := os.Hostname()
	runnerName := flags.String("name", name, "网页显示的算力名称")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if *code != "" && *codeFile != "" {
		return errors.New("--code 与 --code-file 不能同时使用")
	}
	pairingCode := *code
	if *codeFile != "" {
		fileCode, err := readPairingCodeFile(*codeFile)
		if err != nil {
			return fmt.Errorf("读取配对码文件: %w", err)
		}
		pairingCode = fileCode
	}
	store := localstate.New(*stateRoot)
	state, err := store.Load()
	if err != nil {
		return err
	}
	report := capabilities.Probe(context.Background())
	if !report.Ready() {
		return errors.New("当前主机尚未满足运行要求；需要 Linux x86_64 + Docker，或 Apple Silicon Mac + 可用的 Metal/MPS 训练环境。请先运行 doctor 查看检查结果")
	}

	if state.DeviceToken == "" {
		if *controlURL == "" || pairingCode == "" || *dataRoot == "" || *outputRoot == "" {
			return errors.New("首次连接需要同时提供 --url、配对码、--data-root 和 --output-root")
		}
		dataPath, err := existingDirectory(*dataRoot)
		if err != nil {
			return fmt.Errorf("数据目录不可用: %w", err)
		}
		outputPath, err := writableDirectory(*outputRoot)
		if err != nil {
			return fmt.Errorf("结果目录不可用: %w", err)
		}
		pairing, err := controlplane.Pair(context.Background(), *controlURL, pairingCode, *runnerName, report)
		if err != nil {
			return fmt.Errorf("连接算力: %w", err)
		}
		state = localstate.State{
			RunnerID: pairing.RunnerID, DeviceToken: pairing.DeviceToken,
			ControlURL: *controlURL, Name: *runnerName, DataRoot: dataPath, OutputRoot: outputPath,
		}
		if err := store.Save(state); err != nil {
			return err
		}
		fmt.Printf("算力已连接：%s\n", state.Name)
	}
	if registerOnly {
		fmt.Printf("算力身份已注册：%s\n", state.Name)
		return nil
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return worker.New(store, state, report).Run(ctx)
}

func readPairingCodeFile(path string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("配对码路径必须是普通文件且不能是符号链接")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return "", errors.New("配对码文件不能向所属用户以外开放")
	}
	if info.Size() <= 0 || info.Size() > 4096 {
		return "", errors.New("配对码文件大小无效")
	}
	value, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	code := strings.TrimSpace(string(value))
	if code == "" || strings.ContainsAny(code, "\r\n\x00") {
		return "", errors.New("配对码文件内容无效")
	}
	return code, nil
}

func existingDirectory(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%q 不是目录", path)
	}
	return absolute, nil
}

func writableDirectory(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(absolute, 0o750); err != nil {
		return "", err
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%q 不是目录", path)
	}
	return absolute, nil
}

func printUsage() {
	fmt.Fprintln(os.Stderr, "usage: llmweb-runner <doctor|register|authorize-upgrade|connect|version>")
}
