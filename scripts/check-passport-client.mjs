import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPassportClient, PassportClientError } from "../packages/passport-client/index.js";
import { getLlmwebPlanTruth, planAccessForUser } from "../apps/web/app/lib/passport.ts";

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

process.env.SZLK_PASSPORT_SECRET = "contract-test-secret";
process.env.SZLK_PASSPORT_URL = "https://passport.contract.invalid";

const productionCatalog = {
  ...legacyFreeQuotaCatalog,
  catalogVersion: "production-shape-v1",
};
const accessScenarios = new Map();
const accessCalls = new Map();

function accessDecision(userId, allowed, reason) {
  return {
    allowed,
    reason,
    email: `${userId}@example.invalid`,
    userId,
    product: "llmweb",
    featureKey: "project_limit_10",
    mappingStrategy: allowed ? "stripe_subscription" : "none",
    productAccess: allowed ? { status: "active" } : null,
    featureGrant: allowed ? { status: "active" } : null,
  };
}

function envelope(data, status = 200) {
  return new Response(JSON.stringify({ ok: true, data, meta: { apiVersion: "v1" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorEnvelope(status, code) {
  return new Response(JSON.stringify({
    ok: false,
    error: { code, message: `Contract fixture: ${code}` },
    meta: { apiVersion: "v1" },
  }), { status, headers: { "content-type": "application/json" } });
}

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname === "/api/v1/billing/catalog") return envelope(productionCatalog);
  if (url.pathname !== "/api/v1/entitlements/access-check") throw new Error(`Unexpected Passport path: ${url.pathname}`);
  const body = JSON.parse(String(init?.body));
  accessCalls.set(body.userId, (accessCalls.get(body.userId) ?? 0) + 1);
  const scenario = accessScenarios.get(body.userId);
  if (!scenario) throw new Error(`Missing access scenario for ${body.userId}`);
  if (scenario.networkError) throw new Error("simulated network outage");
  if (scenario.error) return errorEnvelope(scenario.error.status, scenario.error.code);
  return envelope(scenario.decision);
};

const paidUser = { id: "paid-user", email: "paid-user@example.invalid", name: null };
accessScenarios.set(paidUser.id, { decision: accessDecision(paidUser.id, true, "feature_granted") });
const paidAccess = await planAccessForUser(paidUser);
assert.deepEqual(paidAccess, { paid: true, limit: 10 }, "allowed:true without entitlements must restore Pro and catalog quota");
assert.equal("entitlements" in accessScenarios.get(paidUser.id).decision, false, "production-shaped access data must not invent entitlements");
assert.deepEqual(await planAccessForUser(paidUser), paidAccess, "a repeated paid read must remain Pro");
assert.equal(accessCalls.get(paidUser.id), 1, "the existing user-level decision cache must remain active");

for (const [userId, reason] of [
  ["no-entitlement-user", "feature_not_granted"],
  ["expired-user", "feature_not_granted"],
  ["revoked-user", "feature_not_granted"],
]) {
  accessScenarios.set(userId, { decision: accessDecision(userId, false, reason) });
  assert.deepEqual(
    await planAccessForUser({ id: userId, email: `${userId}@example.invalid`, name: null }),
    { paid: false, limit: 1 },
    `${userId} must remain Free with the product free quota`,
  );
}

const remoteFailures = [
  ["missing-user", 404, "user_not_found"],
  ["mismatched-product", 403, "product_mismatch"],
  ["missing-secret", 401, "missing_product_secret"],
  ["invalid-secret", 403, "invalid_product_secret"],
  ["passport-internal", 500, "access_check_failed"],
];
for (const [userId, status, code] of remoteFailures) {
  accessScenarios.set(userId, { error: { status, code } });
  await assert.rejects(
    planAccessForUser({ id: userId, email: `${userId}@example.invalid`, name: null }),
    (error) => error instanceof PassportClientError && error.status === status && error.code === code,
    `${code} must propagate instead of becoming Free or Pro`,
  );
}

const recoveringUser = { id: "recovering-user", email: "recovering-user@example.invalid", name: null };
accessScenarios.set(recoveringUser.id, { networkError: true });
await assert.rejects(
  planAccessForUser(recoveringUser),
  (error) => error instanceof PassportClientError && error.status === 503 && error.code === "passport_request_failed",
  "network failures must remain a recoverable plan error",
);
accessScenarios.set(recoveringUser.id, { decision: accessDecision(recoveringUser.id, true, "feature_granted") });
assert.deepEqual(await planAccessForUser(recoveringUser), { paid: true, limit: 10 }, "a service error must not be cached as a plan decision");

assert.doesNotMatch(llmwebPassport, /access\.entitlements/, "LLMWEB must not derive access from a field outside the access decision contract");
assert.match(llmwebPassport, /const paid = access\.allowed === true;/, "top-level allowed must be the only user access conclusion");

const [controlProxy, apiConnections, workbench] = await Promise.all([
  readFile(new URL("../apps/web/app/api/control/[...path]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/app/lib/api-connection.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/app/components/workbench.tsx", import.meta.url), "utf8"),
]);
assert.match(controlProxy, /"X-LLMWEB-Paid-Plan": String\(planAccess\.paid\)/, "control requests must consume the plan decision directly");
assert.match(controlProxy, /"X-LLMWEB-Project-Limit": String\(planAccess\.limit\)/, "control requests must consume the catalog quota directly");
assert.match(apiConnections, /if \(!planAccess\.paid\) throw new ApiConnectionError\(403/, "API connections must remain gated by the same plan decision");
assert.match(workbench, /state\.account\.plan === "paid" \? "Pro" : "Free"/, "the account label must render Pro from the paid control state");
assert.match(workbench, /state\.account\.plan === "free" \? <Link href="\/#pricing">/, "upgrade navigation must only render for Free accounts");
assert.match(workbench, /state\.account\.plan === "paid" \? <button[^>]*onClick=\{\(\) => moveTo\("settings"\)\}/, "Pro accounts must expose settings instead of an upgrade action");

console.log("Passport integration regression checks passed");
