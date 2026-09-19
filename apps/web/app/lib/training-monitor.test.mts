import assert from "node:assert/strict";
import test from "node:test";
import { buildChartCoordinates, buildTrainingFeed, buildTrainingMonitor } from "./training-monitor.ts";

test("buildTrainingMonitor turns real training events into ordered metric series", () => {
  const monitor = buildTrainingMonitor([
    {
      id: "train-1",
      kind: "train",
      status: "running",
      desired_state: "running",
      progress: 46,
      error: null,
      experiment_id: "exp-1",
      dataset_id: "data-1",
      started_at: "2026-09-19T10:00:00Z",
      events: [
        { id: 4, type: "log", message: "later", payload: { loss: 0.42, learning_rate: 0, epoch: 1.5 }, created_at: "2026-09-19T10:02:00Z" },
        { id: 2, type: "log", message: "earlier", payload: { loss: 0.71, eval_loss: 0.68, epoch: 1 }, created_at: "2026-09-19T10:01:00Z" },
      ],
    },
    {
      id: "evaluate-1",
      kind: "evaluate",
      status: "completed",
      desired_state: "running",
      progress: 100,
      error: null,
      experiment_id: "exp-1",
      dataset_id: "data-1",
      events: [
        { id: 5, type: "log", message: "not training", payload: { loss: 99 }, created_at: "2026-09-19T10:03:00Z" },
      ],
    },
  ]);

  assert.equal(monitor.progress, 46);
  assert.equal(monitor.startedAt, "2026-09-19T10:00:00Z");
  assert.deepEqual(monitor.series.loss.map((point) => point.value), [0.71, 0.42]);
  assert.deepEqual(monitor.series.epoch.map((point) => point.value), [1, 1.5]);
  assert.deepEqual(monitor.series.learning_rate.map((point) => point.value), [0]);
  assert.deepEqual(monitor.series.eval_loss.map((point) => point.value), [0.68]);
  assert.equal(monitor.latestEvent?.message, "later");
});

test("buildTrainingMonitor ignores invalid timestamps and unsafe metric values without inventing data", () => {
  const monitor = buildTrainingMonitor([
    {
      id: "train-1",
      kind: "train",
      status: "running",
      desired_state: "running",
      progress: 12,
      error: null,
      experiment_id: "exp-1",
      dataset_id: "data-1",
      events: [
        { id: 1, type: "log", message: "plain log", payload: { loss: 0.7, epoch: Number.NaN }, created_at: "invalid" },
        { id: 2, type: "log", message: "extreme", payload: { loss: Number.MAX_VALUE }, created_at: "2026-09-19T10:02:00Z" },
      ],
    },
  ]);

  assert.deepEqual(monitor.series.loss, []);
  assert.deepEqual(monitor.series.epoch, []);
  assert.equal(monitor.latestMetricAt, null);
});

test("buildChartCoordinates uses elapsed time instead of equal spacing in time mode", () => {
  const points = [
    { sequence: 1, value: 0.9, recordedAt: "2026-09-19T10:00:00Z" },
    { sequence: 2, value: 0.7, recordedAt: "2026-09-19T10:01:00Z" },
    { sequence: 3, value: 0.4, recordedAt: "2026-09-19T10:10:00Z" },
  ];

  assert.deepEqual(buildChartCoordinates(points, "record").map((point) => point.x), [4, 50, 96]);
  assert.deepEqual(buildChartCoordinates(points, "time").map((point) => point.x), [4, 13.2, 96]);
  assert.deepEqual(buildChartCoordinates([points[0]], "time")[0], { x: 50, y: 50 });
});

test("buildTrainingFeed replaces raw engine logs with user-readable metric updates", () => {
  const feed = buildTrainingFeed([
    { id: 1, type: "log", message: "{'loss': 0.42, 'grad_norm': 7.2}", payload: { loss: 0.42, epoch: 1.5 }, created_at: "2026-09-19T10:02:00Z" },
    { id: 2, type: "progress", message: "internal stage", payload: { percent: 46 }, created_at: "2026-09-19T10:03:00Z" },
  ], "zh-CN");

  assert.deepEqual(feed.map((item) => item.message), ["训练进度更新至 46%", "训练损失更新为 0.4200 · 第 1.5 轮"]);
  assert.doesNotMatch(feed.map((item) => item.message).join(" "), /grad_norm|internal stage/);
});

test("buildTrainingFeed only displays progress percentages inside the job progress range", () => {
  const feed = buildTrainingFeed([
    { id: 1, type: "progress", message: "invalid low", payload: { percent: -10 }, created_at: "2026-09-19T10:01:00Z" },
    { id: 2, type: "progress", message: "invalid high", payload: { percent: 999 }, created_at: "2026-09-19T10:02:00Z" },
    { id: 3, type: "progress", message: "valid boundary", payload: { percent: 100 }, created_at: "2026-09-19T10:03:00Z" },
  ], "zh-CN");

  assert.deepEqual(feed.map((item) => item.message), ["训练进度更新至 100%", "训练正在你的电脑上继续", "训练正在你的电脑上继续"]);
});
