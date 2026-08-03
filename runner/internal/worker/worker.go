package worker

import (
	"context"
	"fmt"
	"log"
	"sync/atomic"
	"time"

	"llmweb/runner/internal/capabilities"
	"llmweb/runner/internal/controlplane"
	"llmweb/runner/internal/executor"
	"llmweb/runner/internal/localstate"
)

type Worker struct {
	store    *localstate.Store
	state    localstate.State
	client   *controlplane.Client
	executor *executor.Executor
	report   capabilities.Report
	sequence atomic.Uint64
}

type executionResult struct {
	payload map[string]any
	err     error
}

func New(store *localstate.Store, state localstate.State, report capabilities.Report) *Worker {
	return &Worker{
		store:    store,
		state:    state,
		client:   controlplane.New(state.ControlURL, state.DeviceToken),
		executor: executor.New(state.DataRoot, state.OutputRoot, store.Directory()),
		report:   report,
	}
}

func (worker *Worker) Run(ctx context.Context) error {
	log.Printf("算力 %s 已连接，等待网页任务", worker.state.Name)
	for {
		if err := worker.flush(ctx); err != nil {
			log.Printf("状态暂未同步，将自动重试: %v", err)
		}
		if worker.state.Active == nil {
			lease, err := worker.client.Lease(ctx)
			if err != nil {
				if !wait(ctx, 5*time.Second) {
					return nil
				}
				continue
			}
			if lease == nil {
				_, _ = worker.client.Heartbeat(ctx, worker.report, "")
				if !wait(ctx, 5*time.Second) {
					return nil
				}
				continue
			}
			worker.state.Active = lease
			if err := worker.store.Save(worker.state); err != nil {
				return err
			}
		}
		if err := worker.executeActive(ctx); err != nil {
			return err
		}
	}
}

func (worker *Worker) executeActive(ctx context.Context) error {
	lease := *worker.state.Active
	events := make(chan controlplane.Event, 128)
	result := make(chan executionResult, 1)
	executionContext, cancel := context.WithCancel(ctx)
	defer cancel()
	emit := func(eventType, message string, payload map[string]any) {
		if payload == nil {
			payload = map[string]any{}
		}
		event := controlplane.Event{
			EventID: fmt.Sprintf("%s-%d-%d", lease.JobID, time.Now().UnixNano(), worker.sequence.Add(1)),
			Type:    eventType,
			Message: message,
			Payload: payload,
		}
		select {
		case events <- event:
		case <-executionContext.Done():
		}
	}

	emit("accepted", "任务已保存到本地并开始执行", map[string]any{})
	go func() {
		payload, err := worker.executor.Run(executionContext, lease, emit)
		result <- executionResult{payload: payload, err: err}
	}()

	heartbeat := time.NewTicker(10 * time.Second)
	defer heartbeat.Stop()
	cancelled := false
	lastControl := ""
	for {
		select {
		case <-ctx.Done():
			return nil
		case event := <-events:
			worker.queue(lease, []controlplane.Event{event})
			_ = worker.flush(ctx)
		case outcome := <-result:
			for {
				select {
				case event := <-events:
					worker.queue(lease, []controlplane.Event{event})
				default:
					goto drained
				}
			}
		drained:
			var final controlplane.Event
			if cancelled {
				final = worker.event(lease.JobID, "cancelled", "任务已取消", map[string]any{})
			} else if outcome.err != nil {
				final = worker.event(lease.JobID, "failed", outcome.err.Error(), map[string]any{})
			} else {
				final = worker.event(lease.JobID, "completed", "任务已完成", outcome.payload)
			}
			worker.queue(lease, []controlplane.Event{final})
			worker.state.Active = nil
			if err := worker.store.Save(worker.state); err != nil {
				return err
			}
			_ = worker.flush(ctx)
			return nil
		case <-heartbeat.C:
			controls, err := worker.client.Heartbeat(ctx, worker.report, lease.JobID)
			if err != nil {
				continue
			}
			for _, control := range controls {
				if control.JobID != lease.JobID {
					continue
				}
				if control.Action == lastControl {
					continue
				}
				if err := worker.executor.Control(control.Action); err != nil {
					emit("log", err.Error(), map[string]any{})
					continue
				}
				lastControl = control.Action
				switch control.Action {
				case "paused":
					emit("paused", "训练已暂停，可随时继续", map[string]any{})
				case "running":
					emit("progress", "训练已继续", map[string]any{})
				case "cancelled":
					cancelled = true
					cancel()
				}
			}
		}
	}
}

func (worker *Worker) event(jobID, eventType, message string, payload map[string]any) controlplane.Event {
	return controlplane.Event{
		EventID: fmt.Sprintf("%s-%d-%d", jobID, time.Now().UnixNano(), worker.sequence.Add(1)),
		Type:    eventType,
		Message: message,
		Payload: payload,
	}
}

func (worker *Worker) queue(lease controlplane.Lease, events []controlplane.Event) {
	worker.state.PendingEvents = append(worker.state.PendingEvents, localstate.QueuedEvents{
		JobID: lease.JobID, LeaseID: lease.LeaseID, Events: events,
	})
	if err := worker.store.Save(worker.state); err != nil {
		log.Printf("保存待同步状态失败: %v", err)
	}
}

func (worker *Worker) flush(ctx context.Context) error {
	for len(worker.state.PendingEvents) > 0 {
		queued := worker.state.PendingEvents[0]
		if err := worker.client.Events(ctx, queued.JobID, queued.LeaseID, queued.Events); err != nil {
			return err
		}
		worker.state.PendingEvents = worker.state.PendingEvents[1:]
		if err := worker.store.Save(worker.state); err != nil {
			return err
		}
	}
	return nil
}

func wait(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
