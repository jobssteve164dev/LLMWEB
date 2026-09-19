import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrainingMonitorDashboard } from "./training-monitor-dashboard.ts";

test("TrainingMonitorDashboard renders real metrics with an accessible chart fallback", () => {
  const html = renderToStaticMarkup(createElement(TrainingMonitorDashboard, {
    experimentName: "客户支持微调",
    status: "running",
    stageTitle: "微调模型",
    locale: "zh-CN",
    jobs: [{
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
        { id: 1, type: "log", message: "loss: 0.71", payload: { loss: 0.71, epoch: 1 }, created_at: "2026-09-19T10:01:00Z" },
        { id: 2, type: "log", message: "loss: 0.42", payload: { loss: 0.42, epoch: 1.5 }, created_at: "2026-09-19T10:02:00Z" },
      ],
    }],
  }));

  assert.match(html, /aria-label="训练实时监控"/);
  assert.match(html, /训练损失/);
  assert.match(html, />0\.4200</);
  assert.match(html, /查看训练损失数据/);
  assert.match(html, /训练损失更新为 0\.4200/);
  assert.match(html, /最近同步的 2 条训练进展/);
  assert.doesNotMatch(html, /loss: 0\.42/);
  assert.match(html, /aria-pressed="true"/);
});

test("TrainingMonitorDashboard explains when the runner has not reported metrics yet", () => {
  const html = renderToStaticMarkup(createElement(TrainingMonitorDashboard, {
    experimentName: "New run",
    status: "queued",
    stageTitle: "Fine-tune model",
    locale: "en",
    jobs: [],
  }));

  assert.match(html, /Waiting for the first metric/);
  assert.doesNotMatch(html, /demo|sample data/i);
});
