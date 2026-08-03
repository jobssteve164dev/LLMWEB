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
