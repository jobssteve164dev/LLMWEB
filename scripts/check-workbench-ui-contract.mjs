import { readFile } from "node:fs/promises";

const workbench = await readFile(new URL("../apps/web/app/components/workbench.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../apps/web/app/globals.css", import.meta.url), "utf8");
const controlPlane = await readFile(new URL("../services/control-plane/src/llmweb_control/main.py", import.meta.url), "utf8");
const datasetInspector = await readFile(new URL("../runner/internal/executor/inspect.go", import.meta.url), "utf8");
const projectDeleteFlow = workbench.match(/const deleteProject[\s\S]*?const disconnectRunner/)?.[0] ?? "";

const contracts = [
  [workbench.includes('state.account.plan === "free" ? <Link href="/#pricing">'), "Free account plan entry is missing"],
  [workbench.includes('state.account.plan === "paid" ? "Pro" : "Free"'), "Free/Pro account tag is missing"],
  [workbench.includes('api(`projects/${project.id}`, { method: "PATCH"'), "project goal edit request is missing"],
  [workbench.includes('goal: form.get("goal"), success_criteria: form.get("success")'), "project goal edit does not save every field"],
  [workbench.includes('english ? "Project goal updated." : "项目目标已更新。", false'), "project goal edit unexpectedly advances the workflow"],
  [workbench.includes('className="workAreaScroll"'), "independent work area scroller is missing"],
  [/\.appShell\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s.test(styles), "desktop shell is not viewport-bound"],
  [/\.workspaceLayout\s*\{[^}]*height:\s*calc\(100dvh - 72px\);/s.test(styles), "desktop workspace is not viewport-bound"],
  [/\.workAreaScroll\s*\{[^}]*overflow-y:\s*auto;/s.test(styles), "right content area does not own vertical scrolling"],
  [styles.includes("*::-webkit-scrollbar-thumb"), "custom WebKit scrollbar is missing"],
  [styles.includes("scrollbar-color:"), "custom Firefox scrollbar is missing"],
  [workbench.includes('role="alertdialog" aria-modal="true"'), "designed confirmation dialog is missing"],
  [projectDeleteFlow.length > 0 && !projectDeleteFlow.includes("window.confirm"), "project deletion fell back to a browser confirmation"],
  [workbench.includes('api(`runners/${target.id}/revoke`') && workbench.includes('runners.map((runner)'), "multi-computer selection or disconnect flow is missing"],
  [workbench.includes('Edit and create new version') && workbench.includes('编辑并建立新版本'), "dataset version editing entry is missing"],
  [workbench.includes("function TrainingDatasetSetup") && workbench.includes('<TrainingDatasetSetup datasets={datasets} dataset={dataset}'), "training page does not expose dataset version controls"],
  [!workbench.includes("datasets.length > 1 ? <div className=\"datasetVersions\""), "single dataset versions are still hidden"],
  [!workbench.includes('dataset.source_type !== "starter" && !isCPU'), "starter or CPU dataset editing is still hidden"],
  [workbench.includes('<option value="archive">ZIP / TAR.GZ</option>'), "dataset archive import is missing"],
  [workbench.includes('自己的数据应该怎样准备'), "trainable dataset preparation guidance is missing"],
  [/\.runnerList\s*\{[^}]*margin-bottom:\s*24px;/s.test(styles) && /\.datasetVersionCard\s*\{[^}]*margin-bottom:\s*24px;/s.test(styles) && /\.modelChat\s*\{[^}]*margin-top:\s*24px;/s.test(styles), "new cards do not preserve the page spacing rhythm"],
  [!controlPlane.includes('dataset.source_type != "starter"'), "CPU training still rejects user-created data versions"],
  [datasetInspector.includes('writeTextRecords(filepath.Join(datasetDirectory, name+".txt")'), "checked data is not prepared for CPU training"],
  [workbench.includes('function ModelChat') && workbench.includes('experiments/${experiment.id}/chat'), "trained-model chat flow is missing"],
  [/\.dialogScrim\s*\{[^}]*position:\s*fixed;/s.test(styles), "confirmation dialog styling is missing"],
];

const failures = contracts.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) throw new Error(`Workbench UI contract failed:\n${failures.join("\n")}`);
console.log(`Workbench UI contract passed (${contracts.length} checks)`);
