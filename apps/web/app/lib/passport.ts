import { createPassportClient, PassportClientError } from "@szlk/passport-client";
import type { SessionUser } from "./session";

export { PassportClientError };

export const passportProduct = process.env.PASSPORT_PRODUCT || "llmweb";
const paidProjectFeature = "project_limit_10";

let client: ReturnType<typeof createPassportClient> | null = null;
const projectLimitCache = new Map<string, { limit: number; checkedAt: number }>();

type CatalogPlan = {
  planId: string;
  label: string;
  labelZh: string;
  priceKey: string;
  interval: "year";
  currency: "usd";
  amountCents: number;
  featureKeys: string[];
  metadata: {
    customerDisplay: { zh: { name: string; billingSuffix: string; offerLabel: string; summary: string } };
    freeTier: { amountCents: number; name: { zh: string }; summary: { zh: string } };
    refundDays: number;
    trialDays: number;
    includesCompute: false;
    includesStorage: false;
    quotas: { projects: { free: number; paid: number; unit: "active_projects" } };
    features: Array<{ key: string; name: { zh: string }; free: { zh: string }; paid: { zh: string } }>;
  };
};

export type LlmwebPlanTruth = CatalogPlan & { catalogVersion: string | null };

export function getPassportClient() {
  const secret = process.env.SZLK_PASSPORT_SECRET;
  if (!secret) {
    throw new PassportClientError("Passport is not configured", {
      code: "passport_secret_missing",
      status: 500,
    });
  }
  client ??= createPassportClient({
    baseUrl: process.env.SZLK_PASSPORT_URL || "https://passport.szlk.ai",
    product: passportProduct,
    secret,
    timeoutMs: 0,
  });
  return client;
}

export function appBaseUrl() {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Passport catalog ${field} is missing`);
  return value;
}

function requiredPositiveInteger(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`Passport catalog ${field} is invalid`);
  return Number(value);
}

export async function getLlmwebPlanTruth(): Promise<LlmwebPlanTruth> {
  const catalog = await getPassportClient().getBillingCatalog({ product: passportProduct }) as {
    version?: unknown;
    catalogVersion?: unknown;
    plans?: unknown;
  };
  if (!Array.isArray(catalog.plans)) throw new Error("Passport catalog plans are unavailable");
  const matches = catalog.plans.filter((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const features = (candidate as { featureKeys?: unknown }).featureKeys;
    return Array.isArray(features) && features.includes(paidProjectFeature);
  });
  if (matches.length !== 1) throw new Error("Passport catalog must contain exactly one LLMWEB Pro plan");
  const raw = matches[0] as Record<string, unknown>;
  const metadata = raw.metadata as Record<string, unknown> | null;
  const quotas = metadata?.quotas as Record<string, unknown> | null;
  const projects = quotas?.projects as Record<string, unknown> | null;
  const display = metadata?.customerDisplay as Record<string, unknown> | null;
  const zh = display?.zh as Record<string, unknown> | null;
  const freeTier = metadata?.freeTier as Record<string, unknown> | null;
  const freeName = freeTier?.name as Record<string, unknown> | null;
  const freeSummary = freeTier?.summary as Record<string, unknown> | null;
  const features = metadata?.features;
  if (!metadata || !projects || !zh || !freeTier || !freeName || !freeSummary || !Array.isArray(features)) throw new Error("Passport catalog LLMWEB metadata is incomplete");
  if (freeTier.amountCents !== 0) throw new Error("Passport catalog free tier price is invalid");
  const free = requiredPositiveInteger(projects.free, "free project quota");
  const paid = requiredPositiveInteger(projects.paid, "paid project quota");
  if (paid <= free || projects.unit !== "active_projects") throw new Error("Passport catalog project quotas are invalid");
  if (raw.interval !== "year" || raw.currency !== "usd" || metadata.includesCompute !== false || metadata.includesStorage !== false) {
    throw new Error("Passport catalog LLMWEB billing boundary is invalid");
  }
  return {
    planId: requiredText(raw.planId, "planId"),
    label: requiredText(raw.label, "label"),
    labelZh: requiredText(raw.labelZh, "labelZh"),
    priceKey: requiredText(raw.priceKey, "priceKey"),
    interval: "year",
    currency: "usd",
    amountCents: requiredPositiveInteger(raw.amountCents, "amountCents"),
    featureKeys: (raw.featureKeys as unknown[]).map((value) => requiredText(value, "featureKey")),
    metadata: {
      customerDisplay: { zh: {
        name: requiredText(zh.name, "customer display name"),
        billingSuffix: requiredText(zh.billingSuffix, "billing suffix"),
        offerLabel: requiredText(zh.offerLabel, "offer label"),
        summary: requiredText(zh.summary, "summary"),
      } },
      freeTier: { amountCents: 0, name: { zh: requiredText(freeName.zh, "free tier name") }, summary: { zh: requiredText(freeSummary.zh, "free tier summary") } },
      refundDays: requiredPositiveInteger(metadata.refundDays, "refundDays"),
      trialDays: Number(metadata.trialDays),
      includesCompute: false,
      includesStorage: false,
      quotas: { projects: { free, paid, unit: "active_projects" } },
      features: features.map((feature, index) => {
        const item = feature as Record<string, unknown>;
        const name = item.name as Record<string, unknown>;
        const freeValue = item.free as Record<string, unknown>;
        const paidValue = item.paid as Record<string, unknown>;
        return { key: requiredText(item.key, `feature ${index}`), name: { zh: requiredText(name?.zh, `feature ${index} name`) }, free: { zh: requiredText(freeValue?.zh, `feature ${index} free`) }, paid: { zh: requiredText(paidValue?.zh, `feature ${index} paid`) } };
      }),
    },
    catalogVersion: typeof catalog.catalogVersion === "string" ? catalog.catalogVersion : typeof catalog.version === "string" ? catalog.version : null,
  };
}

export async function linkPassportIdentity(user: SessionUser) {
  await getPassportClient().linkIdentity({
    email: user.email,
    productUid: user.id,
    metadata: { integration: "llmweb_headless_auth" },
  });
}

export async function projectLimitForUser(user: SessionUser): Promise<number> {
  const cached = projectLimitCache.get(user.id);
  if (cached && Date.now() - cached.checkedAt < 60_000) return cached.limit;

  const plan = await getLlmwebPlanTruth();
  const access = await getPassportClient().checkAccess({
    userId: user.id,
    email: user.email,
    product: passportProduct,
    featureKey: paidProjectFeature,
  }) as { allowed?: boolean; entitlements?: unknown };
  const exactEntitlement = Array.isArray(access.entitlements) && access.entitlements.includes(paidProjectFeature);
  const limit = access.allowed === true && exactEntitlement ? plan.metadata.quotas.projects.paid : plan.metadata.quotas.projects.free;
  projectLimitCache.set(user.id, { limit, checkedAt: Date.now() });
  return limit;
}
