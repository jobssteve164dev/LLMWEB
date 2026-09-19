"use client";

import { createElement as h, useEffect, useState } from "react";
import type { Locale } from "../lib/i18n";

export type TrainingParameters = {
  epochs: number;
  learning_rate: number;
  max_length: number;
  batch_size: number;
  gradient_accumulation: number;
};

export type TrainingPlanInput = TrainingParameters & {
  runner_id: string;
  model_id: string;
  method: "lora" | "qlora" | "starter";
};

type ParameterCapability = { minimum: number; maximum: number; suggested_step: number };

export type TrainingPlanPreview = {
  plan_version: string;
  editable: boolean;
  parameters: Record<keyof TrainingParameters, ParameterCapability>;
  resolved: TrainingParameters & { method: "lora" | "qlora" | "starter" };
  derived: { effective_batch_size: number; iterations?: number };
  operators: Record<string, { value: string | number; editable: boolean }>;
  warnings: string[];
};

const profiles: Record<string, TrainingParameters> = {
  fast: { epochs: 1, learning_rate: 0.0002, max_length: 1024, batch_size: 1, gradient_accumulation: 4 },
  balanced: { epochs: 3, learning_rate: 0.0002, max_length: 2048, batch_size: 1, gradient_accumulation: 8 },
  thorough: { epochs: 5, learning_rate: 0.0002, max_length: 2048, batch_size: 1, gradient_accumulation: 8 },
};

const fallbackCapabilities: Record<keyof TrainingParameters, ParameterCapability> = {
  epochs: { minimum: 0.1, maximum: 100, suggested_step: 0.1 },
  learning_rate: { minimum: 0.0000001, maximum: 1, suggested_step: 0.00001 },
  max_length: { minimum: 64, maximum: 32768, suggested_step: 64 },
  batch_size: { minimum: 1, maximum: 128, suggested_step: 1 },
  gradient_accumulation: { minimum: 1, maximum: 1024, suggested_step: 1 },
};

export function profileTrainingParameters(profile: string): TrainingParameters {
  return { ...(profiles[profile] ?? profiles.balanced) };
}

export function profileForTrainingParameters(parameters: TrainingParameters): string {
  return Object.entries(profiles).find(([, values]) => parameterKeys.every((key) => values[key] === parameters[key]))?.[0] ?? "custom";
}

export function trainingEstimate(model: string, parameters: TrainingParameters, rows: number, locale: Locale) {
  const billions = model.includes("0.5B") ? 0.5 : model.includes("1.5B") ? 1.5 : 3;
  const contextScale = Math.max(0.5, parameters.max_length / 2048);
  const memoryScale = Math.sqrt(contextScale * parameters.batch_size);
  const checkpointScale = Math.max(1, parameters.epochs / 3);
  const minutes = Math.max(4, Math.ceil(rows * parameters.epochs * billions * contextScale / 90));
  const en = locale === "en";
  return {
    memory: `${Math.ceil((4 + billions * 1.7) * memoryScale)}–${Math.ceil((6 + billions * 2.2) * memoryScale)} GB`,
    time: minutes < 60 ? `${minutes}–${Math.ceil(minutes * 1.8)} ${en ? "minutes" : "分钟"}` : `${(minutes / 60).toFixed(1)}–${(minutes * 1.8 / 60).toFixed(1)} ${en ? "hours" : "小时"}`,
    disk: `${Math.ceil((billions * 2.2 + 1) * checkpointScale)}–${Math.ceil((billions * 4.5 + 2) * checkpointScale)} GB`,
  };
}

export function trainingParametersFromForm(form: FormData): TrainingParameters {
  const parameters = {
    epochs: Number(form.get("epochs")),
    learning_rate: Number(form.get("learning_rate")),
    max_length: Number(form.get("max_length")),
    batch_size: Number(form.get("batch_size")),
    gradient_accumulation: Number(form.get("gradient_accumulation")),
  };
  if (Object.entries(parameters).some(([key, value]) => !form.get(key) || !Number.isFinite(value) || value <= 0)) {
    throw new Error("训练参数不完整，请检查后再开始");
  }
  return parameters;
}

type Props = {
  locale: Locale;
  runnerId: string;
  modelId: string;
  method: "lora" | "qlora" | "starter";
  values: TrainingParameters;
  editableKeys?: Array<keyof TrainingParameters>;
  onParametersChange: (values: TrainingParameters) => void;
  previewPlan: (input: TrainingPlanInput) => Promise<TrainingPlanPreview>;
};

const parameterKeys: Array<keyof TrainingParameters> = ["epochs", "learning_rate", "max_length", "batch_size", "gradient_accumulation"];

export function TrainingParameterEditor({ locale, runnerId, modelId, method, values, editableKeys = parameterKeys, onParametersChange, previewPlan }: Props) {
  const english = locale === "en";
  const custom = profileForTrainingParameters(values) === "custom";
  const partiallyEditable = editableKeys.length < parameterKeys.length;
  const starter = method === "starter";
  const [preview, setPreview] = useState<TrainingPlanPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setPreviewError(null);
      setPreview(null);
      void previewPlan({ runner_id: runnerId, model_id: modelId, method, ...values })
        .then((next) => { if (active) setPreview(next); })
        .catch((error) => {
          if (!active) return;
          setPreview(null);
          setPreviewError(error instanceof Error ? error.message : (english ? "This configuration could not be checked." : "这组设置暂时无法检查。"));
        });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [english, method, modelId, previewPlan, runnerId, values]);

  const labels: Record<keyof TrainingParameters, [string, string, string, string]> = {
    epochs: ["训练轮次", "Epochs", "模型完整学习数据的次数", "Complete passes over the training data"],
    learning_rate: ["学习率", "Learning rate", "每次更新参数的幅度", "How far each parameter update moves"],
    max_length: starter
      ? ["文本窗口", "Text window", "每次使用的字符数", "Characters used at a time"]
      : ["上下文长度", "Context length", "每条样本最多使用的 token 数", "Maximum tokens used from each sample"],
    batch_size: ["单次批量", "Micro batch", "每次放入显存的样本数", "Samples loaded into memory at once"],
    gradient_accumulation: ["梯度累积", "Gradient accumulation", "累计多少次再更新参数", "Steps accumulated before an update"],
  };
  const capabilities = preview?.parameters ?? fallbackCapabilities;

  return h("details", { className: "trainingParameterEditor", open: true },
    h("summary", null,
      h("span", null, starter ? (english ? "Training parameters" : "训练参数") : (english ? "Adjust training parameters" : "调整训练参数")),
      h("small", null, starter
        ? (english ? "This computer uses matched training parameters." : "当前电脑使用已匹配的训练参数")
        : partiallyEditable
          ? (english ? "Some parameters are matched automatically." : "部分参数已自动匹配")
        : custom ? (english ? "Custom settings are active" : "正在使用自定义设置") : (english ? "Recommended settings are active" : "正在使用推荐设置")),
    ),
    starter ? h("input", { type: "hidden", name: "epochs", value: values.epochs }) : null,
    h("div", { className: "trainingParameterGrid" }, parameterKeys.filter((key) => !starter || key !== "epochs").map((key) => {
      const label = labels[key];
      const capability = capabilities[key];
      const editable = editableKeys.includes(key);
      return h("label", { key },
        h("span", null, label[english ? 1 : 0]),
        h("input", {
          name: key,
          type: "number",
          required: true,
          min: capability.minimum,
          max: capability.maximum,
          step: key === "learning_rate" ? "any" : capability.suggested_step,
          readOnly: !editable,
          "aria-disabled": !editable || undefined,
          value: values[key],
          onChange: editable ? (event: { currentTarget: { value: string } }) => onParametersChange({ ...values, [key]: Number(event.currentTarget.value) }) : undefined,
        }),
        h("small", null, label[english ? 3 : 2]),
      );
    })),
    h("section", { className: `trainingPlanPreview ${previewError ? "error" : preview ? "ready" : "checking"}`, "aria-live": "polite" },
      h("strong", null, previewError ? (english ? "Adjust this configuration" : "这组设置需要调整") : preview ? (english ? "Configuration can run" : "配置可以运行") : (english ? "Checking this configuration" : "正在检查这组设置")),
      h("p", null, previewError ?? (preview
        ? starter && preview.derived.iterations
          ? (english ? `${preview.derived.iterations} training steps. The fixed execution strategy is recorded with this run.` : `将执行 ${preview.derived.iterations} 个训练步。固定执行策略会随本次训练一并记录。`)
          : (english ? `Effective batch ${preview.derived.effective_batch_size}. The fixed execution strategy is recorded with this run.` : `有效批次为 ${preview.derived.effective_batch_size}。固定执行策略会随本次训练一并记录。`)
        : (english ? "The system checks compatibility before training starts. You can restore a recommended setting at any time." : "系统会在开始前检查这组设置；你可以随时恢复推荐设置。"))),
      preview ? h("div", { className: "trainingOperatorSummary" }, Object.entries(preview.operators).map(([key, operator]) => {
        const names: Record<string, [string, string]> = {
          lr_scheduler: ["学习率调度", "Schedule"], warmup_ratio: ["训练预热", "Warmup"], evaluation: ["评测", "Evaluation"], checkpoint: ["保存", "Checkpoint"], precision: ["精度", "Precision"],
        };
        return h("span", { key }, `${names[key]?.[english ? 1 : 0] ?? key} · ${operator.value}`);
      })) : null,
      preview?.warnings.length ? h("ul", null, preview.warnings.map((warning) => {
        const messages: Record<string, [string, string]> = {
          large_effective_batch: ["有效批次较大，单次参数更新会覆盖更多样本", "The effective batch is large, so each update covers more samples."],
          long_context: ["较长上下文会显著增加显存占用和训练时间", "Long context significantly increases memory use and training time."],
        };
        return h("li", { key: warning }, messages[warning]?.[english ? 1 : 0] ?? warning);
      })) : null,
    ),
  );
}
