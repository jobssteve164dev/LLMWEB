import { createPassportClient, PassportClientError } from "@szlk/passport-client";
import type { SessionUser } from "./session";

export { PassportClientError };

export const passportProduct = process.env.PASSPORT_PRODUCT || "llmweb";
export const paidProjectFeature = "project_limit_10";

let client: ReturnType<typeof createPassportClient> | null = null;
const projectLimitCache = new Map<string, { limit: 2 | 10; checkedAt: number }>();

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
    timeoutMs: 12_000,
  });
  return client;
}

export function appBaseUrl() {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export async function linkPassportIdentity(user: SessionUser) {
  await getPassportClient().linkIdentity({
    email: user.email,
    productUid: user.id,
    metadata: { integration: "llmweb_headless_auth" },
  });
}

export async function projectLimitForUser(user: SessionUser): Promise<2 | 10> {
  const cached = projectLimitCache.get(user.id);
  if (cached && Date.now() - cached.checkedAt < 60_000) return cached.limit;

  try {
    const access = await getPassportClient().checkAccess({
      userId: user.id,
      email: user.email,
      product: passportProduct,
      featureKey: paidProjectFeature,
    }) as { allowed?: boolean };
    const limit = access.allowed ? 10 : 2;
    projectLimitCache.set(user.id, { limit, checkedAt: Date.now() });
    return limit;
  } catch (error) {
    if (cached && Date.now() - cached.checkedAt < 5 * 60_000) return cached.limit;
    console.error("[LLMWEB] Passport entitlement check failed; using the free project limit", error);
    return 2;
  }
}
