export const trainingMetricKeys = ["loss", "eval_loss", "learning_rate", "epoch"] as const;

export type TrainingMetricKey = (typeof trainingMetricKeys)[number];

export type TrainingMetricPoint = {
  sequence: number;
  value: number;
  recordedAt: string;
};

type MonitorEvent = {
  id: number;
  type: string;
  message: string | null;
  payload: Record<string, number | string>;
  created_at: string;
};

type MonitorJob = {
  id?: string;
  kind: string;
  status?: string;
  desired_state?: string;
  progress: number;
  error?: string | null;
  experiment_id?: string | null;
  dataset_id?: string | null;
  started_at?: string | null;
  events: MonitorEvent[];
};

export type TrainingMonitor = {
  progress: number;
  startedAt: string | null;
  latestMetricAt: string | null;
  latestEvent: MonitorEvent | null;
  eventCount: number;
  series: Record<TrainingMetricKey, TrainingMetricPoint[]>;
};

export type ChartCoordinate = { x: number; y: number };

export type TrainingFeedItem = { id: number; message: string; recordedAt: string };

function isMetricValue(key: TrainingMetricKey, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return false;
  if (key === "learning_rate") return value >= 0 && value <= 1;
  if (key === "epoch") return value >= 0 && value <= 1_000_000;
  return value >= 0;
}

export function formatTrainingMetric(key: TrainingMetricKey, value: number) {
  if (key === "learning_rate") return value.toExponential(2);
  if (key === "epoch") return value.toFixed(2).replace(/\.?0+$/, "");
  return value.toFixed(4);
}

export function buildTrainingMonitor(jobs: MonitorJob[]): TrainingMonitor {
  const trainingJobs = jobs.filter((job) => job.kind === "train");
  const events = trainingJobs.flatMap((job) => job.events).sort((left, right) => left.id - right.id);
  const series: Record<TrainingMetricKey, TrainingMetricPoint[]> = { loss: [], eval_loss: [], learning_rate: [], epoch: [] };
  let latestMetricAt: string | null = null;

  for (const event of events) {
    if (!Number.isFinite(Date.parse(event.created_at))) continue;
    let containsMetric = false;
    for (const key of trainingMetricKeys) {
      const value = event.payload[key];
      if (!isMetricValue(key, value)) continue;
      series[key].push({ sequence: event.id, value, recordedAt: event.created_at });
      containsMetric = true;
    }
    if (containsMetric && Number.isFinite(Date.parse(event.created_at))) latestMetricAt = event.created_at;
  }

  return {
    progress: trainingJobs.reduce((maximum, job) => Math.max(maximum, job.progress), 0),
    startedAt: trainingJobs.find((job) => job.started_at)?.started_at ?? null,
    latestMetricAt,
    latestEvent: events.at(-1) ?? null,
    eventCount: events.length,
    series,
  };
}

export function buildChartCoordinates(points: TrainingMetricPoint[], mode: "record" | "time"): ChartCoordinate[] {
  if (!points.length) return [];
  if (points.length === 1) return [{ x: 50, y: 50 }];
  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const valueSpan = maximum - minimum || 1;
  const horizontal = mode === "time" ? points.map((point) => Date.parse(point.recordedAt)) : points.map((_, index) => index);
  const first = horizontal[0];
  const horizontalSpan = horizontal.at(-1)! - first || 1;
  return points.map((point, index) => ({
    x: Number((4 + ((horizontal[index] - first) / horizontalSpan) * 92).toFixed(2)),
    y: Number((16 + ((maximum - point.value) / valueSpan) * 72).toFixed(2)),
  }));
}

export function buildTrainingFeed(events: MonitorEvent[], locale: "zh-CN" | "en"): TrainingFeedItem[] {
  const english = locale === "en";
  return [...events].sort((left, right) => right.id - left.id).flatMap((event) => {
    if (!Number.isFinite(Date.parse(event.created_at))) return [];
    if (event.type === "progress") {
      const percent = event.payload.percent;
      const message = typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100
        ? (english ? `Training progress updated to ${Math.round(percent)}%` : `训练进度更新至 ${Math.round(percent)}%`)
        : (english ? "Training is continuing on your computer" : "训练正在你的电脑上继续");
      return [{ id: event.id, message, recordedAt: event.created_at }];
    }
    const lifecycle: Record<string, [string, string]> = {
      accepted: ["训练电脑已开始执行", "Your training computer started the task"],
      paused: ["训练已暂停，进度会保留", "Training paused with progress preserved"],
      completed: ["训练阶段已完成", "Training stage completed"],
      failed: ["训练阶段未完成，请查看运行记录", "Training stage did not complete; view the run log"],
      cancelled: ["训练已取消", "Training cancelled"],
    };
    if (lifecycle[event.type]) return [{ id: event.id, message: lifecycle[event.type][english ? 1 : 0], recordedAt: event.created_at }];
    const key = trainingMetricKeys.find((candidate) => isMetricValue(candidate, event.payload[candidate]));
    if (!key) return [];
    const value = event.payload[key] as number;
    const names: Record<TrainingMetricKey, [string, string]> = {
      loss: ["训练损失", "Training loss"],
      eval_loss: ["验证损失", "Validation loss"],
      learning_rate: ["学习率", "Learning rate"],
      epoch: ["训练轮次", "Epoch"],
    };
    let message = english
      ? `${names[key][1]} updated to ${formatTrainingMetric(key, value)}`
      : `${names[key][0]}更新为 ${formatTrainingMetric(key, value)}`;
    const epoch = event.payload.epoch;
    if (key !== "epoch" && isMetricValue("epoch", epoch)) message += english ? ` · epoch ${formatTrainingMetric("epoch", epoch)}` : ` · 第 ${formatTrainingMetric("epoch", epoch)} 轮`;
    return [{ id: event.id, message, recordedAt: event.created_at }];
  });
}
