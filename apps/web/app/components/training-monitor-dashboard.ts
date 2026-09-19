"use client";

import { createElement as h, useState } from "react";
import { buildChartCoordinates, buildTrainingFeed, buildTrainingMonitor, formatTrainingMetric, type TrainingMetricKey, type TrainingMetricPoint } from "../lib/training-monitor.ts";
import type { Locale } from "../lib/i18n";
import type { Job } from "../lib/types";

type Props = {
  experimentName: string;
  status: string;
  stageTitle: string;
  locale: Locale;
  jobs: Job[];
};

const metricOrder: TrainingMetricKey[] = ["loss", "eval_loss", "learning_rate", "epoch"];

function metricLabel(key: TrainingMetricKey, english: boolean) {
  const labels: Record<TrainingMetricKey, [string, string]> = {
    loss: ["训练损失", "Training loss"],
    eval_loss: ["验证损失", "Validation loss"],
    learning_rate: ["学习率", "Learning rate"],
    epoch: ["训练轮次", "Epoch"],
  };
  return labels[key][english ? 1 : 0];
}

function MetricChart({ metricKey, points, english, xMode }: { metricKey: TrainingMetricKey; points: TrainingMetricPoint[]; english: boolean; xMode: "record" | "time" }) {
  const label = metricLabel(metricKey, english);
  const latest = points.at(-1);
  const first = points[0];
  const trend = latest && first && points.length > 1 ? latest.value - first.value : null;
  const coordinates = buildChartCoordinates(points, xMode);
  const path = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const detailLabel = english ? `View ${label.toLowerCase()} data` : `查看${label}数据`;

  return h("article", { className: "trainingMetricCard" },
    h("header", null,
      h("div", null, h("span", null, label), h("strong", null, latest ? formatTrainingMetric(metricKey, latest.value) : "—")),
      trend === null ? null : h("small", { className: trend <= 0 && metricKey.includes("loss") ? "good" : "" }, `${trend > 0 ? "+" : ""}${formatTrainingMetric(metricKey, trend)}`),
    ),
    points.length ? h("div", { className: "trainingChart" },
      h("svg", { viewBox: "0 0 100 100", role: "img", "aria-label": english ? `${label} trend in the latest synced window, ${points.length} readings` : `${label}最近同步窗口趋势，共 ${points.length} 条`, preserveAspectRatio: "none" },
        h("title", null, label),
        h("desc", null, english ? `Latest value ${formatTrainingMetric(metricKey, latest!.value)}` : `最新值 ${formatTrainingMetric(metricKey, latest!.value)}`),
        [20, 50, 80].map((y) => h("line", { key: y, x1: 4, x2: 96, y1: y, y2: y, className: "trainingChartGrid" })),
        h("polyline", { points: path, className: "trainingChartLine", vectorEffect: "non-scaling-stroke" }),
        points.map((point, index) => {
          const coordinate = coordinates[index];
          return h("circle", { key: point.sequence, cx: coordinate.x, cy: coordinate.y, r: 1.8, className: "trainingChartPoint", vectorEffect: "non-scaling-stroke" }, h("title", null, `${formatTrainingMetric(metricKey, point.value)} · ${point.recordedAt}`));
        }),
      ),
      h("div", { className: "trainingChartAxis", "aria-hidden": "true" },
        h("span", null, xMode === "time" ? new Date(first.recordedAt).toLocaleTimeString(english ? "en" : "zh-CN", { hour: "2-digit", minute: "2-digit" }) : (english ? "Earlier" : "较早")),
        h("span", null, xMode === "time" ? new Date(latest!.recordedAt).toLocaleTimeString(english ? "en" : "zh-CN", { hour: "2-digit", minute: "2-digit" }) : (english ? "Latest" : "最新")),
      ),
    ) : h("p", { className: "trainingMetricEmpty" }, english ? "Waiting for the first metric from your computer." : "正在等待训练电脑上报第一条指标。"),
    points.length ? h("details", { className: "trainingDataTable" },
      h("summary", null, detailLabel),
      h("div", { className: "trainingDataTableScroll" }, h("table", null,
        h("thead", null, h("tr", null, h("th", { scope: "col" }, english ? "Time" : "时间"), h("th", { scope: "col" }, english ? "Value" : "数值"))),
        h("tbody", null, points.map((point) => h("tr", { key: point.sequence }, h("td", null, new Date(point.recordedAt).toLocaleString(english ? "en" : "zh-CN")), h("td", null, formatTrainingMetric(metricKey, point.value))))),
      )),
    ) : null,
  );
}

export function TrainingMonitorDashboard({ experimentName, status, stageTitle, locale, jobs }: Props) {
  const english = locale === "en";
  const [xMode, setXMode] = useState<"record" | "time">("record");
  const monitor = buildTrainingMonitor(jobs);
  const trainingEvents = jobs.filter((job) => job.kind === "train").flatMap((job) => job.events);
  const feed = buildTrainingFeed(trainingEvents, locale).slice(0, 8);
  const statusText = status === "completed" ? (english ? "Completed" : "已完成") : status === "failed" ? (english ? "Failed" : "未完成") : status === "cancelled" ? (english ? "Cancelled" : "已取消") : (english ? "In progress" : "进行中");

  return h("section", { className: "trainingMonitor", "aria-label": english ? "Live training monitor" : "训练实时监控" },
    h("div", { className: "trainingRunStrip" },
      h("div", { className: "trainingRunIdentity" }, h("span", { className: `trainingRunDot ${status}` }), h("div", null, h("strong", null, experimentName), h("small", null, statusText))),
      h("div", null, h("span", null, english ? "Current stage" : "当前阶段"), h("strong", null, stageTitle)),
      h("div", null, h("span", null, english ? "Training progress" : "训练进度"), h("strong", null, `${monitor.progress}%`)),
      h("div", null, h("span", null, english ? "Latest metric" : "最近指标"), h("strong", null, monitor.latestMetricAt ? new Date(monitor.latestMetricAt).toLocaleTimeString(english ? "en" : "zh-CN", { hour: "2-digit", minute: "2-digit" }) : "—")),
    ),
    h("div", { className: "trainingMonitorHeading" },
      h("div", null, h("span", null, english ? "Live metrics" : "实时指标"), h("h2", null, english ? "See how training is changing" : "看清训练正在怎样变化"), h("small", { className: "trainingMonitorScope" }, english ? `Latest ${monitor.eventCount} training updates synced to the web app` : `最近同步的 ${monitor.eventCount} 条训练进展`)),
      h("div", { className: "trainingAxisSwitch", role: "group", "aria-label": english ? "Chart horizontal axis" : "图表横轴" },
        h("button", { type: "button", "aria-pressed": xMode === "record", onClick: () => setXMode("record") }, english ? "Reading" : "记录"),
        h("button", { type: "button", "aria-pressed": xMode === "time", onClick: () => setXMode("time") }, english ? "Time" : "时间"),
      ),
    ),
    h("div", { className: "trainingMetricGrid" }, metricOrder.map((key) => h(MetricChart, { key, metricKey: key, points: monitor.series[key], english, xMode }))),
    h("section", { className: "trainingFeed" },
      h("header", null, h("div", null, h("span", null, english ? "Activity" : "最新动态"), h("h2", null, english ? "Updates from your training computer" : "来自训练电脑的进展")), h("small", { "aria-live": "polite" }, feed.length ? (english ? "Up to date" : "已同步") : (english ? "Waiting" : "等待上报"))),
      h("div", null, feed.length ? feed.map((event) => h("article", { key: event.id }, h("time", { dateTime: event.recordedAt }, new Date(event.recordedAt).toLocaleTimeString(english ? "en" : "zh-CN", { hour: "2-digit", minute: "2-digit" })), h("p", null, event.message))) : h("p", { className: "trainingFeedEmpty" }, english ? "Updates will appear here after the computer starts training." : "训练电脑开始执行后，进展会出现在这里。")),
    ),
  );
}
