package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"llmweb/runner/internal/capabilities"
)

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

type PairResponse struct {
	RunnerID    string `json:"runner_id"`
	DeviceToken string `json:"device_token"`
}

type Lease struct {
	JobID        string         `json:"job_id"`
	LeaseID      string         `json:"lease_id"`
	Kind         string         `json:"kind"`
	Payload      map[string]any `json:"payload"`
	DesiredState string         `json:"desired_state"`
}

type Control struct {
	JobID  string `json:"job_id"`
	Action string `json:"action"`
}

type Event struct {
	EventID string         `json:"event_id"`
	Type    string         `json:"type"`
	Message string         `json:"message,omitempty"`
	Payload map[string]any `json:"payload"`
}

func New(baseURL, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

func Pair(ctx context.Context, baseURL, code, name string, report capabilities.Report) (PairResponse, error) {
	client := New(baseURL, "")
	body := map[string]any{"code": code, "name": name, "capabilities": capabilityPayload(report)}
	var result PairResponse
	if err := client.request(ctx, http.MethodPost, "/v1/runners/pair", body, &result, false); err != nil {
		return PairResponse{}, err
	}
	return result, nil
}

func capabilityPayload(report capabilities.Report) map[string]any {
	return map[string]any{
		"ready":            report.Ready(),
		"operating_system": report.OperatingSystem,
		"architecture":     report.Architecture,
		"backend":          report.Backend,
		"cpu_cores":        report.CPUCores,
		"memory_total_mb":  report.MemoryTotalMB,
		"disk_total_mb":    report.DiskTotalMB,
		"disk_free_mb":     report.DiskFreeMB,
		"docker_available": report.DockerAvailable,
		"nvidia_available": report.NvidiaAvailable,
		"mps_available":    report.MPSAvailable,
		"gpus":             report.GPUs,
	}
}

func (client *Client) Heartbeat(ctx context.Context, report capabilities.Report, activeJobID string) ([]Control, error) {
	var result struct {
		Controls []Control `json:"controls"`
	}
	body := map[string]any{"capabilities": capabilityPayload(report), "active_job_id": nil}
	if activeJobID != "" {
		body["active_job_id"] = activeJobID
	}
	if err := client.request(ctx, http.MethodPost, "/v1/runners/heartbeat", body, &result, true); err != nil {
		return nil, err
	}
	return result.Controls, nil
}

func (client *Client) Lease(ctx context.Context) (*Lease, error) {
	var result Lease
	err := client.request(ctx, http.MethodPost, "/v1/runners/jobs/lease", map[string]any{}, &result, true)
	if errors.Is(err, errNoContent) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func (client *Client) Events(ctx context.Context, jobID, leaseID string, events []Event) error {
	body := map[string]any{"lease_id": leaseID, "events": events}
	return client.request(ctx, http.MethodPost, "/v1/runners/jobs/"+jobID+"/events", body, nil, true)
}

var errNoContent = errors.New("no content")

func (client *Client) request(ctx context.Context, method, path string, body any, output any, authenticated bool) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encode request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, method, client.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if authenticated {
		request.Header.Set("Authorization", "Bearer "+client.token)
	}
	response, err := client.http.Do(request)
	if err != nil {
		return fmt.Errorf("control plane request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent {
		return errNoContent
	}
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var detail struct {
			Detail string `json:"detail"`
		}
		_ = json.Unmarshal(responseBody, &detail)
		if detail.Detail == "" {
			detail.Detail = strings.TrimSpace(string(responseBody))
		}
		return fmt.Errorf("control plane returned %d: %s", response.StatusCode, detail.Detail)
	}
	if output != nil && len(responseBody) > 0 {
		if err := json.Unmarshal(responseBody, output); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}
