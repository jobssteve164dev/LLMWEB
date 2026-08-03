package capabilities

import (
	"context"
	"os/exec"
	"runtime"
)

type Report struct {
	OperatingSystem string `json:"operating_system"`
	Architecture    string `json:"architecture"`
	DockerAvailable bool   `json:"docker_available"`
	NvidiaAvailable bool   `json:"nvidia_available"`
}

type commandLookup func(string) (string, error)

func Probe(_ context.Context) Report {
	return probe(exec.LookPath)
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
	return report.OperatingSystem == "linux" && report.DockerAvailable && report.NvidiaAvailable
}
