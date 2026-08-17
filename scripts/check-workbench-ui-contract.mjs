import { readFile } from "node:fs/promises";

const workbench = await readFile(new URL("../apps/web/app/components/workbench.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../apps/web/app/globals.css", import.meta.url), "utf8");

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
];

const failures = contracts.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) throw new Error(`Workbench UI contract failed:\n${failures.join("\n")}`);
console.log(`Workbench UI contract passed (${contracts.length} checks)`);
