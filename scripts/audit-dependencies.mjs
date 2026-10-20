import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function evaluateAudit(report) {
  if (!report?.metadata?.vulnerabilities || !report.advisories || report.error) {
    throw new Error("Dependency audit did not return a complete vulnerability report");
  }
  const blockers = [];
  const backports = [];
  for (const advisory of Object.values(report.advisories)) {
    const backported = advisory.module_name === "braces"
      && advisory.github_advisory_id === "GHSA-vfj7-8cjw-p6xm"
      && advisory.severity === "high"
      && advisory.findings?.length > 0
      && advisory.findings.every((finding) => finding.version === "3.0.3");
    if (backported) backports.push(advisory);
    else if (["high", "critical"].includes(advisory.severity)) blockers.push(advisory);
  }
  return { blockers, backports };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const regression = spawnSync("pnpm", ["check:dependency-security"], { cwd: root, stdio: "inherit" });
  if (regression.error || regression.status !== 0) {
    throw new Error("Dependency regression failed; no audit exception is permitted");
  }
  // Do not use `pnpm audit --ignore`: pnpm 11 persists that flag in workspace config.
  const audit = spawnSync("pnpm", ["audit", "--json"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (audit.error || ![0, 1].includes(audit.status)) {
    throw new Error("Dependency audit could not complete; inspect the registry connection");
  }
  const report = JSON.parse(audit.stdout);
  const { blockers, backports } = evaluateAudit(report);
  console.log("Unfiltered audit counts:", JSON.stringify(report.metadata.vulnerabilities));
  for (const advisory of Object.values(report.advisories)) {
    console.log(`${advisory.severity}: ${advisory.module_name} ${advisory.url || advisory.github_advisory_id}`);
  }
  if (backports.length) {
    console.log("braces@3.0.3: tested local backport; upstream advisory remains open (docs/security/dependency-remediation.md)");
  }
  process.exitCode = blockers.length ? 1 : 0;
}
