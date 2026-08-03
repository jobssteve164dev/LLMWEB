package capabilities

import (
	"context"
	"encoding/csv"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

type GPU struct {
	Name               string `json:"name"`
	MemoryTotalMB      int    `json:"memory_total_mb"`
	MemoryFreeMB       int    `json:"memory_free_mb"`
	UtilizationPercent int    `json:"utilization_percent"`
	TemperatureC       int    `json:"temperature_c"`
}

type Report struct {
	OperatingSystem string `json:"operating_system"`
	Architecture    string `json:"architecture"`
	DockerAvailable bool   `json:"docker_available"`
	NvidiaAvailable bool   `json:"nvidia_available"`
	GPUs            []GPU  `json:"gpus"`
}

type commandLookup func(string) (string, error)

func Probe(ctx context.Context) Report {
	report := probe(exec.LookPath)
	if report.DockerAvailable {
		command := exec.CommandContext(ctx, "docker", "info", "--format", "{{.ServerVersion}}")
		report.DockerAvailable = command.Run() == nil
	}
	if report.NvidiaAvailable {
		report.GPUs = probeGPUs(ctx)
	}
	return report
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
	_, dockerErr := lookup("docker")
	_, nvidiaErr := lookup("nvidia-smi")

	return Report{
		OperatingSystem: runtime.GOOS,
		Architecture:    runtime.GOARCH,
		DockerAvailable: dockerErr == nil,
		NvidiaAvailable: nvidiaErr == nil,
	}
}

func (report Report) Ready() bool {
	return report.OperatingSystem == "linux" && report.Architecture == "amd64" && report.DockerAvailable && report.NvidiaAvailable && len(report.GPUs) > 0
}
