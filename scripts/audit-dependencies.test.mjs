import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAudit } from "./audit-dependencies.mjs";

const braces = {
  module_name: "braces", severity: "high", github_advisory_id: "GHSA-vfj7-8cjw-p6xm",
  findings: [{ version: "3.0.3" }],
};
const report = (...advisories) => ({ metadata: { vulnerabilities: {} }, advisories: Object.fromEntries(advisories.map((value, index) => [index, value])) });

test("the tested braces backport remains visible without blocking the audit", () => {
  const result = evaluateAudit(report(braces));
  assert.equal(result.backports.length, 1);
  assert.equal(result.blockers.length, 0);
});

test("other versions, packages and advisories cannot inherit the backport exception", () => {
  for (const finding of [
    { ...braces, findings: [{ version: "3.0.2" }] },
    { ...braces, findings: [{ version: "3.0.3" }, { version: "3.0.2" }] },
    { ...braces, module_name: "another-package" },
    { ...braces, github_advisory_id: "GHSA-another" },
    { ...braces, findings: [] },
    { ...braces, severity: "critical" },
  ]) {
    assert.equal(evaluateAudit(report(finding)).blockers.length, 1);
  }
});

test("an unrelated high or critical finding still blocks alongside the backport", () => {
  const result = evaluateAudit(report(braces, { ...braces, module_name: "next", severity: "critical" }));
  assert.equal(result.blockers.length, 1);
});

test("registry errors and incomplete audit output fail closed", () => {
  for (const value of [null, {}, { error: { message: "registry unavailable" } }, { metadata: {} }, { metadata: {}, advisories: {} }]) {
    assert.throws(() => evaluateAudit(value));
  }
});

test("a valid empty audit has no blockers or backports", () => {
  assert.deepEqual(evaluateAudit(report()), { blockers: [], backports: [] });
});
