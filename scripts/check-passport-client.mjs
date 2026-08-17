import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPassportClient } from "../packages/passport-client/index.js";
import { getLlmwebPlanTruth } from "../apps/web/app/lib/passport.ts";

const response = () => new Response(JSON.stringify({ ok: true, data: { linked: true } }), {
  status: 200,
  headers: { "content-type": "application/json" },
});

let noDeadlineSignal;
const noDeadlineClient = createPassportClient({
  baseUrl: "https://passport.example",
  product: "llmweb",
  secret: "test-secret",
  timeoutMs: 0,
  fetchImpl: async (_url, init) => {
    noDeadlineSignal = init?.signal;
    return response();
  },
});
await noDeadlineClient.linkIdentity({ email: "owner@example.com", productUid: "user-1" });
assert.equal(noDeadlineSignal, undefined, "timeoutMs: 0 must not attach an abort deadline");

let boundedSignal;
const boundedClient = createPassportClient({
  baseUrl: "https://passport.example",
  product: "llmweb",
  secret: "test-secret",
  timeoutMs: 1_000,
  fetchImpl: async (_url, init) => {
    boundedSignal = init?.signal;
    return response();
  },
});
await boundedClient.linkIdentity({ email: "owner@example.com", productUid: "user-1" });
assert.ok(boundedSignal instanceof AbortSignal, "positive timeout must retain the bounded client behavior");

const llmwebPassport = await readFile(new URL("../apps/web/app/lib/passport.ts", import.meta.url), "utf8");
assert.match(llmwebPassport, /timeoutMs:\s*0/, "LLMWEB must explicitly disable the fixed Passport deadline");
assert.doesNotMatch(llmwebPassport, /timeoutMs:\s*12_000/, "the former 12 second main-path deadline must not return");

const legacyFreeQuotaCatalog = {
  catalogVersion: "legacy-free-two",
  plans: [{
    planId: "pro",
    label: "Pro",
    labelZh: "专业版",
    priceKey: "pro_year",
    interval: "year",
    currency: "usd",
    amountCents: 9900,
    featureKeys: ["project_limit_10"],
    metadata: {
      customerDisplay: { zh: { name: "专业版", billingSuffix: "每年", offerLabel: "更多项目", summary: "多项目" } },
      freeTier: { amountCents: 0, name: { zh: "免费版" }, summary: { zh: "免费使用" } },
      refundDays: 7,
      trialDays: 0,
      includesCompute: false,
      includesStorage: false,
      quotas: { projects: { free: 2, paid: 10, unit: "active_projects" } },
      features: [{ key: "project_limit_10", name: { zh: "项目" }, free: { zh: "1 个" }, paid: { zh: "10 个" } }],
    },
  }],
};
const normalizedPlan = await getLlmwebPlanTruth({ getBillingCatalog: async () => legacyFreeQuotaCatalog });
assert.equal(normalizedPlan.metadata.quotas.projects.free, 1, "legacy Passport free quota must be narrowed to one project");
assert.equal(normalizedPlan.metadata.quotas.projects.paid, 10, "Passport Pro quota must remain authoritative");

await assert.rejects(
  getLlmwebPlanTruth({ getBillingCatalog: async () => ({
    ...legacyFreeQuotaCatalog,
    plans: [{
      ...legacyFreeQuotaCatalog.plans[0],
      metadata: {
        ...legacyFreeQuotaCatalog.plans[0].metadata,
        quotas: { projects: { free: 2, paid: 10, unit: "requests" } },
      },
    }],
  }) }),
  /project quotas are invalid/,
  "unknown quota units must still fail closed",
);

console.log("Passport integration regression checks passed");
