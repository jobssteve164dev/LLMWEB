import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrainingParameterEditor, profileForTrainingParameters, profileTrainingParameters, trainingEstimate, trainingParametersFromForm } from "./training-parameter-editor.ts";

test("TrainingParameterEditor exposes the five supported parameters without replacing the recommended path", () => {
  const html = renderToStaticMarkup(createElement(TrainingParameterEditor, {
    locale: "zh-CN",
    runnerId: "runner-1",
    modelId: "Qwen/Qwen2.5-1.5B-Instruct",
    method: "qlora",
    values: profileTrainingParameters("balanced"),
    onParametersChange: () => undefined,
    previewPlan: async () => { throw new Error("not called during server rendering"); },
  }));

  assert.match(html, /调整训练参数/);
  assert.match(html, /训练轮次/);
  assert.match(html, /学习率/);
  assert.match(html, /上下文长度/);
  assert.match(html, /单次批量/);
  assert.match(html, /梯度累积/);
  assert.match(html, /name="epochs"/);
  assert.match(html, /name="learning_rate"/);
  assert.match(html, /name="max_length"/);
  assert.match(html, /name="batch_size"/);
  assert.match(html, /name="gradient_accumulation"/);
  assert.match(html, /系统会在开始前检查这组设置/);
  assert.match(html, /正在使用推荐设置/);
  assert.match(html, /随时恢复推荐设置/);
});

test("training parameter helpers preserve profiles and reject an incomplete form", () => {
  assert.deepEqual(profileTrainingParameters("thorough"), {
    epochs: 5,
    learning_rate: 0.0002,
    max_length: 2048,
    batch_size: 1,
    gradient_accumulation: 8,
  });

  const form = new FormData();
  form.set("epochs", "2.5");
  form.set("learning_rate", "0.0001");
  form.set("max_length", "1024");
  form.set("batch_size", "2");
  form.set("gradient_accumulation", "4");
  assert.deepEqual(trainingParametersFromForm(form), {
    epochs: 2.5,
    learning_rate: 0.0001,
    max_length: 1024,
    batch_size: 2,
    gradient_accumulation: 4,
  });

  form.set("batch_size", "");
  assert.throws(() => trainingParametersFromForm(form), /训练参数不完整/);
});

test("editing a recommended parameter produces a custom state and updates estimates", () => {
  const balanced = profileTrainingParameters("balanced");
  assert.equal(profileForTrainingParameters(balanced), "balanced");
  const custom = { ...balanced, epochs: 100, max_length: 4096 };
  assert.equal(profileForTrainingParameters(custom), "custom");

  const balancedEstimate = trainingEstimate("Qwen/Qwen2.5-1.5B-Instruct", balanced, 100, "zh-CN");
  const customEstimate = trainingEstimate("Qwen/Qwen2.5-1.5B-Instruct", custom, 100, "zh-CN");
  assert.notEqual(customEstimate.time, balancedEstimate.time);
  assert.notEqual(customEstimate.memory, balancedEstimate.memory);
  assert.notEqual(customEstimate.disk, balancedEstimate.disk);
});
