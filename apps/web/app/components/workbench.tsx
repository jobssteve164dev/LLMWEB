"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthScreen } from "./auth-screen";
import { LanguageSwitcher, useLanguage } from "./language-provider";
import { localeTag, type Locale } from "../lib/i18n";
import type { ApiActivity, ApiConnection, Dataset, EvaluationSample, Experiment, Job, Metrics, Project, Runner, WorkspaceState } from "../lib/types";

type Step = "project" | "compute" | "data" | "train" | "monitor" | "model" | "settings";
const currentProjectStorageKey = "llmweb_current_project:v1";

function loadCurrentProject() {
  try { return window.localStorage.getItem(currentProjectStorageKey); } catch { return null; }
}

function saveCurrentProject(projectId: string | null) {
  try {
    if (projectId) window.localStorage.setItem(currentProjectStorageKey, projectId);
    else window.localStorage.removeItem(currentProjectStorageKey);
  } catch {}
}

function ProjectMenu({ projects, currentProjectId, busy, canCreate, onSelect, onCreate, onRename, onDelete }: {
  projects: Project[];
  currentProjectId: string | null;
  busy: boolean;
  canCreate: boolean;
  onSelect: (projectId: string) => void;
  onCreate: () => void;
  onRename: (projectId: string, name: string) => Promise<boolean>;
  onDelete: (project: Project) => Promise<boolean>;
}) {
  const { locale } = useLanguage();
  const english = locale === "en";
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const current = projects.find((project) => project.id === currentProjectId) ?? projects[0];

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditingId(null);
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  if (!current) return <span>{english ? "Create your first project" : "建立第一个项目"}</span>;

  return <div className="projectMenu" ref={rootRef}>
    <button className="projectMenuTrigger" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span>{current.name}</span>
      <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m6 8 4 4 4-4" /></svg>
    </button>
    {open ? <div className="projectMenuPanel" role="dialog" aria-label={english ? "Projects" : "项目列表"}>
      <div className="projectMenuHeading"><span>{english ? "Projects" : "项目"}</span>{canCreate ? <button type="button" onClick={() => { setOpen(false); onCreate(); }}>{english ? "New project" : "新建项目"}</button> : null}</div>
      <div className="projectMenuList">
        {projects.map((project) => editingId === project.id ? <form className="projectRename" key={project.id} onSubmit={(event) => {
          event.preventDefault();
          const name = draftName.trim();
          if (!name || name === project.name) { setEditingId(null); return; }
          void onRename(project.id, name).then((saved) => { if (saved) setEditingId(null); });
        }}>
          <input autoFocus aria-label={english ? `Rename ${project.name}` : `重命名${project.name}`} value={draftName} maxLength={120} onChange={(event) => setDraftName(event.target.value)} />
          <button className="projectIconButton confirm" disabled={busy || !draftName.trim()} type="submit" aria-label={english ? "Save project name" : "保存项目名称"} title={english ? "Save" : "保存"}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m4 10 4 4 8-9" /></svg></button>
          <button className="projectIconButton" disabled={busy} type="button" onClick={() => setEditingId(null)} aria-label={english ? "Cancel renaming" : "取消重命名"} title={english ? "Cancel" : "取消"}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
        </form> : <div className={project.id === currentProjectId ? "projectMenuRow active" : "projectMenuRow"} key={project.id}>
          <button className="projectSelectButton" type="button" onClick={() => { onSelect(project.id); setOpen(false); }}><span>{project.name}</span>{project.id === currentProjectId ? <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m4 10 4 4 8-9" /></svg> : null}</button>
          <button className="projectIconButton" type="button" onClick={() => { setEditingId(project.id); setDraftName(project.name); }} aria-label={english ? `Rename ${project.name}` : `重命名${project.name}`} title={english ? "Rename" : "编辑名称"}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m4 14-.5 2.5L6 16l9-9-2-2-9 9Zm7.5-7.5 2 2" /></svg></button>
          <button className="projectIconButton danger" disabled={busy} type="button" onClick={() => void onDelete(project).then((deleted) => { if (deleted) setOpen(false); })} aria-label={english ? `Delete ${project.name}` : `删除${project.name}`} title={english ? "Delete" : "删除"}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 6h12M8 3h4l1 3H7l1-3Zm-2 3 1 11h6l1-11M9 9v5m2-5v5" /></svg></button>
        </div>)}
      </div>
    </div> : null}
  </div>;
}

function workflowSteps(locale: Locale): Array<{ id: Step; label: string; short: string }> { return locale === "en" ? [
  { id: "project", label: "Define goal", short: "Project" }, { id: "compute", label: "Connect computer", short: "Compute" }, { id: "data", label: "Prepare data", short: "Data" }, { id: "train", label: "Start training", short: "Train" }, { id: "monitor", label: "Review results", short: "Evaluate" }, { id: "model", label: "Get model", short: "Model" },
] : [
  { id: "project", label: "说出目标", short: "项目" }, { id: "compute", label: "连接电脑", short: "算力" }, { id: "data", label: "准备练习", short: "数据" }, { id: "train", label: "开始训练", short: "训练" }, { id: "monitor", label: "查看效果", short: "评测" }, { id: "model", label: "取得模型", short: "模型" },
]; }

const stepPaths: Record<Step, string> = {
  project: "/workbench/project",
  compute: "/workbench/compute",
  data: "/workbench/data",
  train: "/workbench/train",
  monitor: "/workbench/evaluation",
  model: "/workbench/models",
  settings: "/workbench/settings",
};

function stepFromPath(pathname: string): Step {
  return (Object.entries(stepPaths).find(([, path]) => path === pathname)?.[0] as Step | undefined) ?? "project";
}

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
    const english = document.documentElement.lang.startsWith("en");
    if (response.status === 401) throw new SessionRequiredError(payload?.detail ?? (english ? "Please sign in." : "请先登录。 "));
    throw new Error(payload?.detail ?? (english ? "The action could not be completed. Please try again." : "操作没有完成，请稍后重试。 "));
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

class SessionRequiredError extends Error {}

function deriveStep(state: WorkspaceState): Step {
  if (!state.current_project_id) return "project";
  if (state.experiments[0]?.status === "completed") return "monitor";
  if (state.experiments.length > 0) return "monitor";
  if (!state.runners.some((runner) => runner.status !== "offline")) return "compute";
  if (!state.datasets.some((dataset) => dataset.status === "ready")) return "data";
  return "train";
}

export function Workbench() {
  const { locale } = useLanguage();
  const english = locale === "en";
  const steps = workflowSteps(locale);
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [manualStep, setManualStep] = useState(true);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const selectedProjectId = useRef<string | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    try {
      const selector = selectedProjectId.current ? `?project_id=${encodeURIComponent(selectedProjectId.current)}` : "";
      const next = await api<WorkspaceState>(`state${selector}`, { cache: "no-store" });
      if (next.current_project_id && selectedProjectId.current !== next.current_project_id) {
        selectedProjectId.current = next.current_project_id;
        saveCurrentProject(next.current_project_id);
      }
      setState(next);
      setLocked(false);
      if (!manualStep) {
        const nextStep = deriveStep(next);
        router.replace(stepPaths[nextStep]);
      }
      if (!quiet) setNotice(null);
    } catch (error) {
      if (error instanceof SessionRequiredError) {
        setLocked(true);
        return;
      }
      if (selectedProjectId.current && error instanceof Error && error.message === "项目不存在") {
        selectedProjectId.current = null;
        saveCurrentProject(null);
        const next = await api<WorkspaceState>("state", { cache: "no-store" });
        if (next.current_project_id) {
          selectedProjectId.current = next.current_project_id;
          saveCurrentProject(next.current_project_id);
        }
        setState(next);
        setLocked(false);
        if (!manualStep) {
          const nextStep = deriveStep(next);
          router.replace(stepPaths[nextStep]);
        }
        if (!quiet) setNotice(null);
        return;
      }
      if (!quiet) setNotice({ kind: "error", text: error instanceof Error ? error.message : document.documentElement.lang.startsWith("en") ? "The training service is temporarily unavailable." : "训练服务暂时不可用。" });
    }
  }, [manualStep, router, setNotice]);

  useEffect(() => {
    if (locked) return;
    selectedProjectId.current = loadCurrentProject();
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(true), 3000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [locked, refresh]);

  const project = state?.projects.find((item) => item.id === state.current_project_id) ?? null;
  const runner = state?.runners.find((item) => item.status !== "offline") ?? state?.runners[0] ?? null;
  const dataset = state?.datasets.find((item) => item.status === "ready") ?? state?.datasets[0] ?? null;
  const experiment = state?.experiments[0] ?? null;
  const activeStep = stepFromPath(pathname);

  const moveTo = (step: Step) => {
    setManualStep(true);
    setNotice(null);
    router.push(stepPaths[step]);
  };

  const selectProject = (projectId: string) => {
    selectedProjectId.current = projectId;
    saveCurrentProject(projectId);
    setCreatingProject(false);
    setManualStep(false);
    setNotice(null);
    void refresh();
  };

  const signOut = async () => {
    await fetch("/api/session", { method: "DELETE" });
    saveCurrentProject(null);
    selectedProjectId.current = null;
    setState(null);
    setLocked(true);
  };

  const perform = async (action: () => Promise<unknown>, success: string, autoAdvance = true): Promise<boolean> => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await refresh(true);
      if (autoAdvance) setManualStep(false);
      setNotice({ kind: "success", text: success });
      window.setTimeout(() => setNotice((current) => current?.text === success ? null : current), 4500);
      return true;
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : english ? "The action could not be completed." : "操作没有完成。" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const renameProject = (projectId: string, name: string) => perform(
    () => api(`projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    english ? "Project name updated." : "项目名称已更新。",
    false,
  );

  const deleteProject = async (target: Project) => {
    const confirmed = window.confirm(english
      ? `Delete “${target.name}”? Its data checks, training records, and model references will be removed from the workbench. Files already saved on your computer will remain.`
      : `确定删除“${target.name}”吗？工作台中的数据检查、训练记录和模型引用会一并删除；已经保存在你电脑上的文件不会被删除。`);
    if (!confirmed) return false;
    return perform(async () => {
      await api(`projects/${target.id}`, { method: "DELETE" });
      if (selectedProjectId.current === target.id) {
        selectedProjectId.current = null;
        saveCurrentProject(null);
      }
    }, english ? "Project deleted." : "项目已删除。");
  };

  if (!state) {
    if (locked) {
      return <AuthScreen onAuthenticated={() => { setLocked(false); void refresh(); }} />;
    }
    return (
      <main className="loadingScreen">
        <span className="brandMark" aria-hidden="true">L</span>
        <p>{english ? "Opening your training workbench…" : "正在打开你的训练工作台…"}</p>
        {notice ? <p className="inlineError">{notice.text}</p> : null}
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <div className="appHeaderInner">
          <button className="brandButton" type="button" onClick={() => moveTo(deriveStep(state))}>
            <span className="brandMark" aria-hidden="true">L</span>
            <span>LLMWEB</span>
          </button>
          <div className="headerMain">
            <div className="headerContext">
              <ProjectMenu projects={state.projects} currentProjectId={state.current_project_id} busy={busy} canCreate={state.project_quota.remaining > 0} onSelect={selectProject} onCreate={() => { setCreatingProject(true); moveTo("project"); }} onRename={renameProject} onDelete={deleteProject} />
              <span className="quotaPill">{state.project_quota.used}/{state.project_quota.limit} {english ? "projects" : "个项目"}</span>
              {state.project_quota.remaining > 0 ? <button className="headerAction" type="button" onClick={() => { setCreatingProject(true); moveTo("project"); }}>{english ? "New project" : "新建项目"}</button> : null}
              <span className="privacyPill"><span aria-hidden="true">●</span> {english ? "Raw data stays in your environment" : "原始数据留在你的环境"}</span>
            </div>
            <div className="headerUtilities">
              <LanguageSwitcher />
              <div className="mobileAccountActions">
                {state.account.plan === "free" ? <Link href="/#pricing">{english ? "Plans" : "产品计划"}</Link> : null}
                {state.account.plan === "paid" ? <button type="button" onClick={() => moveTo("settings")}>{english ? "Settings" : "设置"}</button> : null}
                <button type="button" onClick={() => void signOut()}>{english ? "Sign out" : "退出"}</button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="workspaceLayout">
        <aside className="stepRail" aria-label={english ? "Training workflow" : "训练流程"}>
          <p className="railTitle">{english ? "Training workflow" : "训练流程"}</p>
          <ol>
            {steps.map((step, index) => {
              const complete = index < steps.findIndex((item) => item.id === deriveStep(state)) || deriveStep(state) === "model";
              return (
                <li key={step.id}>
                  <Link
                    className={step.id === activeStep ? "active" : ""}
                    href={stepPaths[step.id]}
                    onClick={() => {
                      setManualStep(true);
                      setNotice(null);
                    }}
                    aria-current={step.id === activeStep ? "step" : undefined}
                  >
                    <span className={complete ? "stepNumber complete" : "stepNumber"}>{complete ? "✓" : index + 1}</span>
                    <span><strong>{step.label}</strong><small>{step.short}</small></span>
                  </Link>
                </li>
              );
            })}
          </ol>
          <div className="railFooter">
            <div className="railSummary">
              <span className={runner?.status === "online" || runner?.status === "busy" ? "liveDot" : "idleDot"} />
              <div><strong>{runner?.name ?? (english ? "No compute connected" : "尚未连接算力")}</strong><small>{runnerStatus(runner, locale)}</small></div>
            </div>
            <div className="railAccount">
              <div className="railAccountIdentity">
                <span aria-hidden="true">{(state.account.name || state.account.email).trim().charAt(0).toUpperCase()}</span>
                <div><div className="railAccountName"><strong>{state.account.name || (english ? "My account" : "我的账户")}</strong><span className={`accountPlanTag ${state.account.plan}`}>{state.account.plan === "paid" ? "Pro" : "Free"}</span></div><small>{state.account.email}</small></div>
              </div>
              <div className="railAccountActions">
                {state.account.plan === "free" ? <Link href="/#pricing">{english ? "View plans" : "查看产品计划"}</Link> : null}
                {state.account.plan === "paid" ? <button className={activeStep === "settings" ? "active" : ""} type="button" onClick={() => moveTo("settings")} aria-current={activeStep === "settings" ? "page" : undefined}>{english ? "Settings" : "设置"}</button> : null}
                <button type="button" onClick={() => void signOut()}>{english ? "Sign out" : "退出账户"}</button>
              </div>
            </div>
          </div>
        </aside>

        <section className="workAreaScroll">
          <div className="workArea">
            {notice ? <div className={`notice ${notice.kind}`} role="status">{notice.text}<button type="button" onClick={() => setNotice(null)} aria-label={english ? "Dismiss" : "关闭提示"}>×</button></div> : null}
            {activeStep === "project" ? <ProjectStep project={project} quota={state.project_quota} forceCreate={creatingProject} busy={busy} perform={perform} moveTo={moveTo} onCreated={selectProject} onStartCreate={() => setCreatingProject(true)} onCancel={() => setCreatingProject(false)} /> : null}
            {activeStep === "compute" ? <ComputeStep runner={runner} busy={busy} perform={perform} /> : null}
            {activeStep === "data" ? <DataStep project={project} runner={runner} dataset={dataset} busy={busy} perform={perform} moveTo={moveTo} /> : null}
            {activeStep === "train" ? <TrainStep project={project} runner={runner} dataset={dataset} busy={busy} perform={perform} moveTo={moveTo} /> : null}
            {activeStep === "monitor" ? <MonitorStep experiment={experiment} jobs={state.jobs} runner={runner} busy={busy} perform={perform} moveTo={moveTo} /> : null}
            {activeStep === "model" ? <ModelStep experiment={experiment} moveTo={moveTo} /> : null}
            {activeStep === "settings" ? state.account.plan === "paid" ? <SettingsStep account={state.account} /> : <Prerequisite title={english ? "API connections are a Pro feature" : "API 连接仅对 Pro 用户开放"} text={english ? "Upgrade to connect the workbench to automation services and manage multiple projects." : "升级后即可连接自动化服务，并同时管理多个训练项目。"} action={english ? "Upgrade to Pro" : "升级 Pro"} onClick={() => { window.location.href = "/api/billing/checkout"; }} /> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function capabilityOptions(locale: Locale) { return locale === "en" ? [
  { id: "workspace:read", label: "View workbench status and training results" }, { id: "project:write", label: "Manage projects and data preparation" }, { id: "runner:pair", label: "Connect compute" }, { id: "training:write", label: "Start, pause, and resume training" }, { id: "artifact:read", label: "Read model artifact information" },
] as const : [
  { id: "workspace:read", label: "查看工作台状态和训练结果" }, { id: "project:write", label: "管理项目和数据准备" }, { id: "runner:pair", label: "连接算力" }, { id: "training:write", label: "启动、暂停和继续训练" }, { id: "artifact:read", label: "读取模型产物信息" },
] as const; }

function SettingsStep({ account }: { account: WorkspaceState["account"] }) {
  const { locale } = useLanguage();
  const english = locale === "en";
  const apiCapabilityOptions = capabilityOptions(locale);
  const [connections, setConnections] = useState<ApiConnection[]>([]);
  const [activity, setActivity] = useState<ApiActivity[]>([]);
  const [credential, setCredential] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const payload = await api<{ connections: ApiConnection[]; recent_activity: ApiActivity[] }>("api-connections", { cache: "no-store" });
    setConnections(payload.connections);
    setActivity(payload.recent_activity);
  }, []);

  useEffect(() => {
    let active = true;
    void api<{ connections: ApiConnection[]; recent_activity: ApiActivity[] }>("api-connections", { cache: "no-store" })
      .then((payload) => {
        if (!active) return;
        setConnections(payload.connections);
        setActivity(payload.recent_activity);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : english ? "API connections are temporarily unavailable." : "API 连接暂时无法读取。"); });
    return () => { active = false; };
  }, [english]);

  const execute = async (action: () => Promise<{ credential?: string } | void>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result?.credential) setCredential(result.credential);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : english ? "The action could not be completed." : "操作没有完成。");
    } finally {
      setBusy(false);
    }
  };

  return <><SectionIntro eyebrow={english ? "Account settings" : "账户设置"} title={english ? "API connections" : "API 连接"} description={english ? "Connect your training workbench to automation services you trust. Each connection belongs only to this account and can be revoked at any time." : "把你的训练工作台接到自己信任的自动化服务。每个连接只代表当前账户，并且可以随时撤销。"} />
    {error ? <div className="notice error" role="alert">{error}</div> : null}
    <form className="apiConnectionCreate" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const capabilities = apiCapabilityOptions.filter((item) => form.get(item.id) === "on").map((item) => item.id);
      const formElement = event.currentTarget;
      void execute(async () => {
        const result = await api<{ credential: string }>("api-connections", { method: "POST", body: JSON.stringify({ name: form.get("name"), purpose: form.get("purpose"), capabilities }) });
        formElement.reset();
        return result;
      });
    }}>
      <div><span>{english ? "New connection" : "新连接"}</span><h2>{english ? "Connect an automation service" : "连接你的调用服务"}</h2><p>{english ? "Create separate connections for different services so you can rotate or revoke them independently." : "为不同服务分别创建连接，之后可以单独轮换或撤销。"}</p></div>
      <label>{english ? "Connection name" : "连接名称"}<input name="name" required maxLength={120} placeholder={english ? "For example: My training assistant" : "例如：我的训练助手"} /></label>
      <label>{english ? "Purpose" : "用途说明"}<input name="purpose" required maxLength={500} placeholder={english ? "For example: Start and review training from our team automation" : "例如：从团队自动化服务启动并查看训练"} /></label>
      <fieldset><legend>{english ? "Allow it to" : "允许它完成"}</legend>{apiCapabilityOptions.map((item) => <label key={item.id}><input defaultChecked name={item.id} type="checkbox" />{item.label}</label>)}</fieldset>
      <button className="primaryButton" disabled={busy} type="submit">{busy ? (english ? "Creating…" : "正在创建…") : (english ? "Create API connection" : "创建 API 连接")}</button>
    </form>
    {credential ? <div className="credentialReveal" role="status"><div><strong>{english ? "Save this credential now" : "请现在保存凭证"}</strong><p>{english ? "It is shown only once. Give it only to a trusted service; rotate it if lost." : "这是唯一一次显示。只交给你信任的调用服务；丢失后请轮换。"}</p></div><code>{credential}</code><button className="secondaryButton" type="button" onClick={() => void navigator.clipboard.writeText(credential)}>{english ? "Copy credential" : "复制凭证"}</button><button className="textButton" type="button" onClick={() => setCredential(null)}>{english ? "Saved" : "我已保存"}</button></div> : null}
    <div className="apiConnectionList">{connections.length ? connections.map((connection) => <article key={connection.id} className={connection.status === "revoked" ? "revoked" : ""}>
      <header><div><span>{connection.status === "active" ? (english ? "Connected" : "已连接") : (english ? "Revoked" : "已撤销")}</span><h3>{connection.name}</h3><p>{connection.purpose}</p></div><small>{english ? "Credential ending" : "凭证尾号"} · {connection.credential_hint}</small></header>
      <ul>{connection.capabilities.map((capability) => <li key={capability}>{apiCapabilityOptions.find((item) => item.id === capability)?.label ?? capability}</li>)}</ul>
      <footer><span>{connection.last_used_at ? `${english ? "Last used" : "最近使用"} ${new Date(connection.last_used_at).toLocaleString(localeTag(locale))}` : (english ? "Never used" : "尚未使用")}</span>{connection.status === "active" ? <div><button className="secondaryButton" disabled={busy} type="button" onClick={() => { if (window.confirm(english ? "The old credential will stop working immediately. Continue?" : "轮换后旧凭证会立即失效。确定继续吗？")) void execute(() => api<{ credential: string }>(`api-connections/${connection.id}/rotate`, { method: "POST", body: "{}" })); }}>{english ? "Rotate credential" : "轮换凭证"}</button><button className="dangerButton" disabled={busy} type="button" onClick={() => { if (window.confirm(english ? "This service will immediately lose access. Existing projects and training runs will not be deleted." : "撤销后这个调用服务会立即失去访问权限，已有项目和训练不会被删除。")) void execute(() => api(`api-connections/${connection.id}/revoke`, { method: "POST", body: "{}" })); }}>{english ? "Revoke" : "撤销"}</button></div> : null}</footer>
    </article>) : <div className="emptyApiConnections"><strong>{english ? "No API connections yet" : "还没有 API 连接"}</strong><p>{english ? "Create one, then give its credential to a service you trust." : "创建后，你可以把凭证交给自己信任的调用服务。"}</p></div>}</div>
    <section className="apiActivity"><h2>{english ? "Recent activity" : "最近调用"}</h2>{activity.length ? <ol>{activity.map((item) => <li key={item.id}><span className={item.outcome}>{item.outcome === "succeeded" ? (english ? "Succeeded" : "成功") : (english ? "Failed" : "失败")}</span><strong>{connections.find((connection) => connection.id === item.connection_id)?.name ?? (english ? "Revoked connection" : "已撤销连接")}</strong><small>{item.action} · {new Date(item.occurred_at).toLocaleString(localeTag(locale))}</small></li>)}</ol> : <p>{english ? "Activity will appear here after a connected service is used." : "调用服务使用后，这里会出现操作记录。"}</p>}</section>
    <p className="settingsAccount">{english ? `These connections belong to ${account.email}. They cannot move to another account or access your sign-in password or raw training data.` : `这些连接属于 ${account.email}。它们不能切换到其他账户，也不能获得你的登录密码或原始训练数据。`}</p>
  </>;
}

type Perform = (action: () => Promise<unknown>, success: string, autoAdvance?: boolean) => Promise<boolean>;

function SectionIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="sectionIntro"><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></header>;
}

function ProjectStep({ project, quota, forceCreate, busy, perform, moveTo, onCreated, onStartCreate, onCancel }: { project: Project | null; quota: WorkspaceState["project_quota"]; forceCreate: boolean; busy: boolean; perform: Perform; moveTo: (step: Step) => void; onCreated: (projectId: string) => void; onStartCreate: () => void; onCancel: () => void }) {
  const { locale } = useLanguage(); const english = locale === "en";
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  if (project && !forceCreate) {
    const editing = editingProjectId === project.id;
    return <><div className="sectionIntroWithAction"><SectionIntro eyebrow={english ? "Project goal" : "项目目标"} title={project.name} description={english ? "These two decisions guide data preparation, training, and evaluation." : "这两个判断会贯穿数据准备、训练与效果比较。"} /><button className="sectionEditButton" type="button" onClick={() => setEditingProjectId(project.id)} aria-expanded={editing}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>{english ? "Edit" : "编辑"}</button></div>
      {editing ? <form className="formCard projectEditForm" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void (async () => {
          const saved = await perform(() => api(`projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ name: form.get("name"), goal: form.get("goal"), success_criteria: form.get("success") }) }), english ? "Project goal updated." : "项目目标已更新。", false);
          if (saved) setEditingProjectId(null);
        })();
      }}>
        <label><span>{english ? "Project name" : "项目名称"}</span><input name="name" required maxLength={120} defaultValue={project.name} /></label>
        <label><span>{english ? "What should the model do?" : "模型要完成什么"}</span><textarea name="goal" required maxLength={2000} rows={4} defaultValue={project.goal} /></label>
        <label><span>{english ? "What does success look like?" : "怎样算成功"}</span><textarea name="success" required maxLength={2000} rows={3} defaultValue={project.success_criteria} /></label>
        <div className="formActions"><button className="secondaryButton" type="button" onClick={() => setEditingProjectId(null)}>{english ? "Cancel" : "取消"}</button><button className="primaryButton" disabled={busy} type="submit">{busy ? (english ? "Saving…" : "正在保存…") : (english ? "Save changes" : "保存修改")}</button></div>
      </form> : <div className="summaryGrid"><article><span>{english ? "What the model should do" : "模型要完成什么"}</span><p>{project.goal}</p></article><article><span>{english ? "What success looks like" : "怎样算成功"}</span><p>{project.success_criteria}</p></article></div>}
      {editing ? null : <div className="formActions">{quota.remaining > 0 ? <button className="secondaryButton" type="button" onClick={onStartCreate}>{english ? "New project" : "新建项目"}</button> : null}<button className="primaryButton" type="button" onClick={() => moveTo("compute")}>{english ? "Continue to compute" : "继续连接算力"}</button></div>}</>;
  }
  if (quota.remaining <= 0) return <Prerequisite title={english ? "Project limit reached" : "项目名额已用完"} text={english ? `Your current plan allows ${quota.limit} active projects. Existing projects and results are unaffected.` : `当前方案最多同时保留 ${quota.limit} 个项目；已有项目和训练结果不会受影响。`} action={english ? "Upgrade plan" : "升级方案"} onClick={() => { window.location.href = "/api/billing/checkout"; }} />;
  return <><SectionIntro eyebrow={project ? (english ? "New project" : "新项目") : (english ? "Step one" : "第一步")} title={english ? "Define what the model should become." : "先说清模型要变成什么样。"} description={english ? quota.remaining === 1 ? "You can create one more project. Its data, training, and results stay separate." : `You can create ${quota.remaining} more projects. Each project keeps its data, training, and results separate.` : `还可以建立 ${quota.remaining} 个项目。每个项目的数据、训练和模型结果独立保存。`} />
    <form className="formCard" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void perform(async () => { const created = await api<{ id: string }>("projects", { method: "POST", body: JSON.stringify({ name: form.get("name"), goal: form.get("goal"), success_criteria: form.get("success") }) }); onCreated(created.id); }, english ? "Project created. You can connect compute now." : "项目已建立，可以连接算力了。");
    }}>
      <label><span>{english ? "Project name" : "项目名称"}</span><input name="name" required maxLength={120} placeholder={english ? "For example: Product support assistant" : "例如：产品客服助手"} /></label>
      <label><span>{english ? "What should the model do?" : "模型要完成什么"}</span><textarea name="goal" required maxLength={2000} rows={4} placeholder={english ? "For example: Answer pre-sales questions accurately and concisely from product materials." : "例如：根据产品资料准确回答售前问题，并保持简洁。"} /></label>
      <label><span>{english ? "What does success look like?" : "怎样算成功"}</span><textarea name="success" required maxLength={2000} rows={3} placeholder={english ? "For example: Over 90% format pass rate with no missing key facts." : "例如：固定测试问题的格式通过率超过 90%，关键答案不遗漏。"} /></label>
      <div className="formActions">{project ? <button className="secondaryButton" type="button" onClick={onCancel}>{english ? "Cancel" : "取消"}</button> : null}<button className="primaryButton" disabled={busy} type="submit">{busy ? (english ? "Creating…" : "正在建立…") : (english ? "Create project" : "建立项目")}</button></div>
    </form></>;
}

function ComputeStep({ runner, busy, perform }: { runner: Runner | null; busy: boolean; perform: Perform }) {
  const { locale } = useLanguage(); const english = locale === "en";
  const [pairing, setPairing] = useState<{ command: string; expires_at: string } | null>(null);
  const [copied, setCopied] = useState(false);
  if (runner && runner.status !== "offline") {
    const gpu = runner.capabilities.gpus?.[0];
    const isAppleSilicon = runner.capabilities.backend === "native_mps";
    const isCPU = runner.capabilities.backend === "docker_cpu";
    const deviceName = isCPU ? (english ? "Starter training on CPU" : "普通电脑入门训练") : gpu?.name ?? (isAppleSilicon ? "Apple Silicon GPU" : "NVIDIA GPU");
    const deviceDetail = isCPU
      ? `${runner.capabilities.cpu_cores ?? "—"} ${english ? "CPU cores" : "核处理器"} · ${runner.capabilities.memory_total_mb ? `${(runner.capabilities.memory_total_mb / 1024).toFixed(0)} GB ${english ? "memory" : "内存"}` : (english ? "Memory information syncing" : "内存信息同步中")}${typeof runner.capabilities.disk_free_mb === "number" ? ` · ${(runner.capabilities.disk_free_mb / 1024).toFixed(0)} GB ${english ? "free" : "可用空间"}` : ""}`
      : gpu ? `${isAppleSilicon ? "Metal / MPS" : `${runner.capabilities.gpus?.length ?? 1} GPU`} · ${(gpu.memory_total_mb / 1024).toFixed(0)} GB ${gpu.shared_memory ? (english ? "unified memory" : "统一内存") : (english ? "VRAM" : "显存")}` : (english ? "Capabilities syncing" : "能力信息正在同步");
    return <><SectionIntro eyebrow={english ? "Compute connected" : "算力已连接"} title={runner.name} description={english ? "This computer can now receive data-check, training, and evaluation tasks." : "这台机器已经可以接收数据检查、训练和评测任务。"} />
      <div className="computeCard ready"><div className="computeIcon">✓</div><div><span>{english ? "Available" : "当前可用"}</span><h2>{deviceName}</h2><p>{deviceDetail}</p></div><span className="statusBadge">{english ? "Online" : "在线"}</span></div>
      <div className="privacyCallout"><strong>{english ? "Your data boundary is unchanged" : "数据边界保持不变"}</strong><p>{english ? "The web app receives only statistics, progress, and previews you approve. Raw files and training results stay on this computer." : "网页只接收统计、进度和你主动授权的少量预览；原始文件和训练结果都留在这台机器。"}</p></div></>;
  }
  return <><SectionIntro eyebrow={english ? "Step two" : "第二步"} title={english ? "Connect a computer you control." : "连接一台你控制的电脑。"} description={english ? "An Ubuntu computer with 4 CPU cores, 8 GB RAM, and 20 GB free can complete the starter run. A compatible GPU is used automatically when available." : "4 核 8G、至少 20GB 可用空间的 Ubuntu 普通电脑就能完成入门训练；有 GPU 时系统也会自动使用。"} />
    {!pairing ? <div className="connectionStart"><div className="computeIllustration" aria-hidden="true"><span>{english ? "Computer" : "电脑"}</span><i /></div><h2>{english ? "Prepare an Ubuntu computer" : "准备一台 Ubuntu 电脑"}</h2><p>{english ? "Run one installation command. The system checks the machine and selects the appropriate training mode." : "只需运行一次安装命令。系统会检查机器并选择适合它的训练方式。"}</p><button className="primaryButton" disabled={busy} type="button" onClick={() => void perform(async () => setPairing(await api("runners/pairing", { method: "POST", body: "{}" })), english ? "Connection command created. Run it on the computer you will use for training." : "安装命令已生成，复制到要用于训练的电脑运行即可。")}>{busy ? (english ? "Generating…" : "正在生成…") : (english ? "Generate connection command" : "生成连接命令")}</button></div> :
      <div className="pairingCard"><div className="pairingHeader"><div><span>{english ? "Run once on the training computer" : "在训练电脑运行一次"}</span><strong>{english ? "Copy the command below" : "复制下面的命令"}</strong></div><small>{english ? "Start before" : "请在"} {new Date(pairing.expires_at).toLocaleTimeString(localeTag(locale), { hour: "2-digit", minute: "2-digit" })}{english ? "" : " 前开始运行"}</small></div>
        <div className="connectionCommand"><p>{english ? "The command installs the environment, registers this machine, and keeps it connected. It may take a few minutes." : "命令会自动安装环境、注册这台机器并保持连接，过程可能需要几分钟。"}</p><pre>{pairing.command}</pre><button className="primaryButton" type="button" onClick={async () => { await navigator.clipboard.writeText(pairing.command); setCopied(true); }}>{copied ? (english ? "Command copied" : "命令已复制") : (english ? "Copy install command" : "复制安装命令")}</button></div>
        <p className="waitingLine"><span className="pulseDot" />{english ? "Waiting for compute to connect. This page updates automatically." : "正在等待算力连接，连接成功后本页会自动更新。"}</p></div>}
  </>;
}

function DataStep({ project, runner, dataset, busy, perform, moveTo }: { project: Project | null; runner: Runner | null; dataset: Dataset | null; busy: boolean; perform: Perform; moveTo: (step: Step) => void }) {
  const { locale } = useLanguage(); const english = locale === "en";
  const [sourceType, setSourceType] = useState<Dataset["source_type"]>("local");
  if (!project || !runner || runner.status === "offline") return <Prerequisite title={english ? "Complete the first two steps" : "先完成前两步"} text={english ? "Create a project and connect online compute before checking data in your environment." : "建立项目并连接在线算力后，才能在用户环境中检查数据。"} action={english ? "Connect compute" : "去连接算力"} onClick={() => moveTo("compute")} />;
  const isCPU = runner.capabilities.backend === "docker_cpu";
  if (dataset?.status === "checking") return <><SectionIntro eyebrow={english ? "Preparing data" : "正在准备练习"} title={isCPU ? (english ? "Splitting the practice text into three sets." : "正在把练习文本分成三份。") : (english ? "Checks are running in your environment." : "检查在你的环境中进行。")} description={isCPU ? (english ? "One set for learning, one for selecting results, and one for the final test. You do not need to manage the files." : "一份用来学习，一份用来挑选效果，一份留到最后考试。你不需要处理文件。") : (english ? "Raw files are not uploaded. Quality issues, splits, and length risks appear here when complete." : "原始文件不会上传。完成后这里会显示质量问题、切分和长度风险。")} /><ProgressPanel label={isCPU ? (english ? "Downloading and checking practice text" : "正在下载并检查练习文本") : (english ? "Reading, deduplicating, and creating a data version" : "正在读取、去重并建立数据版本")} progress={35} /></>;
  if (dataset?.status === "ready" && dataset.statistics) return <><SectionIntro eyebrow={english ? "Data ready" : "数据已就绪"} title={dataset.name} description={english ? "An immutable data version is ready, with separate training and test splits." : "已形成不可变数据版本，训练和测试使用各自独立的切分。"} /><DatasetReport dataset={dataset} /><div className="formActions"><button className="primaryButton" type="button" onClick={() => moveTo("train")}>{english ? "Train with this data" : "用这份数据开始训练"}</button></div></>;
  if (isCPU) return <><SectionIntro eyebrow={english ? "Step three" : "第三步"} title={english ? "Complete your first run with an example." : "先用示例完成第一次训练。"} description={english ? "LLMWEB prepares Shakespeare text so a small model can learn next-character prediction. After this run, you will understand every training stage." : "LLMWEB 会准备一份莎士比亚文本，让小模型学习如何逐字续写。完成这一遍后，你会看懂训练的每个阶段。"} />
    {dataset?.status === "failed" ? <div className="inlineError">{english ? "Practice data was not prepared. Try again; the system will use the same fixed dataset." : "练习数据没有准备完成，请重新开始；系统会继续使用同一份固定数据。"}</div> : null}
    <section className="starterCard"><div className="starterBadge">{english ? "No upload required" : "无需上传文件"}</div><h2>{english ? "Shakespeare text completion practice" : "莎士比亚文本续写练习"}</h2><p>{english ? "About 1.1 million characters, automatically split into training, validation, and test sets. Preparation usually takes under a minute." : "约 110 万个字符，系统自动分成学习、验证和考试三份。预计准备时间不到 1 分钟。"}</p><ul><li>{english ? "Raw text goes directly to your training computer" : "原始文本直接进入你的训练电脑"}</li><li>{english ? "Final test text is never used for training" : "最后考试内容不会参与训练"}</li><li>{english ? "Before-and-after results use the same test text" : "训练前后使用同一份考试内容比较"}</li></ul><button className="primaryButton" disabled={busy} type="button" onClick={() => void perform(() => api("datasets", { method: "POST", body: JSON.stringify({ project_id: project.id, runner_id: runner.id, name: english ? "Shakespeare practice dataset" : "莎士比亚文本练习集", source_type: "starter", source_ref: "tiny-shakespeare", format: "txt", train_percent: 80, validation_percent: 10, test_percent: 10, preview_allowed: true }) }), english ? "Practice data preparation started. Results appear automatically." : "练习数据开始准备，完成后会自动显示结果。")}>{busy ? (english ? "Starting…" : "正在开始…") : (english ? "Prepare practice data" : "准备练习数据")}</button></section></>;
  return <><SectionIntro eyebrow={english ? "Step three" : "第三步"} title={english ? "Choose local data, check it, then train." : "选择本地数据，先检查再训练。"} description={english ? "Enter a path relative to the compute data directory. The platform does not store your full local path." : "填写算力数据目录内的相对路径；平台不会保存你的完整本地路径。"} />
    {dataset?.status === "failed" ? <div className="inlineError">{english ? "The previous data check failed. Verify the path, format, and fields, then submit again." : "上一次数据检查失败，请确认文件路径、格式和字段后重新提交。"}</div> : null}
    <form className="formCard" onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void perform(() => api("datasets", { method: "POST", body: JSON.stringify({ project_id: project.id, runner_id: runner.id, name: form.get("name"), source_type: sourceType, source_ref: form.get("path"), format: form.get("format") ?? "json", instruction_field: form.get("instruction"), input_field: form.get("input"), output_field: form.get("output"), train_percent: 80, validation_percent: 10, test_percent: 10, preview_allowed: form.get("preview") === "on" }) }), english ? "Data check started. Raw files remain in your environment." : "数据检查已开始，原始文件仍留在你的环境。 ");
    }}>
      <div className="formGrid"><label><span>{english ? "Data name" : "数据名称"}</span><input name="name" required placeholder={english ? "For example: Support Q&A v1" : "例如：客服问答 v1"} /></label><label><span>{english ? "Data source" : "数据来源"}</span><select name="source_type" value={sourceType} onChange={(event) => setSourceType(event.target.value as Dataset["source_type"])}><option value="local">{english ? "File on compute host" : "算力主机上的文件"}</option><option value="huggingface">Hugging Face {english ? "dataset" : "数据集"}</option><option value="modelscope">ModelScope {english ? "dataset" : "数据集"}</option><option value="s3">{english ? "My S3 storage" : "自己的 S3 存储"}</option></select></label></div>
      <div className="formGrid"><label><span>{sourceType === "local" ? (english ? "File path inside the data directory" : "数据目录内的文件路径") : sourceType === "s3" ? (english ? "S3 data URI" : "S3 数据地址") : (english ? "Dataset identifier" : "数据集标识")}</span><input name="path" required placeholder={sourceType === "local" ? (english ? "For example: support/train.jsonl" : "例如：support/train.jsonl") : sourceType === "s3" ? (english ? "For example: s3://my-bucket/train.jsonl" : "例如：s3://my-bucket/train.jsonl") : (english ? "For example: organization/dataset" : "例如：组织名/数据集名")} /><small>{sourceType === "local" ? (english ? "Do not include the data root configured when compute was connected." : "不需要填写连接算力时设置的数据根目录。") : (english ? "Your compute host downloads data directly; it does not pass through the platform." : "数据由你的算力主机直接下载，不经过平台。")}</small></label><label><span>{english ? "Source format" : "源数据格式"}</span><select name="format" defaultValue="jsonl"><option value="jsonl">JSONL</option><option value="json">JSON</option><option value="csv">CSV</option></select></label></div>
      <details className="advanced"><summary>{english ? "Field mapping" : "字段对应关系"}</summary><div className="formGrid three"><label><span>{english ? "Instruction field" : "指令字段"}</span><input name="instruction" defaultValue="instruction" required /></label><label><span>{english ? "Additional input field" : "补充输入字段"}</span><input name="input" defaultValue="input" required /></label><label><span>{english ? "Expected answer field" : "正确答案字段"}</span><input name="output" defaultValue="output" required /></label></div></details>
      <label className="checkRow"><input name="preview" type="checkbox" /><span><strong>{english ? "Allow 3 sample previews in the web app" : "允许网页显示 3 条样本预览"}</strong><small>{english ? "When off, the platform receives statistics only, never sample text." : "关闭时平台只接收统计结果，不接收任何样本文本。"}</small></span></label>
      <div className="splitPreview"><span>{english ? "Automatic split" : "自动切分"}</span><strong>{english ? "Train 80%" : "训练 80%"}</strong><strong>{english ? "Validation 10%" : "验证 10%"}</strong><strong>{english ? "Test 10%" : "测试 10%"}</strong></div>
      <div className="formActions"><button className="primaryButton" disabled={busy} type="submit">{busy ? (english ? "Submitting…" : "正在提交…") : (english ? "Check and create data version" : "检查并建立数据版本")}</button></div>
    </form></>;
}

function DatasetReport({ dataset }: { dataset: Dataset }) {
  const { locale } = useLanguage(); const english = locale === "en"; const numberLocale = localeTag(locale);
  const stats = dataset.statistics!;
  if (dataset.source_type === "starter") {
    return <><div className="metricGrid starterMetrics"><article><span>{english ? "Practice text" : "练习文本"}</span><strong>{(stats.characters ?? stats.valid_rows).toLocaleString(numberLocale)}</strong><small>{english ? "characters" : "个字符"}</small></article><article><span>{english ? "Vocabulary" : "模型会认识"}</span><strong>{stats.vocabulary_size ?? "—"}</strong><small>{english ? "characters" : "种字符"}</small></article><article><span>{english ? "For training" : "用于学习"}</span><strong>80%</strong><small>{stats.splits.train.toLocaleString(numberLocale)} {english ? "characters" : "个字符"}</small></article><article><span>{english ? "Held for testing" : "留到考试"}</span><strong>10%</strong><small>{stats.splits.test.toLocaleString(numberLocale)} {english ? "characters" : "个字符"}</small></article></div>
      <div className="resultNote beginnerResult"><strong>{english ? "Preparation complete" : "准备完成"}</strong><p>{english ? "Test text is held separately. The system records the untrained model’s score, trains it, then retests on the same text." : "考试文本已单独留出。接下来系统会先记录模型没学过时的成绩，再开始训练，最后用同一份考试文本复测。"}</p></div>
      {dataset.preview?.length ? <details className="previewDetails"><summary>{english ? "Preview what the model will learn" : "看看模型将学习的文字"}</summary>{dataset.preview.map((item, index) => <article key={index}><span>{english ? "Text excerpt" : "文本片段"}</span><p>{item.input}</p></article>)}</details> : null}</>;
  }
  return <><div className="metricGrid"><article><span>{english ? "Usable samples" : "可用样本"}</span><strong>{stats.valid_rows}</strong><small>{english ? `${stats.rows} raw` : `原始 ${stats.rows} 条`}</small></article><article><span>{english ? "Duplicates" : "重复项"}</span><strong>{stats.duplicates}</strong><small>{english ? "Excluded from data version" : "已从数据版本中排除"}</small></article><article><span>{english ? "Estimated maximum" : "最长估算"}</span><strong>{stats.token_length.max}</strong><small>tokens</small></article><article><span>{english ? "Test leakage" : "测试泄漏"}</span><strong>{stats.leakage.exact_matches}</strong><small>{english ? "exact duplicates" : "精确重复"}</small></article></div>
    <div className="reportCard"><div><span>{english ? "Training" : "训练集"}</span><strong>{stats.splits.train}</strong></div><div><span>{english ? "Validation" : "验证集"}</span><strong>{stats.splits.validation}</strong></div><div><span>{english ? "Test" : "测试集"}</span><strong>{stats.splits.test}</strong></div><p>{english ? "Version" : "版本"} {dataset.version_hash?.slice(0, 18)}…</p></div>
    {dataset.preview?.length ? <details className="previewDetails"><summary>{english ? "View approved sample previews" : "查看已授权的样本预览"}</summary>{dataset.preview.map((item, index) => <article key={index}><span>{english ? "Sample" : "样本"} {index + 1}</span><p>{item.instruction}</p><small>{item.output}</small></article>)}</details> : null}</>;
}

function TrainStep({ project, runner, dataset, busy, perform, moveTo }: { project: Project | null; runner: Runner | null; dataset: Dataset | null; busy: boolean; perform: Perform; moveTo: (step: Step) => void }) {
  const { locale } = useLanguage(); const english = locale === "en";
  const [profile, setProfile] = useState("balanced");
  const [outputDestination, setOutputDestination] = useState<"local" | "user_s3">("local");
  const [selectedModel, setSelectedModel] = useState<string>(modelOptions[1][0]);
  if (!project || !runner || !dataset || dataset.status !== "ready") return <Prerequisite title={english ? "Prepare training data first" : "先准备好训练数据"} text={english ? "The system can create an executable training plan after data checks finish." : "数据检查完成后，系统才能给出可执行的训练方案。"} action={english ? "Prepare data" : "去准备数据"} onClick={() => moveTo("data")} />;
  const isAppleSilicon = runner.capabilities.backend === "native_mps";
  const isCPU = runner.capabilities.backend === "docker_cpu";
  if (isCPU) {
    const diskFreeGB = typeof runner.capabilities.disk_free_mb === "number" ? runner.capabilities.disk_free_mb / 1024 : null;
    const hasEnoughDisk = diskFreeGB === null || diskFreeGB >= 20;
    const starterProfiles = english ? [["fast", "Quick", "About 2–4 min", "Complete one full run"], ["balanced", "Recommended", "About 4–8 min", "Balanced time and results"], ["thorough", "Train longer", "About 8–15 min", "Usually produces lower test loss"]] : [["fast", "快速体验", "约 2–4 分钟", "先完整跑通一次"], ["balanced", "推荐", "约 4–8 分钟", "时间与效果更均衡"], ["thorough", "多学一会", "约 8–15 分钟", "通常能得到更低的考试损失"]];
    const profileLabel = starterProfiles.find(([value]) => value === profile)?.[1] ?? (english ? "Recommended" : "推荐");
    return <><SectionIntro eyebrow={english ? "Step four" : "第四步"} title={english ? "Choose how long to wait, then start." : "选择愿意等待多久，然后开始。"} description={english ? "The model and settings are already matched to this computer. Choose a duration and the system completes the remaining steps in order." : "模型和训练设置已经按这台电脑匹配好。你只需要选择时长，剩下的步骤由系统依次完成。"} />
      {!hasEnoughDisk ? <div className="inlineError"><strong>{english ? "This computer has less than 20 GB free" : "这台电脑的可用空间不足 20GB"}</strong><br />{english ? "Free up or add space before training. Prepared practice data will not be lost." : "先扩充或腾出空间，再开始训练，已经准备好的练习数据不会丢失。"}</div> : null}
      <form className="formCard starterTraining" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const epochs = profile === "fast" ? 1 : profile === "thorough" ? 5 : 3; void perform(() => api("experiments", { method: "POST", body: JSON.stringify({ project_id: project.id, runner_id: runner.id, dataset_id: dataset.id, name: form.get("name"), model_id: "karpathy/nanoGPT", method: "starter", epochs, learning_rate: 0.001, max_length: 128, batch_size: 12, gradient_accumulation: 1, export_formats: ["model"], evaluation_preview_allowed: true, output_destination: "local", license_confirmed: form.get("license_confirmed") === "on" }) }), english ? "Training started. You can close the web app; the computer will continue." : "训练已开始。网页可以关闭，电脑会继续完成。") }}>
        <label><span>{english ? "Name this training run" : "给这次训练起个名字"}</span><input name="name" required defaultValue={`${project.name} · ${english ? "First run" : "第一次训练"}`} /></label>
        <fieldset className="choiceField"><legend>{english ? "I am willing to wait" : "我愿意等待"}</legend><div className="profileChoices starterProfiles">{starterProfiles.map(([value, name, time, description]) => <label key={value} className={profile === value ? "selected" : ""}><input type="radio" name="profile" value={value} checked={profile === value} onChange={() => setProfile(value)} /><strong>{name}</strong><small>{time}</small><em>{description}</em></label>)}</div></fieldset>
        <div className="runSummary starterSummary"><div><span>{english ? "The system will" : "系统将自动完成"}</span><strong>{english ? "Test → Learn text → Select best result → Retest → Save model" : "先考试 → 学习文本 → 选择最好结果 → 再考试 → 保存模型"}</strong></div><div><span>{english ? "Current choice" : "当前选择"}</span><strong>{profileLabel}</strong></div><div><span>{english ? "Saved on" : "保存位置"}</span><strong>{runner.name}</strong></div>{diskFreeGB !== null ? <div><span>{english ? "Free space" : "当前可用空间"}</span><strong>{diskFreeGB.toFixed(0)} GB</strong></div> : null}</div>
        <label className="consentRow"><input type="checkbox" name="license_confirmed" required /><span>{english ? "I agree to use the included public practice material for this starter run" : "我同意使用内置公开练习材料完成这次入门训练"}</span></label>
        <div className="formActions"><button className="primaryButton" disabled={busy || !hasEnoughDisk} type="submit">{busy ? (english ? "Starting…" : "正在启动…") : (english ? "Start first training run" : "开始第一次训练")}</button></div>
      </form></>;
  }
  const estimate = trainingEstimate(selectedModel, profile, dataset.statistics?.valid_rows ?? 0, locale);
  return <><SectionIntro eyebrow={english ? "Step four" : "第四步"} title={english ? "Choose a model and training intensity." : "选择模型和训练强度。"} description={english ? "The system measures the base model first, then trains and retests on the same test set." : "系统会先测基础模型，再训练并用同一测试集复测。"} />
    <form className="formCard" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const profiles: Record<string, { epochs: number; max_length: number; gradient_accumulation: number }> = { fast: { epochs: 1, max_length: 1024, gradient_accumulation: 4 }, balanced: { epochs: 3, max_length: 2048, gradient_accumulation: 8 }, thorough: { epochs: 5, max_length: 2048, gradient_accumulation: 8 } }; const selected = profiles[profile]; const formats = ["adapter", ...(form.get("huggingface") ? ["huggingface"] : []), ...(form.get("gguf") ? ["gguf"] : [])]; void perform(() => api("experiments", { method: "POST", body: JSON.stringify({ project_id: project.id, runner_id: runner.id, dataset_id: dataset.id, name: form.get("name"), model_id: form.get("model"), method: form.get("method"), ...selected, learning_rate: 0.0002, batch_size: 1, export_formats: formats, evaluation_preview_allowed: form.get("evaluation_preview") === "on", output_destination: outputDestination, output_s3_uri: form.get("s3_uri") || null, output_s3_endpoint: form.get("s3_endpoint") || null, license_confirmed: form.get("license_confirmed") === "on" }) }), english ? "Training workflow started. The base-model baseline runs first." : "训练流程已启动，会先建立基础模型基线。 "); }}>
      <label><span>{english ? "Training name" : "训练名称"}</span><input name="name" required defaultValue={`${project.name} · ${english ? "First run" : "第一次训练"}`} /></label>
      <fieldset className="choiceField"><legend>{english ? "Base model" : "基础模型"}</legend><div className="modelChoices">{modelOptions.map(([id, name, description], index) => <label key={id}><input type="radio" name="model" value={id} checked={selectedModel === id} onChange={() => setSelectedModel(id)} /><span><strong>{name}</strong><small>{english ? ["Best for quickly validating the workflow", "Balanced quality and memory use", "Needs more memory and can produce stronger results"][index] : description}</small></span></label>)}</div></fieldset>
      <fieldset className="choiceField"><legend>{english ? "Training intensity" : "训练强度"}</legend><div className="profileChoices">{(english ? [["fast", "Quick trial", "1 epoch · validate quickly"], ["balanced", "Balanced", "3 epochs · good first result"], ["thorough", "Thorough", "5 epochs · takes longer"]] : [["fast", "快速试跑", "1 轮 · 尽快验证"], ["balanced", "均衡推荐", "3 轮 · 适合首个结果"], ["thorough", "充分训练", "5 轮 · 花费更多时间"]]).map(([value, name, description]) => <label key={value} className={profile === value ? "selected" : ""}><input type="radio" name="profile" value={value} checked={profile === value} onChange={() => setProfile(value)} /><strong>{name}</strong><small>{description}</small></label>)}</div></fieldset>
      <details className="advanced"><summary>{english ? "Memory, evaluation, and export settings" : "显存、评测与导出设置"}</summary><div className="formGrid"><label><span>{isAppleSilicon ? (english ? "Unified memory plan" : "统一内存方案") : (english ? "VRAM plan" : "显存方案")}</span><select name="method" defaultValue={isAppleSilicon ? "lora" : "qlora"}>{isAppleSilicon ? null : <option value="qlora">{english ? "Save VRAM (recommended)" : "节省显存（推荐）"}</option>}<option value="lora">{isAppleSilicon ? (english ? "Metal / MPS LoRA (recommended)" : "Metal / MPS LoRA（推荐）") : (english ? "Higher precision" : "更高精度")}</option></select>{isAppleSilicon ? <small>{english ? "Apple Silicon uses native Metal/MPS; CUDA-only 4-bit QLoRA is not shown." : "Apple Silicon 使用原生 Metal/MPS；CUDA 专用的 4 位 QLoRA 不会显示。"}</small> : null}</label><div className="checkStack"><label><input type="checkbox" name="evaluation_preview" /><span>{english ? "Show 3 blind-review pairs in the web app" : "允许网页显示 3 组盲测结果"}</span></label><label><input type="checkbox" name="huggingface" /><span>{english ? "Also generate a full Hugging Face model" : "同时生成完整 Hugging Face 模型"}</span></label><label><input type="checkbox" name="gguf" /><span>{english ? "Also generate a GGUF file" : "同时生成 GGUF 文件"}</span></label></div><label><span>{english ? "Artifact destination" : "产物保存位置"}</span><select name="output_destination" value={outputDestination} onChange={(event) => setOutputDestination(event.target.value as "local" | "user_s3")}><option value="local">{english ? "Compute host output directory" : "算力主机结果目录"}</option><option value="user_s3">{english ? "My S3 storage" : "自己的 S3 存储"}</option></select></label>{outputDestination === "user_s3" ? <div><label><span>{english ? "S3 destination URI" : "S3 目标地址"}</span><input name="s3_uri" required placeholder="s3://my-bucket/models/run-1" /></label><label><span>{english ? "S3-compatible endpoint (optional)" : "S3 兼容服务地址（可选）"}</span><input name="s3_endpoint" placeholder="https://s3.example.com" /></label><small className="fieldHelp">{english ? "Credentials are read only from the compute-host environment and are never sent to the platform." : "访问凭证只从算力主机环境读取，不会发送到平台。"}</small></div> : null}</div></details>
      <div className="runSummary"><div><span>{english ? "Workflow" : "流程"}</span><strong>{english ? "Baseline → Train → Select version → Retest → Export" : "基线 → 训练 → 选版本 → 复测 → 导出"}</strong></div><div><span>{english ? "Estimated VRAM" : "预计显存"}</span><strong>{estimate.memory}</strong></div><div><span>{english ? "Estimated training time" : "预计训练时间"}</span><strong>{estimate.time}</strong></div><div><span>{english ? "Estimated result storage" : "预计结果空间"}</span><strong>{estimate.disk}</strong></div></div>
      <label className="consentRow"><input type="checkbox" name="license_confirmed" required /><span>{english ? "I confirm that I have the right to train with the selected model and this data" : "我确认有权使用所选模型和这份数据进行训练"}</span></label>
      <div className="formActions"><button className="primaryButton" disabled={busy} type="submit">{busy ? (english ? "Starting…" : "正在启动…") : (english ? "Start training" : "开始训练")}</button></div>
    </form></>;
}

function MonitorStep({ experiment, jobs, runner, busy, perform, moveTo }: { experiment: Experiment | null; jobs: Job[]; runner: Runner | null; busy: boolean; perform: Perform; moveTo: (step: Step) => void }) {
  const { locale } = useLanguage(); const english = locale === "en";
  if (!experiment) return <Prerequisite title={english ? "No training run yet" : "还没有训练实验"} text={english ? "After you choose a model and intensity, real progress and results appear here." : "选择模型与训练强度后，这里会持续显示真实进度与效果。"} action={english ? "Configure training" : "设置训练"} onClick={() => moveTo("train")} />;
  const experimentJobs = jobs.filter((job) => job.experiment_id === experiment.id).reverse();
  const activeJob = experimentJobs.find((job) => ["leased", "running", "paused"].includes(job.status));
  const logs = experimentJobs.flatMap((job) => job.events.filter((event) => event.message && ["log", "failed", "progress"].includes(event.type)).map((event) => ({ ...event, job: job.kind }))).slice(-30).reverse();
  const percent = Math.round(experimentJobs.reduce((sum, job) => sum + (job.status === "completed" ? 100 : job.progress), 0) / Math.max(experimentJobs.length, 1));
  const isStarter = experiment.training.method === "starter";
  const stageTitle = isStarter ? starterStageLabel(experiment.current_stage, locale) : stageLabel(experiment.current_stage, locale);
  return <><SectionIntro eyebrow={experiment.status === "completed" ? (english ? "Training complete" : "训练已完成") : (english ? "Training in progress" : "训练进行中")} title={stageTitle} description={experiment.status === "completed" ? (english ? "The before-and-after models have been compared on the same test text." : "训练前后的模型已经用同一份考试文本完成比较。") : (english ? `You can close the web app. ${runner?.name ?? "Your computer"} continues the task and progress catches up when you return.` : `网页可以关闭；任务由 ${runner?.name ?? "你的电脑"} 继续执行，回来后进度会自动追平。`)} />
    {experiment.status === "failed" ? <div className="failurePanel"><strong>{english ? "This training run did not complete" : "本次训练没有完成"}</strong><p>{experimentJobs.find((job) => job.status === "failed")?.error ?? (english ? "Expand the run log for details." : "请展开运行记录查看具体原因。")}</p></div> : null}
    <ProgressPanel label={`${percent}% · ${stageTitle}`} progress={percent} />
    {runner && experiment.status !== "completed" ? <MachineLive runner={runner} /> : null}
    <div className="stageGrid">{experimentJobs.map((job) => <article key={job.id} className={job.status}><span>{job.status === "completed" ? "✓" : job.status === "running" || job.status === "leased" ? "●" : job.status === "failed" ? "!" : "○"}</span><div><strong>{isStarter ? starterJobLabel(job.kind, locale) : jobLabel(job.kind, locale)}</strong><small>{jobStatus(job.status, locale)}</small></div></article>)}</div>
    {experiment.status === "awaiting_selection" && experiment.checkpoints?.length ? <CheckpointPicker experiment={experiment} busy={busy} perform={perform} /> : null}
    {activeJob?.kind === "train" ? <div className="controlRow"><button className="secondaryButton" disabled={busy} type="button" onClick={() => void perform(() => api(`jobs/${activeJob.id}/control`, { method: "POST", body: JSON.stringify({ action: activeJob.status === "paused" ? "resume" : "pause" }) }), activeJob.status === "paused" ? (english ? "Training will resume from the pause point." : "训练将从暂停处继续。") : (english ? "Training will preserve progress and pause." : "训练会保留当前进度并暂停。"))}>{activeJob.status === "paused" ? (english ? "Resume training" : "继续训练") : (english ? "Pause training" : "暂停训练")}</button><button className="dangerButton" disabled={busy} type="button" onClick={() => { if (window.confirm(english ? "Cancel this training run? Existing local artifacts will not be deleted automatically." : "确定取消这次训练吗？已经生成的本地产物不会被自动删除。")) void perform(() => api(`jobs/${activeJob.id}/control`, { method: "POST", body: JSON.stringify({ action: "cancel" }) }), english ? "Cancellation sent." : "取消指令已发送。 "); }}>{english ? "Cancel training" : "取消训练"}</button></div> : null}
    {(experiment.baseline_metrics || experiment.tuned_metrics) ? <><Comparison baseline={experiment.baseline_metrics} tuned={experiment.tuned_metrics} /><Performance metrics={experiment.tuned_metrics ?? experiment.baseline_metrics} /></> : null}
    {experiment.evaluation_samples?.baseline?.length && experiment.evaluation_samples?.tuned?.length ? <BlindReview baseline={experiment.evaluation_samples.baseline} tuned={experiment.evaluation_samples.tuned} /> : null}
    <details className="logPanel"><summary>{english ? "View run log" : "查看运行记录"}</summary><div>{logs.length ? logs.map((event) => <p key={event.id}><span>{jobLabel(event.job as Job["kind"], locale)}</span>{event.message}</p>) : <p>{english ? "Waiting for the first log entry…" : "正在等待第一条运行记录…"}</p>}</div></details>
    {experiment.status === "completed" ? <div className="formActions"><button className="primaryButton" type="button" onClick={() => moveTo("model")}>{english ? "Confirm results and get model" : "确认效果，取得模型"}</button></div> : null}</>;
}

function Comparison({ baseline, tuned }: { baseline: Metrics | null; tuned: Metrics | null }) {
  const { locale } = useLanguage(); const english = locale === "en";
  if (baseline?.test_loss !== undefined) {
    const before = baseline.test_loss;
    const after = tuned?.test_loss;
    const improvement = after === undefined ? null : ((before - after) / before) * 100;
    return <section className="comparison starterComparison"><div className="cardHeading"><div><span>{english ? "Same test text" : "同一份考试文本"}</span><h2>{after === undefined ? (english ? "Pre-training score recorded" : "训练前成绩已记录") : (english ? "Did training improve the model?" : "训练确实带来了进步吗？")}</h2></div>{after === undefined ? <small>{english ? "Waiting for post-training retest" : "等待训练后复测"}</small> : <strong className={improvement !== null && improvement > 0 ? "evidenceBadge" : "evidenceBadge warning"}>{improvement !== null && improvement > 0 ? (english ? "Improved" : "有进步") : (english ? "No improvement" : "没有变好")}</strong>}</div><div className="lossComparison"><article><span>{english ? "Error before training" : "训练前错误程度"}</span><strong>{before.toFixed(3)}</strong><small>{english ? "Lower is better" : "越低越好"}</small></article><span aria-hidden="true">→</span><article className="tuned"><span>{english ? "Error after training" : "训练后错误程度"}</span><strong>{after === undefined ? (english ? "Waiting" : "等待中") : after.toFixed(3)}</strong><small>{improvement === null ? (english ? "Shown when complete" : "完成后显示") : `${Math.abs(improvement).toFixed(1)}% ${improvement >= 0 ? (english ? "lower" : "降低") : (english ? "higher" : "升高")}`}</small></article></div></section>;
  }
  const metrics = english ? [["Exact answer match", "exact_match"], ["Format pass rate", "format_pass_rate"]] as const : [["答案完全一致", "exact_match"], ["格式通过", "format_pass_rate"]] as const;
  return <section className="comparison"><div className="cardHeading"><div><span>{english ? "Same test-set comparison" : "同一测试集对比"}</span><h2>{tuned ? (english ? "Before and after training" : "训练前后效果") : (english ? "Base-model baseline" : "基础模型基线")}</h2></div>{tuned ? <strong className="evidenceBadge">{english ? "Retest complete" : "已完成复测"}</strong> : <small>{english ? "Waiting for post-training retest" : "等待训练后复测"}</small>}</div>{metrics.map(([label, key]) => { const before = baseline?.[key] ?? 0; const after = tuned?.[key]; const change = after === undefined ? null : after - before; return <div className="metricCompare" key={key}><div><span>{label}</span>{change === null ? null : <strong className={change >= 0 ? "positive" : "negative"}>{change >= 0 ? "+" : ""}{(change * 100).toFixed(1)}%</strong>}</div><div className="barRow"><small>{english ? "Before" : "训练前"}</small><i><b style={{ width: `${before * 100}%` }} /></i><em>{(before * 100).toFixed(1)}%</em></div>{after === undefined ? null : <div className="barRow tuned"><small>{english ? "After" : "训练后"}</small><i><b style={{ width: `${after * 100}%` }} /></i><em>{(after * 100).toFixed(1)}%</em></div>}</div>; })}</section>;
}

function Performance({ metrics }: { metrics: Metrics | null }) {
  const { locale } = useLanguage(); const english = locale === "en";
  if (!metrics) return null;
  const values = [
    [english ? "Time to first token" : "首字响应", metrics.first_token_latency_ms === undefined ? "—" : `${metrics.first_token_latency_ms.toFixed(0)} ms`],
    [english ? "Generation speed" : "生成速度", metrics.tokens_per_second === undefined ? "—" : `${metrics.tokens_per_second.toFixed(1)} token/s`],
    [english ? "Peak VRAM" : "峰值显存", metrics.peak_gpu_memory_mb === undefined ? "—" : `${(metrics.peak_gpu_memory_mb / 1024).toFixed(1)} GB`],
    [english ? "Model size" : "模型体积", metrics.model_size_mb === undefined ? "—" : metrics.model_size_mb < 1024 ? `${metrics.model_size_mb.toFixed(1)} MB` : `${(metrics.model_size_mb / 1024).toFixed(1)} GB`],
    [english ? "Test text" : "考试文本", metrics.test_characters === undefined ? "—" : `${metrics.test_characters.toLocaleString(localeTag(locale))} ${english ? "characters" : "字符"}`],
  ].filter(([, value]) => value !== "—");
  return <section className="performance"><div className="cardHeading"><div><span>{english ? "Local performance" : "本机运行表现"}</span><h2>{english ? "Speed and resource cost" : "速度与资源代价"}</h2></div></div><div>{values.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div></section>;
}

function MachineLive({ runner }: { runner: Runner }) {
  const { locale } = useLanguage(); const english = locale === "en";
  if (runner.capabilities.backend === "docker_cpu") return <div className="gpuLive"><div><span>{english ? "Using" : "正在使用"}</span><strong>{english ? "Computer CPU" : "普通电脑处理器"}</strong></div><div><span>{english ? "Processor" : "处理器"}</span><strong>{runner.capabilities.cpu_cores ?? "—"} {english ? "cores" : "核"}</strong></div><div><span>{english ? "Memory" : "内存"}</span><strong>{runner.capabilities.memory_total_mb ? `${(runner.capabilities.memory_total_mb / 1024).toFixed(0)} GB` : "—"}</strong></div></div>;
  const gpus = runner.capabilities.gpus ?? [];
  if (!gpus.length) return null;
  const sharedMemory = gpus.some((gpu) => gpu.shared_memory);
  const used = gpus.reduce((sum, gpu) => sum + gpu.memory_total_mb - gpu.memory_free_mb, 0);
  const total = gpus.reduce((sum, gpu) => sum + gpu.memory_total_mb, 0);
  const utilization = gpus.reduce((sum, gpu) => sum + (gpu.utilization_percent ?? 0), 0) / Math.max(gpus.length, 1);
  const hottest = Math.max(...gpus.map((gpu) => gpu.temperature_c ?? 0));
  if (sharedMemory) return <div className="gpuLive"><div><span>{english ? "Acceleration backend" : "加速后端"}</span><strong>Metal / MPS</strong></div><div><span>{english ? "Unified memory" : "统一内存"}</span><strong>{(total / 1024).toFixed(0)} GB</strong></div><div><span>{english ? "Device" : "运行设备"}</span><strong>Apple Silicon GPU</strong></div></div>;
  return <div className="gpuLive"><div><span>{english ? "GPU utilization" : "GPU 使用率"}</span><strong>{utilization.toFixed(0)}%</strong></div><div><span>{english ? "VRAM" : "显存"}</span><strong>{(used / 1024).toFixed(1)} / {(total / 1024).toFixed(1)} GB</strong></div><div><span>{english ? "Temperature" : "温度"}</span><strong>{hottest || "—"}{hottest ? "°C" : ""}</strong></div></div>;
}

function CheckpointPicker({ experiment, busy, perform }: { experiment: Experiment; busy: boolean; perform: Perform }) {
  const { locale } = useLanguage(); const english = locale === "en";
  const [selected, setSelected] = useState(experiment.checkpoints?.find((item) => item.recommended)?.reference ?? experiment.checkpoints?.[0]?.reference ?? "adapter");
  if (experiment.training.method === "starter" && experiment.checkpoints?.length === 1) return <section className="checkpointPicker beginnerCheckpoint"><div className="cardHeading"><div><span>{english ? "Learning complete" : "学习阶段已完成"}</span><h2>{english ? "The best-performing version is ready" : "效果最好的一版已经找到了"}</h2></div><strong className="evidenceBadge">{english ? "Recommended" : "推荐"}</strong></div><p>{english ? "Next, it is tested on text never used for training, then saved as a model file you can keep." : "下一步会用从未参与训练的考试文本检验它，然后生成可以保留的模型文件。"}</p><div className="formActions"><button className="primaryButton" disabled={busy} type="button" onClick={() => void perform(() => api(`experiments/${experiment.id}/select-checkpoint`, { method: "POST", body: JSON.stringify({ checkpoint_ref: selected }) }), english ? "Running the final test and saving the model." : "正在进行最后考试并保存模型。")}>{busy ? (english ? "Continuing…" : "正在继续…") : (english ? "Continue with recommended result" : "使用推荐结果继续")}</button></div></section>;
  return <section className="checkpointPicker"><div className="cardHeading"><div><span>{english ? "Training versions" : "训练版本"}</span><h2>{english ? "Choose a version to evaluate" : "选择一个版本继续评测"}</h2></div><small>{english ? "Recommendation is based on lowest validation loss" : "推荐项来自最低验证损失"}</small></div><div>{experiment.checkpoints?.map((checkpoint) => <label className={selected === checkpoint.reference ? "selected" : ""} key={checkpoint.reference}><input type="radio" name="checkpoint" value={checkpoint.reference} checked={selected === checkpoint.reference} onChange={() => setSelected(checkpoint.reference)} /><span><strong>{checkpoint.label}{checkpoint.recommended ? (english ? " · Recommended" : " · 推荐") : ""}</strong><small>{checkpoint.validation_loss === undefined ? (english ? "Completed version" : "训练完成版本") : `${english ? "Validation loss" : "验证损失"} ${checkpoint.validation_loss.toFixed(4)}`}</small></span></label>)}</div><div className="formActions"><button className="primaryButton" disabled={busy} type="button" onClick={() => void perform(() => api(`experiments/${experiment.id}/select-checkpoint`, { method: "POST", body: JSON.stringify({ checkpoint_ref: selected }) }), english ? "Model version selected. Retesting on the fixed test set." : "已选定模型版本，正在用固定测试集复测。")}>{busy ? (english ? "Continuing…" : "正在继续…") : (english ? "Select and continue evaluation" : "选定并继续评测")}</button></div></section>;
}

function BlindReview({ baseline, tuned }: { baseline: EvaluationSample[]; tuned: EvaluationSample[] }) {
  const { locale } = useLanguage(); const english = locale === "en";
  return <details className="blindReview"><summary>{english ? "View blind-review samples" : "查看盲测样本"}</summary><p>{english ? "Candidates are shown in a fixed shuffled order so you judge the answers before knowing their source." : "候选顺序固定打散，先看回答再判断哪一个更好。"}</p>{baseline.slice(0, 3).map((before, index) => { const after = tuned[index]; if (!after) return null; const swap = index % 2 === 1; const candidates = swap ? [after.prediction, before.prediction] : [before.prediction, after.prediction]; return <article key={`${before.instruction}-${index}`}><header><span>{english ? "Question" : "问题"} {index + 1}</span><strong>{before.instruction}</strong></header><div><section><span>{english ? "Candidate A" : "候选 A"}</span><p>{candidates[0]}</p></section><section><span>{english ? "Candidate B" : "候选 B"}</span><p>{candidates[1]}</p></section></div></article>; })}</details>;
}

function ModelStep({ experiment, moveTo }: { experiment: Experiment | null; moveTo: (step: Step) => void }) {
  const { locale } = useLanguage(); const english = locale === "en";
  if (!experiment || experiment.status !== "completed" || !experiment.artifacts?.length) return <Prerequisite title={english ? "Model not ready yet" : "模型还没有准备好"} text={english ? "Artifacts appear here after training, same-set retesting, and export are complete." : "训练、同集复测和导出全部完成后，产物会出现在这里。"} action={english ? "View training progress" : "查看训练进度"} onClick={() => moveTo("monitor")} />;
  return <><SectionIntro eyebrow={english ? "Final step" : "最后一步"} title={english ? "The model is on your training computer." : "模型已经留在你的训练电脑。"} description={english ? "Results are saved. Expand the location only when you need to use or move a file." : "训练结果已保存好，需要使用或移动文件时再展开查看位置。"} />
    <div className="artifactList">{experiment.artifacts.map((artifact) => <article key={artifact.format}><span className="artifactIcon">{artifact.format === "gguf" ? "G" : artifact.format === "huggingface" ? "HF" : artifact.format === "model" ? "M" : "A"}</span><div><strong>{artifactLabel(artifact.format, locale)}</strong><small>{english ? "Saved on training computer" : "保存在训练电脑"}</small><details className="artifactLocation"><summary>{english ? "View file location" : "查看文件位置"}</summary><code>{artifact.reference}</code></details></div><span className="readyLabel">{english ? "Generated" : "已生成"}</span></article>)}</div>
    <Comparison baseline={experiment.baseline_metrics} tuned={experiment.tuned_metrics} />
    <Performance metrics={experiment.tuned_metrics} />
    {experiment.evaluation_samples?.baseline?.length && experiment.evaluation_samples?.tuned?.length ? <BlindReview baseline={experiment.evaluation_samples.baseline} tuned={experiment.evaluation_samples.tuned} /> : null}
    <div className="resultNote"><strong>{english ? "Keep this model as the result of this run" : "这份模型可以放心留作本次练习结果"}</strong><p>{english ? "It has been compared before and after training on the same test text; its data, settings, and scores are retained with this run." : "它已通过同一份考试文本的训练前后对比；数据、设置和成绩也都随本次训练保留。"}</p></div></>;
}

function ProgressPanel({ label, progress }: { label: string; progress: number }) { return <div className="progressPanel"><div><strong>{label}</strong><span>{progress}%</span></div><i><b style={{ width: `${Math.max(3, progress)}%` }} /></i></div>; }
function Prerequisite({ title, text, action, onClick }: { title: string; text: string; action: string; onClick: () => void }) { return <div className="emptyState"><span>→</span><h1>{title}</h1><p>{text}</p><button className="primaryButton" type="button" onClick={onClick}>{action}</button></div>; }
function runnerStatus(runner: Runner | null, locale: Locale) { const en = locale === "en"; if (!runner) return en ? "Waiting to connect" : "等待连接"; if (runner.status === "busy") return en ? "Running a task" : "正在执行任务"; if (runner.status === "online") return en ? "Online" : "在线可用"; return en ? "Offline" : "当前离线"; }
function jobStatus(status: Job["status"], locale: Locale) { return locale === "en" ? ({ blocked: "Waiting for version selection", queued: "Waiting for compute", leased: "Starting", running: "In progress", paused: "Paused", completed: "Completed", failed: "Failed", cancelled: "Cancelled" } as const)[status] : ({ blocked: "等待选择版本", queued: "等待算力开始", leased: "正在开始", running: "进行中", paused: "已暂停", completed: "已完成", failed: "未完成", cancelled: "已取消" } as const)[status]; }
function artifactLabel(format: string, locale: Locale) { return (locale === "en" ? ({ adapter: "LoRA adapter", huggingface: "Full Hugging Face model", gguf: "GGUF model", model: "Reusable trained model" } as Record<string, string>) : ({ adapter: "LoRA Adapter", huggingface: "Hugging Face 完整模型", gguf: "GGUF 模型", model: "可继续使用的训练模型" } as Record<string, string>))[format] ?? format; }
function jobLabel(kind: Job["kind"], locale: Locale) { return locale === "en" ? ({ inspect: "Check data", baseline: "Pre-training evaluation", train: "Fine-tune model", evaluate: "Post-training evaluation", export: "Generate model" } as const)[kind] : jobLabels[kind]; }
function stageLabel(stage: string, locale: Locale) { return (locale === "en" ? ({ baseline: "Establish pre-training baseline", train: "Fine-tune model", evaluate: "Retest fine-tuned model", export: "Generate model artifacts", select: "Select model version", completed: "All complete" } as Record<string, string>) : stageLabels)[stage] ?? (locale === "en" ? "Preparing" : "正在准备"); }
function starterJobLabel(kind: Job["kind"], locale: Locale) { return locale === "en" ? ({ inspect: "Prepare practice text", baseline: "Record pre-training score", train: "Learn from text", evaluate: "Run post-training test", export: "Save trained model" } as const)[kind] : ({ inspect: "准备练习文本", baseline: "记录训练前成绩", train: "让模型学习文本", evaluate: "进行训练后考试", export: "保存训练模型" } as const)[kind]; }
function starterStageLabel(stage: string, locale: Locale) { return (locale === "en" ? ({ baseline: "Record the pre-training score", train: "The model is learning from text", evaluate: "Running the post-training test", export: "Saving the trained model", select: "Select the best result", completed: "First training run complete" } as Record<string, string>) : ({ baseline: "先记录训练前成绩", train: "模型正在学习文本", evaluate: "正在进行训练后考试", export: "正在保存训练模型", select: "选择效果最好的结果", completed: "第一次训练全部完成" } as Record<string, string>))[stage] ?? (locale === "en" ? "Preparing" : "正在准备"); }
function trainingEstimate(model: string, profile: string, rows: number, locale: Locale) { const billions = model.includes("0.5B") ? 0.5 : model.includes("1.5B") ? 1.5 : 3; const epochs = profile === "fast" ? 1 : profile === "thorough" ? 5 : 3; const minutes = Math.max(4, Math.ceil(rows * epochs * billions / 90)); const en = locale === "en"; return { memory: `${Math.ceil(4 + billions * 1.7)}–${Math.ceil(6 + billions * 2.2)} GB`, time: minutes < 60 ? `${minutes}–${Math.ceil(minutes * 1.8)} ${en ? "minutes" : "分钟"}` : `${(minutes / 60).toFixed(1)}–${(minutes * 1.8 / 60).toFixed(1)} ${en ? "hours" : "小时"}`, disk: `${Math.ceil(billions * 2.2 + 1)}–${Math.ceil(billions * 4.5 + 2)} GB` }; }
