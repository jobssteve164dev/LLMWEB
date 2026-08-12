package capabilities

import (
	"errors"
	"testing"
)

func TestProbeReportsAvailableCommands(t *testing.T) {
	report := probe(func(name string) (string, error) {
		return "/usr/bin/" + name, nil
	})

	if !report.DockerAvailable {
		t.Fatal("expected Docker to be available")
	}
	if !report.NvidiaAvailable {
		t.Fatal("expected NVIDIA tooling to be available")
	}
}

func TestProbeReportsMissingCommands(t *testing.T) {
	report := probe(func(string) (string, error) {
		return "", errors.New("not found")
	})

	if report.DockerAvailable {
		t.Fatal("expected Docker to be unavailable")
	}
	if report.NvidiaAvailable {
		t.Fatal("expected NVIDIA tooling to be unavailable")
	}
}

func TestAppleSiliconReadinessUsesMPSWithoutDocker(t *testing.T) {
	report := probeFor("darwin", "arm64", func(string) (string, error) {
		return "", errors.New("not found")
	})
	report.MPSAvailable = true
	report.GPUs = []GPU{{Name: "Apple M1 Max GPU", MemoryTotalMB: 32768, SharedMemory: true}}

	if !report.Ready() {
		t.Fatal("expected Apple Silicon with MPS to be ready")
	}
	if report.Backend != "native_mps" {
		t.Fatalf("expected native MPS backend, got %q", report.Backend)
	}
}

func TestAppleSiliconRequiresMPS(t *testing.T) {
	report := Report{OperatingSystem: "darwin", Architecture: "arm64", Backend: "native_mps", GPUs: []GPU{{Name: "Apple M1 Max GPU"}}}
	if report.Ready() {
		t.Fatal("expected Apple Silicon without MPS to be unavailable")
	}
}

func TestLinuxWithoutNvidiaUsesCPUTraining(t *testing.T) {
	report := probeFor("linux", "amd64", func(name string) (string, error) {
		if name == "docker" {
			return "/usr/bin/docker", nil
		}
		return "", errors.New("not found")
	})

	if report.Backend != "docker_cpu" {
		t.Fatalf("expected CPU backend, got %q", report.Backend)
	}
	if !report.Ready() {
		t.Fatal("expected Linux amd64 with Docker to be ready for CPU starter training")
	}
}

func TestProbeDiskMB(t *testing.T) {
	total, free := probeDiskMB("/")
	if total <= 0 || free <= 0 || free > total {
		t.Fatalf("expected valid disk capacity, got total=%d free=%d", total, free)
	}
}
