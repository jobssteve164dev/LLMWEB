"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dataset, EvaluationSample, Experiment, Job, Metrics, Project, Runner, WorkspaceState } from "../lib/types";

type Step = "project" | "compute" | "data" | "train" | "monitor" | "model";

const steps: Array<{ id: Step; label: string; short: string }> = [
  { id: "project", label: "定义目标", short: "项目" },
  { id: "compute", label: "连接算力", short: "算力" },
  { id: "data", label: "准备数据", short: "数据" },
  { id: "train", label: "设置训练", short: "训练" },
  { id: "monitor", label: "查看结果", short: "评测" },
  { id: "model", label: "取得模型", short: "模型" },
];

const stageLabels: Record<string, string> = {
  baseline: "建立训练前基线",
  train: "微调模型",
  evaluate: "复测微调模型",
  export: "生成模型产物",
  select: "选择模型版本",
  completed: "全部完成",
};

const jobLabels: Record<Job["kind"], string> = {
  inspect: "检查数据",
  baseline: "训练前评测",
  train: "模型微调",
  evaluate: "训练后评测",
  export: "生成模型",
};

const modelOptions = [
  ["Qwen/Qwen2.5-0.5B-Instruct", "Qwen 2.5 · 0.5B", "适合快速验证流程"],
  ["Qwen/Qwen2.5-1.5B-Instruct", "Qwen 2.5 · 1.5B", "效果与显存占用均衡"],
  ["Qwen/Qwen2.5-3B-Instruct", "Qwen 2.5 · 3B", "需要更多显存，效果更充分"],
] as const;

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/control/${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    if (response.status === 401) throw new SessionRequiredError(payload?.detail ?? "请先登录。 ");
    throw new Error(payload?.detail ?? "操作没有完成，请稍后重试。 ");
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

class SessionRequiredError extends Error {}

function deriveStep(state: WorkspaceState): Step {
  if (state.projects.length === 0) return "project";
  if (state.experiments[0]?.status === "completed") return "model";
  if (state.experiments.length > 0) return "monitor";
  if (!state.runners.some((runner) => runner.status !== "offline")) return "compute";
  if (!state.datasets.some((dataset) => dataset.status === "ready")) return "data";
  return "train";
}

export function Workbench() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [activeStep, setActiveStep] = useState<Step>("project");
  const [manualStep, setManualStep] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    try {
      const next = await api<WorkspaceState>("state", { cache: "no-store" });
      setState(next);
      setLocked(false);
      if (!manualStep) setActiveStep(deriveStep(next));
      if (!quiet) setNotice(null);
    } catch (error) {
      if (error instanceof SessionRequiredError) {
        setLocked(true);
        return;
      }
      if (!quiet) setNotice({ kind: "error", text: error instanceof Error ? error.message : "训练服务暂时不可用。" });
    }
  }, [manualStep]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(true), 3000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const project = state?.projects[0] ?? null;
  const runner = state?.runners.find((item) => item.status !== "offline") ?? state?.runners[0] ?? null;
  const dataset = state?.datasets.find((item) => item.status === "ready") ?? state?.datasets[0] ?? null;
  const experiment = state?.experiments[0] ?? null;

  const moveTo = (step: Step) => {
    setActiveStep(step);
    setManualStep(true);
    setNotice(null);
  };

  const perform = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await refresh(true);
      setManualStep(false);
      setNotice({ kind: "success", text: success });
      window.setTimeout(() => setNotice((current) => current?.text === success ? null : current), 4500);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "操作没有完成。" });
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    if (locked) {
      return <LoginScreen onAuthenticated={() => { setLocked(false); void refresh(); }} />;
    }
    return (
      <main className="loadingScreen">
        <span className="brandMark" aria-hidden="true">L</span>
        <p>正在打开你的训练工作台…</p>
        {notice ? <p className="inlineError">{notice.text}</p> : null}
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <button className="brandButton" type="button" onClick={() => moveTo(deriveStep(state))}>
          <span className="brandMark" aria-hidden="true">L</span>
          <span>LLMWEB</span>
        </button>
        <div className="headerContext">
          <span>{project?.name ?? "第一个项目"}</span>
          <span className="privacyPill"><span aria-hidden="true">●</span> 原始数据留在你的环境</span>
        </div>
      </header>

      <div className="workspaceLayout">
        <aside className="stepRail" aria-label="训练流程">
          <p className="railTitle">训练流程</p>
          <ol>
            {steps.map((step, index) => {
              const complete = index < steps.findIndex((item) => item.id === deriveStep(state)) || deriveStep(state) === "model";
              return (
                <li key={step.id}>
                  <button
                    className={step.id === activeStep ? "active" : ""}
                    type="button"
                    onClick={() => moveTo(step.id)}
                    aria-current={step.id === activeStep ? "step" : undefined}
                  >
                    <span className={complete ? "stepNumber complete" : "stepNumber"}>{complete ? "✓" : index + 1}</span>
                    <span><strong>{step.label}</strong><small>{step.short}</small></span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="railSummary">
            <span className={runner?.status === "online" || runner?.status === "busy" ? "liveDot" : "idleDot"} />
            <div><strong>{runner?.name ?? "尚未连接算力"}</strong><small>{runnerStatus(runner)}</small></div>
          </div>
        </aside>

        <section className="workArea">
          {notice ? <div className={`notice ${notice.kind}`} role="status">{notice.text}<button type="button" onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div> : null}
          {activeStep === "project" ? <ProjectStep project={project} busy={busy} perform={perform} moveTo={moveTo} /> : null}
          {activeStep === "compute" ? <ComputeStep runner={runner} busy={busy} perform={perform} /> : null}
          {activeStep === "data" ? <DataStep project={project} runner={runner} dataset={dataset} busy={busy} perform={perform} moveTo={moveTo} /> : null}
          {activeStep === "train" ? <TrainStep project={project} runner={runner} dataset={dataset} busy={busy} perform={perform} moveTo={moveTo} /> : null}
          {activeStep === "monitor" ? <MonitorStep experiment={experiment} jobs={state.jobs} runner={runner} busy={busy} perform={perform} moveTo={moveTo} /> : null}
          {activeStep === "model" ? <ModelStep experiment={experiment} moveTo={moveTo} /> : null}
        </section>
      </div>
    </main>
  );
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  return <main className="loginScreen"><section><span className="brandMark" aria-hidden="true">L</span><p className="loginEyebrow">LLMWEB</p><h1>打开训练工作台</h1><p>输入部署时设置的访问密码。</p><form onSubmit={async (event) => { event.preventDefault(); setSubmitting(true); setError(""); const form = new FormData(event.currentTarget); const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: form.get("password") }) }); if (!response.ok) { const payload = await response.json().catch(() => null) as { detail?: string } | null; setError(payload?.detail ?? "没有登录成功。"); setSubmitting(false); return; } onAuthenticated(); }}><label><span>访问密码</span><input type="password" name="password" autoComplete="current-password" required autoFocus /></label>{error ? <p className="loginError" role="alert">{error}</p> : null}<button className="primaryButton" disabled={submitting} type="submit">{submitting ? "正在打开…" : "进入工作台"}</button></form></section></main>;
}

type Perform = (action: () => Promise<unknown>, success: string) => Promise<void>;

function SectionIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="sectionIntro"><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></header>;
}

function ProjectStep({ project, busy, perform, moveTo }: { project: Project | null; busy: boolean; perform: Perform; moveTo: (step: Step) => void }) {
  if (project) {
    return <><SectionIntro eyebrow="项目目标" title={project.name} description="这两个判断会贯穿数据准备、训练与效果比较。" />
      <div className="summaryGrid"><article><span>模型要完成什么</span><p>{project.goal}</p></article><article><span>怎样算成功</span><p>{project.success_criteria}</p></article></div>
      <div className="formActions"><button className="primaryButton" type="button" onClick={() => moveTo("compute")}>继续连接算力</button></div></>;
  }
  return <><SectionIntro eyebrow="第一步" title="先说清模型要变成什么样。" description="用业务语言描述目标即可，训练参数稍后由系统承接。" />
    <form className="formCard" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void perform(() => api("projects", { method: "POST", body: JSON.stringify({ name: form.get("name"), goal: form.get("goal"), success_criteria: form.get("success") }) }), "项目已建立，可以连接算力了。");
    }}>
      <label><span>项目名称</span><input name="name" required maxLength={120} placeholder="例如：产品客服助手" /></label>
      <label><span>模型要完成什么</span><textarea name="goal" required maxLength={2000} rows={4} placeholder="例如：根据产品资料准确回答售前问题，并保持简洁。" /></label>
      <label><span>怎样算成功</span><textarea name="success" required maxLength={2000} rows={3} placeholder="例如：固定测试问题的格式通过率超过 90%，关键答案不遗漏。" /></label>
      <div className="formActions"><button className="primaryButton" disabled={busy} type="submit">{busy ? "正在建立…" : "建立项目"}</button></div>
    </form></>;
}

function ComputeStep({ runner, busy, perform }: { runner: Runner | null; busy: boolean; perform: Perform }) {
  const [pairing, setPairing] = useState<{ code: string; command: string; expires_at: string } | null>(null);
  const [copied, setCopied] = useState(false);
  if (runner && runner.status !== "offline") {
    const gpu = runner.capabilities.gpus?.[0];
    return <><SectionIntro eyebrow="算力已连接" title={runner.name} description="这台机器已经可以接收数据检查、训练和评测任务。" />
      <div className="computeCard ready"><div className="computeIcon">✓</div><div><span>当前可用</span><h2>{gpu?.name ?? "NVIDIA GPU"}</h2><p>{gpu ? `${runner.capabilities.gpus?.length ?? 1} 张 GPU · ${(gpu.memory_total_mb / 1024).toFixed(0)} GB 显存` : "能力信息正在同步"}</p></div><span className="statusBadge">在线</span></div>
      <div className="privacyCallout"><strong>数据边界保持不变</strong><p>网页只接收统计、进度和你主动授权的少量预览；原始文件、模型权重与 checkpoint 都留在这台机器。</p></div></>;
  }
  return <><SectionIntro eyebrow="第二步" title="连接一台你控制的 GPU。" description="连接程序只会主动访问网页服务，不需要开放公网端口或提供 SSH。" />
    {!pairing ? <div className="connectionStart"><div className="computeIllustration" aria-hidden="true"><span>GPU</span><i /></div><h2>准备一台 Linux x86_64 NVIDIA 主机</h2><p>确认已经安装并启动 Docker，然后生成一次性连接码。</p><button className="primaryButton" disabled={busy} type="button" onClick={() => void perform(async () => setPairing(await api("runners/pairing", { method: "POST", body: "{}" })), "连接码已生成，在 GPU 主机执行下面的命令。")}>{busy ? "正在生成…" : "生成连接码"}</button></div> :
      <div className="pairingCard"><div className="pairingHeader"><div><span>一次性连接码</span><strong>{pairing.code}</strong></div><small>{new Date(pairing.expires_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 前有效</small></div>
        <ol className="connectionInstructions"><li><span>1</span><div><strong>准备连接程序和训练环境</strong><code>make gpu-runtime</code></div></li><li><span>2</span><div><strong>执行连接命令</strong><pre>{pairing.command}</pre><button className="textButton" type="button" onClick={async () => { await navigator.clipboard.writeText(pairing.command); setCopied(true); }}>{copied ? "已复制" : "复制命令"}</button></div></li></ol>
        <p className="waitingLine"><span className="pulseDot" />正在等待算力连接，连接成功后本页会自动更新。</p></div>}
  </>;
}

function DataStep({ project, runner, dataset, busy, perform, moveTo }: { project: Project | null; runner: Runner | null; dataset: Dataset | null; busy: boolean; perform: Perform; moveTo: (step: Step) => void }) {
  const [sourceType, setSourceType] = useState<Dataset["source_type"]>("local");
  if (!project || !runner || runner.status === "offline") return <Prerequisite title="先完成前两步" text="建立项目并连接在线算力后，才能在用户环境中检查数据。" action="去连接算力" onClick={() => moveTo("compute")} />;
  if (dataset?.status === "checking") return <><SectionIntro eyebrow="正在准备数据" title="检查在你的环境中进行。" description="原始文件不会上传。完成后这里会显示质量问题、切分和长度风险。" /><ProgressPanel label="正在读取、去重并建立数据版本" progress={35} /></>;
  if (dataset?.status === "ready" && dataset.statistics) return <><SectionIntro eyebrow="数据已就绪" title={dataset.name} description="已形成不可变数据版本，训练和测试使用各自独立的切分。" /><DatasetReport dataset={dataset} /><div className="formActions"><button className="primaryButton" type="button" onClick={() => moveTo("train")}>用这份数据开始训练</button></div></>;
  return <><SectionIntro eyebrow="第三步" title="选择本地数据，先检查再训练。" description="填写算力数据目录内的相对路径；平台不会保存你的完整本地路径。" />
    {dataset?.status === "failed" ? <div className="inlineError">上一次数据检查失败，请确认文件路径、格式和字段后重新提交。</div> : null}
    <form className="formCard" onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void perform(() => api("datasets", { method: "POST", body: JSON.stringify({ project_id: project.id, runner_id: runner.id, name: form.get("name"), source_type: sourceType, source_ref: form.get("path"), format: form.get("format") ?? "json", instruction_field: form.get("instruction"), input_field: form.get("input"), output_field: form.get("output"), train_percent: 80, validation_percent: 10, test_percent: 10, preview_allowed: form.get("preview") === "on" }) }), "数据检查已开始，原始文件仍留在你的环境。 ");
    }}>
      <div className="formGrid"><label><span>数据名称</span><input name="name" required placeholder="例如：客服问答 v1" /></label><label><span>数据来源</span><select name="source_type" value={sourceType} onChange={(event) => setSourceType(event.target.value as Dataset["source_type"])}><option value="local">算力主机上的文件</option><option value="huggingface">Hugging Face 数据集</option><option value="modelscope">ModelScope 数据集</option><option value="s3">自己的 S3 存储</option></select></label></div>
      <div className="formGrid"><label><span>{sourceType === "local" ? "数据目录内的文件路径" : sourceType === "s3" ? "S3 数据地址" : "数据集标识"}</span><input name="path" required placeholder={sourceType === "local" ? "例如：support/train.jsonl" : sourceType === "s3" ? "例如：s3://my-bucket/train.jsonl" : "例如：组织名/数据集名"} /><small>{sourceType === "local" ? "不需要填写连接算力时设置的数据根目录。" : "数据由你的算力主机直接下载，不经过平台。"}</small></label><label><span>源数据格式</span><select name="format" defaultValue="jsonl"><option value="jsonl">JSONL</option><option value="json">JSON</option><option value="csv">CSV</option></select></label></div>
      <details className="advanced"><summary>字段对应关系</summary><div className="formGrid three"><label><span>指令字段</span><input name="instruction" defaultValue="instruction" required /></label><label><span>补充输入字段</span><input name="input" defaultValue="input" required /></label><label><span>正确答案字段</span><input name="output" defaultValue="output" required /></label></div></details>
      <label className="checkRow"><input name="preview" type="checkbox" /><span><strong>允许网页显示 3 条样本预览</strong><small>关闭时平台只接收统计结果，不接收任何样本文本。</small></span></label>
      <div className="splitPreview"><span>自动切分</span><strong>训练 80%</strong><strong>验证 10%</strong><strong>测试 10%</strong></div>
      <div className="formActions"><button className="primaryButton" disabled={busy} type="submit">{busy ? "正在提交…" : "检查并建立数据版本"}</button></div>
    </form></>;
}

function DatasetReport({ dataset }: { dataset: Dataset }) {
  const stats = dataset.statistics!;
  return <><div className="metricGrid"><article><span>可用样本</span><strong>{stats.valid_rows}</strong><small>原始 {stats.rows} 条</small></article><article><span>重复项</span><strong>{stats.duplicates}</strong><small>已从数据版本中排除</small></article><article><span>最长估算</span><strong>{stats.token_length.max}</strong><small>tokens</small></article><article><span>测试泄漏</span><strong>{stats.leakage.exact_matches}</strong><small>精确重复</small></article></div>
    <div className="reportCard"><div><span>训练集</span><strong>{stats.splits.train}</strong></div><div><span>验证集</span><strong>{stats.splits.validation}</strong></div><div><span>测试集</span><strong>{stats.splits.test}</strong></div><p>版本 {dataset.version_hash?.slice(0, 18)}…</p></div>
    {dataset.preview?.length ? <details className="previewDetails"><summary>查看已授权的样本预览</summary>{dataset.preview.map((item, index) => <article key={index}><span>样本 {index + 1}</span><p>{item.instruction}</p><small>{item.output}</small></article>)}</details> : null}</>;
}

function TrainStep({ project, runner, dataset, busy, perform, moveTo }: { project: Project | null; runner: Runner | null; dataset: Dataset | null; busy: boolean; perform: Perform; moveTo: (step: Step) => void }) {
  const [profile, setProfile] = useState("balanced");
  const [outputDestination, setOutputDestination] = useState<"local" | "user_s3">("local");
  const [selectedModel, setSelectedModel] = useState<string>(modelOptions[1][0]);
  if (!project || !runner || !dataset || dataset.status !== "ready") return <Prerequisite title="先准备好训练数据" text="数据检查完成后，系统才能给出可执行的训练方案。" action="去准备数据" onClick={() => moveTo("data")} />;
  const estimate = trainingEstimate(selectedModel, profile, dataset.statistics?.valid_rows ?? 0);
  return <><SectionIntro eyebrow="第四步" title="选择模型和训练强度。" description="系统会先测基础模型，再训练并用同一测试集复测。" />
    <form className="formCard" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const profiles: Record<string, { epochs: number; max_length: number; gradient_accumulation: number }> = { fast: { epochs: 1, max_length: 1024, gradient_accumulation: 4 }, balanced: { epochs: 3, max_length: 2048, gradient_accumulation: 8 }, thorough: { epochs: 5, max_length: 2048, gradient_accumulation: 8 } }; const selected = profiles[profile]; const formats = ["adapter", ...(form.get("huggingface") ? ["huggingface"] : []), ...(form.get("gguf") ? ["gguf"] : [])]; void perform(() => api("experiments", { method: "POST", body: JSON.stringify({ project_id: project.id, runner_id: runner.id, dataset_id: dataset.id, name: form.get("name"), model_id: form.get("model"), method: form.get("method"), ...selected, learning_rate: 0.0002, batch_size: 1, export_formats: formats, evaluation_preview_allowed: form.get("evaluation_preview") === "on", output_destination: outputDestination, output_s3_uri: form.get("s3_uri") || null, output_s3_endpoint: form.get("s3_endpoint") || null, license_confirmed: form.get("license_confirmed") === "on" }) }), "训练流程已启动，会先建立基础模型基线。 "); }}>
      <label><span>训练名称</span><input name="name" required defaultValue={`${project.name} · 第一次训练`} /></label>
      <fieldset className="choiceField"><legend>基础模型</legend><div className="modelChoices">{modelOptions.map(([id, name, description]) => <label key={id}><input type="radio" name="model" value={id} checked={selectedModel === id} onChange={() => setSelectedModel(id)} /><span><strong>{name}</strong><small>{description}</small></span></label>)}</div></fieldset>
      <fieldset className="choiceField"><legend>训练强度</legend><div className="profileChoices">{[["fast", "快速试跑", "1 轮 · 尽快验证"], ["balanced", "均衡推荐", "3 轮 · 适合首个结果"], ["thorough", "充分训练", "5 轮 · 花费更多时间"]].map(([value, name, description]) => <label key={value} className={profile === value ? "selected" : ""}><input type="radio" name="profile" value={value} checked={profile === value} onChange={() => setProfile(value)} /><strong>{name}</strong><small>{description}</small></label>)}</div></fieldset>
      <details className="advanced"><summary>显存、评测与导出设置</summary><div className="formGrid"><label><span>显存方案</span><select name="method" defaultValue="qlora"><option value="qlora">节省显存（推荐）</option><option value="lora">更高精度</option></select></label><div className="checkStack"><label><input type="checkbox" name="evaluation_preview" /><span>允许网页显示 3 组盲测结果</span></label><label><input type="checkbox" name="huggingface" /><span>同时生成完整 Hugging Face 模型</span></label><label><input type="checkbox" name="gguf" /><span>同时生成 GGUF 文件</span></label></div><label><span>产物保存位置</span><select name="output_destination" value={outputDestination} onChange={(event) => setOutputDestination(event.target.value as "local" | "user_s3")}><option value="local">算力主机结果目录</option><option value="user_s3">自己的 S3 存储</option></select></label>{outputDestination === "user_s3" ? <div><label><span>S3 目标地址</span><input name="s3_uri" required placeholder="s3://my-bucket/models/run-1" /></label><label><span>S3 兼容服务地址（可选）</span><input name="s3_endpoint" placeholder="https://s3.example.com" /></label><small className="fieldHelp">访问凭证只从算力主机环境读取，不会发送到平台。</small></div> : null}</div></details>
      <div className="runSummary"><div><span>流程</span><strong>基线 → 训练 → 选版本 → 复测 → 导出</strong></div><div><span>预计显存</span><strong>{estimate.memory}</strong></div><div><span>预计训练时间</span><strong>{estimate.time}</strong></div><div><span>预计结果空间</span><strong>{estimate.disk}</strong></div></div>
      <label className="consentRow"><input type="checkbox" name="license_confirmed" required /><span>我确认有权使用所选模型和这份数据进行训练</span></label>
      <div className="formActions"><button className="primaryButton" disabled={busy} type="submit">{busy ? "正在启动…" : "开始训练"}</button></div>
    </form></>;
}

function MonitorStep({ experiment, jobs, runner, busy, perform, moveTo }: { experiment: Experiment | null; jobs: Job[]; runner: Runner | null; busy: boolean; perform: Perform; moveTo: (step: Step) => void }) {
  if (!experiment) return <Prerequisite title="还没有训练实验" text="选择模型与训练强度后，这里会持续显示真实进度与效果。" action="设置训练" onClick={() => moveTo("train")} />;
  const experimentJobs = jobs.filter((job) => job.experiment_id === experiment.id).reverse();
  const activeJob = experimentJobs.find((job) => ["leased", "running", "paused"].includes(job.status));
  const logs = experimentJobs.flatMap((job) => job.events.filter((event) => event.message && ["log", "failed", "progress"].includes(event.type)).map((event) => ({ ...event, job: job.kind }))).slice(-30).reverse();
  const percent = Math.round(experimentJobs.reduce((sum, job) => sum + (job.status === "completed" ? 100 : job.progress), 0) / Math.max(experimentJobs.length, 1));
  return <><SectionIntro eyebrow={experiment.status === "completed" ? "训练已完成" : "训练进行中"} title={stageLabels[experiment.current_stage] ?? "正在准备"} description={experiment.status === "completed" ? "基础模型与微调模型已经在同一测试集上完成比较。" : "网页可以关闭；任务由你的 GPU 主机继续执行，回来后进度会自动追平。"} />
    {experiment.status === "failed" ? <div className="failurePanel"><strong>本次训练没有完成</strong><p>{experimentJobs.find((job) => job.status === "failed")?.error ?? "请展开运行记录查看具体原因。"}</p></div> : null}
    <ProgressPanel label={`${percent}% · ${stageLabels[experiment.current_stage] ?? "准备中"}`} progress={percent} />
    {runner?.capabilities.gpus?.length && experiment.status !== "completed" ? <GpuLive runner={runner} /> : null}
    <div className="stageGrid">{experimentJobs.map((job) => <article key={job.id} className={job.status}><span>{job.status === "completed" ? "✓" : job.status === "running" || job.status === "leased" ? "●" : job.status === "failed" ? "!" : "○"}</span><div><strong>{jobLabels[job.kind]}</strong><small>{jobStatus(job.status)}</small></div></article>)}</div>
    {experiment.status === "awaiting_selection" && experiment.checkpoints?.length ? <CheckpointPicker experiment={experiment} busy={busy} perform={perform} /> : null}
    {activeJob?.kind === "train" ? <div className="controlRow"><button className="secondaryButton" disabled={busy} type="button" onClick={() => void perform(() => api(`jobs/${activeJob.id}/control`, { method: "POST", body: JSON.stringify({ action: activeJob.status === "paused" ? "resume" : "pause" }) }), activeJob.status === "paused" ? "训练将从暂停处继续。" : "训练会保留当前进度并暂停。")}>{activeJob.status === "paused" ? "继续训练" : "暂停训练"}</button><button className="dangerButton" disabled={busy} type="button" onClick={() => { if (window.confirm("确定取消这次训练吗？已经生成的本地产物不会被自动删除。")) void perform(() => api(`jobs/${activeJob.id}/control`, { method: "POST", body: JSON.stringify({ action: "cancel" }) }), "取消指令已发送。 "); }}>取消训练</button></div> : null}
    {(experiment.baseline_metrics || experiment.tuned_metrics) ? <><Comparison baseline={experiment.baseline_metrics} tuned={experiment.tuned_metrics} /><Performance metrics={experiment.tuned_metrics ?? experiment.baseline_metrics} /></> : null}
    {experiment.evaluation_samples?.baseline?.length && experiment.evaluation_samples?.tuned?.length ? <BlindReview baseline={experiment.evaluation_samples.baseline} tuned={experiment.evaluation_samples.tuned} /> : null}
    <details className="logPanel"><summary>查看运行记录</summary><div>{logs.length ? logs.map((event) => <p key={event.id}><span>{jobLabels[event.job as Job["kind"]]}</span>{event.message}</p>) : <p>正在等待第一条运行记录…</p>}</div></details>
    {experiment.status === "completed" ? <div className="formActions"><button className="primaryButton" type="button" onClick={() => moveTo("model")}>查看模型产物</button></div> : null}</>;
}

function Comparison({ baseline, tuned }: { baseline: Metrics | null; tuned: Metrics | null }) {
  const metrics = [["答案完全一致", "exact_match"], ["格式通过", "format_pass_rate"]] as const;
  return <section className="comparison"><div className="cardHeading"><div><span>同一测试集对比</span><h2>{tuned ? "训练前后效果" : "基础模型基线"}</h2></div>{tuned ? <strong className="evidenceBadge">已完成复测</strong> : <small>等待训练后复测</small>}</div>{metrics.map(([label, key]) => { const before = baseline?.[key] ?? 0; const after = tuned?.[key]; const change = after === undefined ? null : after - before; return <div className="metricCompare" key={key}><div><span>{label}</span>{change === null ? null : <strong className={change >= 0 ? "positive" : "negative"}>{change >= 0 ? "+" : ""}{(change * 100).toFixed(1)}%</strong>}</div><div className="barRow"><small>训练前</small><i><b style={{ width: `${before * 100}%` }} /></i><em>{(before * 100).toFixed(1)}%</em></div>{after === undefined ? null : <div className="barRow tuned"><small>训练后</small><i><b style={{ width: `${after * 100}%` }} /></i><em>{(after * 100).toFixed(1)}%</em></div>}</div>; })}</section>;
}

function Performance({ metrics }: { metrics: Metrics | null }) {
  if (!metrics) return null;
  const values = [
    ["首字响应", metrics.first_token_latency_ms === undefined ? "—" : `${metrics.first_token_latency_ms.toFixed(0)} ms`],
    ["生成速度", metrics.tokens_per_second === undefined ? "—" : `${metrics.tokens_per_second.toFixed(1)} token/s`],
    ["峰值显存", metrics.peak_gpu_memory_mb === undefined ? "—" : `${(metrics.peak_gpu_memory_mb / 1024).toFixed(1)} GB`],
    ["模型体积", metrics.model_size_mb === undefined ? "—" : `${(metrics.model_size_mb / 1024).toFixed(1)} GB`],
  ];
  return <section className="performance"><div className="cardHeading"><div><span>本机运行表现</span><h2>速度与资源代价</h2></div></div><div>{values.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div></section>;
}

function GpuLive({ runner }: { runner: Runner }) {
  const gpus = runner.capabilities.gpus ?? [];
  const used = gpus.reduce((sum, gpu) => sum + gpu.memory_total_mb - gpu.memory_free_mb, 0);
  const total = gpus.reduce((sum, gpu) => sum + gpu.memory_total_mb, 0);
  const utilization = gpus.reduce((sum, gpu) => sum + (gpu.utilization_percent ?? 0), 0) / Math.max(gpus.length, 1);
  const hottest = Math.max(...gpus.map((gpu) => gpu.temperature_c ?? 0));
  return <div className="gpuLive"><div><span>GPU 使用率</span><strong>{utilization.toFixed(0)}%</strong></div><div><span>显存</span><strong>{(used / 1024).toFixed(1)} / {(total / 1024).toFixed(1)} GB</strong></div><div><span>温度</span><strong>{hottest || "—"}{hottest ? "°C" : ""}</strong></div></div>;
}

function CheckpointPicker({ experiment, busy, perform }: { experiment: Experiment; busy: boolean; perform: Perform }) {
  const [selected, setSelected] = useState(experiment.checkpoints?.find((item) => item.recommended)?.reference ?? experiment.checkpoints?.[0]?.reference ?? "adapter");
  return <section className="checkpointPicker"><div className="cardHeading"><div><span>训练版本</span><h2>选择一个版本继续评测</h2></div><small>推荐项来自最低验证损失</small></div><div>{experiment.checkpoints?.map((checkpoint) => <label className={selected === checkpoint.reference ? "selected" : ""} key={checkpoint.reference}><input type="radio" name="checkpoint" value={checkpoint.reference} checked={selected === checkpoint.reference} onChange={() => setSelected(checkpoint.reference)} /><span><strong>{checkpoint.label}{checkpoint.recommended ? " · 推荐" : ""}</strong><small>{checkpoint.validation_loss === undefined ? "训练完成版本" : `验证损失 ${checkpoint.validation_loss.toFixed(4)}`}</small></span></label>)}</div><div className="formActions"><button className="primaryButton" disabled={busy} type="button" onClick={() => void perform(() => api(`experiments/${experiment.id}/select-checkpoint`, { method: "POST", body: JSON.stringify({ checkpoint_ref: selected }) }), "已选定模型版本，正在用固定测试集复测。")}>{busy ? "正在继续…" : "选定并继续评测"}</button></div></section>;
}

function BlindReview({ baseline, tuned }: { baseline: EvaluationSample[]; tuned: EvaluationSample[] }) {
  return <details className="blindReview"><summary>查看盲测样本</summary><p>候选顺序固定打散，先看回答再判断哪一个更好。</p>{baseline.slice(0, 3).map((before, index) => { const after = tuned[index]; if (!after) return null; const swap = index % 2 === 1; const candidates = swap ? [after.prediction, before.prediction] : [before.prediction, after.prediction]; return <article key={`${before.instruction}-${index}`}><header><span>问题 {index + 1}</span><strong>{before.instruction}</strong></header><div><section><span>候选 A</span><p>{candidates[0]}</p></section><section><span>候选 B</span><p>{candidates[1]}</p></section></div></article>; })}</details>;
}

function ModelStep({ experiment, moveTo }: { experiment: Experiment | null; moveTo: (step: Step) => void }) {
  if (!experiment || experiment.status !== "completed" || !experiment.artifacts?.length) return <Prerequisite title="模型还没有准备好" text="训练、同集复测和导出全部完成后，产物会出现在这里。" action="查看训练进度" onClick={() => moveTo("monitor")} />;
  return <><SectionIntro eyebrow="最后一步" title="模型已经留在你的环境。" description="下面是相对于你设置的结果目录的位置；平台没有复制或托管模型文件。" />
    <div className="artifactList">{experiment.artifacts.map((artifact) => <article key={artifact.format}><span className="artifactIcon">{artifact.format === "gguf" ? "G" : artifact.format === "huggingface" ? "HF" : "A"}</span><div><strong>{artifactLabel(artifact.format)}</strong><code>{artifact.reference}</code></div><span className="readyLabel">已生成</span></article>)}</div>
    <Comparison baseline={experiment.baseline_metrics} tuned={experiment.tuned_metrics} />
    <Performance metrics={experiment.tuned_metrics} />
    {experiment.evaluation_samples?.baseline?.length && experiment.evaluation_samples?.tuned?.length ? <BlindReview baseline={experiment.evaluation_samples.baseline} tuned={experiment.evaluation_samples.tuned} /> : null}
    <div className="resultNote"><strong>这次结果可核验</strong><p>产物绑定了数据版本、基础模型、训练设置和同一测试集上的前后指标。只有这些证据完成后，LLMWEB 才把实验标记为完成。</p></div></>;
}

function ProgressPanel({ label, progress }: { label: string; progress: number }) { return <div className="progressPanel"><div><strong>{label}</strong><span>{progress}%</span></div><i><b style={{ width: `${Math.max(3, progress)}%` }} /></i></div>; }
function Prerequisite({ title, text, action, onClick }: { title: string; text: string; action: string; onClick: () => void }) { return <div className="emptyState"><span>→</span><h1>{title}</h1><p>{text}</p><button className="primaryButton" type="button" onClick={onClick}>{action}</button></div>; }
function runnerStatus(runner: Runner | null) { if (!runner) return "等待连接"; if (runner.status === "busy") return "正在执行任务"; if (runner.status === "online") return "在线可用"; return "当前离线"; }
function jobStatus(status: Job["status"]) { return ({ blocked: "等待选择版本", queued: "等待算力开始", leased: "正在开始", running: "进行中", paused: "已暂停", completed: "已完成", failed: "未完成", cancelled: "已取消" } as const)[status]; }
function artifactLabel(format: string) { return ({ adapter: "LoRA Adapter", huggingface: "Hugging Face 完整模型", gguf: "GGUF 模型" } as Record<string, string>)[format] ?? format; }
function trainingEstimate(model: string, profile: string, rows: number) { const billions = model.includes("0.5B") ? 0.5 : model.includes("1.5B") ? 1.5 : 3; const epochs = profile === "fast" ? 1 : profile === "thorough" ? 5 : 3; const minutes = Math.max(4, Math.ceil(rows * epochs * billions / 90)); return { memory: `${Math.ceil(4 + billions * 1.7)}–${Math.ceil(6 + billions * 2.2)} GB`, time: minutes < 60 ? `${minutes}–${Math.ceil(minutes * 1.8)} 分钟` : `${(minutes / 60).toFixed(1)}–${(minutes * 1.8 / 60).toFixed(1)} 小时`, disk: `${Math.ceil(billions * 2.2 + 1)}–${Math.ceil(billions * 4.5 + 2)} GB` }; }
