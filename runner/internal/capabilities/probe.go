package capabilities

import (
	"context"
	"encoding/csv"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

type GPU struct {
	Name               string `json:"name"`
	MemoryTotalMB      int    `json:"memory_total_mb"`
	MemoryFreeMB       int    `json:"memory_free_mb"`
	UtilizationPercent int    `json:"utilization_percent"`
	TemperatureC       int    `json:"temperature_c"`
	SharedMemory       bool   `json:"shared_memory,omitempty"`
}

type Report struct {
	OperatingSystem    string `json:"operating_system"`
	Architecture       string `json:"architecture"`
	Backend            string `json:"backend"`
	CPUCores           int    `json:"cpu_cores"`
	MemoryTotalMB      int    `json:"memory_total_mb"`
	DiskTotalMB        int    `json:"disk_total_mb"`
	DiskFreeMB         int    `json:"disk_free_mb"`
	EnvironmentVersion string `json:"training_environment_version,omitempty"`
	DockerAvailable    bool   `json:"docker_available"`
	NvidiaAvailable    bool   `json:"nvidia_available"`
	MPSAvailable       bool   `json:"mps_available"`
	GPUs               []GPU  `json:"gpus"`
}

type commandLookup func(string) (string, error)

func Probe(ctx context.Context) Report {
	report := probe(exec.LookPath)
	report.CPUCores = runtime.NumCPU()
	report.MemoryTotalMB = probeMemoryTotalMB()
	report.DiskTotalMB, report.DiskFreeMB = probeDiskMB("/")
	report.EnvironmentVersion = os.Getenv("LLMWEB_TRAINING_ENVIRONMENT_VERSION")
	if report.DockerAvailable {
		command := exec.CommandContext(ctx, "docker", "info", "--format", "{{.ServerVersion}}")
		report.DockerAvailable = command.Run() == nil
	}
	if report.NvidiaAvailable {
		report.GPUs = probeGPUs(ctx)
		if len(report.GPUs) == 0 && report.OperatingSystem == "linux" && report.Architecture == "amd64" {
			report.Backend = "docker_cpu"
		}
	}
	if report.OperatingSystem == "darwin" && report.Architecture == "arm64" {
		report.MPSAvailable = probeMPS(ctx)
		if report.MPSAvailable {
			report.GPUs = probeAppleSilicon(ctx)
		}
	}
	return report
}

func probeDiskMB(path string) (int, int) {
	var stats syscall.Statfs_t
	if err := syscall.Statfs(path, &stats); err != nil {
		return 0, 0
	}
	return int(uint64(stats.Blocks) * uint64(stats.Bsize) / 1024 / 1024), int(uint64(stats.Bavail) * uint64(stats.Bsize) / 1024 / 1024)
}

func probeMemoryTotalMB() int {
	if runtime.GOOS != "linux" {
		return 0
	}
	payload, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(payload), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == "MemTotal:" {
			if kilobytes, parseErr := strconv.Atoi(fields[1]); parseErr == nil {
				return kilobytes / 1024
			}
		}
	}
	return 0
}

func probeMPS(ctx context.Context) bool {
	python := "python3"
	if root := os.Getenv("LLMWEB_RUNTIME_ROOT"); root != "" {
		python = filepath.Join(root, "bin", "python")
	}
	command := exec.CommandContext(ctx, python, "-c", "import torch; raise SystemExit(0 if torch.backends.mps.is_available() else 1)")
	return command.Run() == nil
}

func probeAppleSilicon(ctx context.Context) []GPU {
	name := "Apple Silicon"
	if output, err := exec.CommandContext(ctx, "sysctl", "-n", "machdep.cpu.brand_string").Output(); err == nil && strings.TrimSpace(string(output)) != "" {
		name = strings.TrimSpace(string(output))
	}
	memoryMB := 0
	if output, err := exec.CommandContext(ctx, "sysctl", "-n", "hw.memsize").Output(); err == nil {
		if bytes, parseErr := strconv.ParseInt(strings.TrimSpace(string(output)), 10, 64); parseErr == nil {
			memoryMB = int(bytes / 1024 / 1024)
		}
	}
	return []GPU{{Name: name + " GPU", MemoryTotalMB: memoryMB, MemoryFreeMB: memoryMB, SharedMemory: true}}
}

func probeGPUs(ctx context.Context) []GPU {
	command := exec.CommandContext(ctx, "nvidia-smi", "--query-gpu=name,memory.total,memory.free,utilization.gpu,temperature.gpu", "--format=csv,noheader,nounits")
	output, err := command.Output()
	if err != nil {
		return nil
	}
	reader := csv.NewReader(strings.NewReader(string(output)))
	records, err := reader.ReadAll()
	if err != nil {
		return nil
	}
	gpus := make([]GPU, 0, len(records))
	for _, record := range records {
		if len(record) != 5 {
			continue
		}
		total, totalErr := strconv.Atoi(strings.TrimSpace(record[1]))
		free, freeErr := strconv.Atoi(strings.TrimSpace(record[2]))
		utilization, utilizationErr := strconv.Atoi(strings.TrimSpace(record[3]))
		temperature, temperatureErr := strconv.Atoi(strings.TrimSpace(record[4]))
		if totalErr != nil || freeErr != nil || utilizationErr != nil || temperatureErr != nil {
			continue
		}
		gpus = append(gpus, GPU{Name: strings.TrimSpace(record[0]), MemoryTotalMB: total, MemoryFreeMB: free, UtilizationPercent: utilization, TemperatureC: temperature})
	}
	return gpus
}

func probe(lookup commandLookup) Report {
	return probeFor(runtime.GOOS, runtime.GOARCH, lookup)
}

func probeFor(operatingSystem, architecture string, lookup commandLookup) Report {
	_, dockerErr := lookup("docker")
	_, nvidiaErr := lookup("nvidia-smi")

	backend := backendFor(operatingSystem, architecture)
	if operatingSystem == "linux" && architecture == "amd64" && nvidiaErr != nil {
		backend = "docker_cpu"
	}
	return Report{
		OperatingSystem: operatingSystem,
		Architecture:    architecture,
		Backend:         backend,
		DockerAvailable: dockerErr == nil,
		NvidiaAvailable: nvidiaErr == nil,
	}
}

func backendFor(operatingSystem, architecture string) string {
	if operatingSystem == "darwin" && architecture == "arm64" {
		return "native_mps"
	}
	return "docker_cuda"
}

func (report Report) Ready() bool {
	if report.Backend == "native_mps" {
		return report.OperatingSystem == "darwin" && report.Architecture == "arm64" && report.MPSAvailable && len(report.GPUs) > 0
	}
	if report.Backend == "docker_cpu" {
		return report.OperatingSystem == "linux" && report.Architecture == "amd64" && report.DockerAvailable
	}
	return report.OperatingSystem == "linux" && report.Architecture == "amd64" && report.DockerAvailable && report.NvidiaAvailable && len(report.GPUs) > 0
}
