import { createHmac, timingSafeEqual } from "node:crypto";

export const sessionCookie = "llmweb_session";
export const sessionMaxAge = 60 * 60 * 24 * 7;

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};

type SessionPayload = SessionUser & {
  expiresAt: number;
};

function sessionSecret() {
  const secret = process.env.LLMWEB_SESSION_SECRET || process.env.LLMWEB_WEB_TOKEN;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("LLMWEB_SESSION_SECRET is required in production");
  }
  return secret || "local-llmweb-session-secret";
}

function signature(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createSessionValue(user: SessionUser) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    email: user.email.trim().toLowerCase(),
    name: user.name?.trim() || null,
    expiresAt: Date.now() + sessionMaxAge * 1000,
  } satisfies SessionPayload)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function readSession(value: string | undefined): SessionUser | null {
  if (!value) return null;
  const [payload, suppliedSignature, extra] = value.split(".");
  if (!payload || !suppliedSignature || extra) return null;

  const expected = Buffer.from(signature(payload));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (
      typeof parsed.id !== "string" || !parsed.id ||
      typeof parsed.email !== "string" || !parsed.email ||
      typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now()
    ) return null;
    return {
      id: parsed.id,
      email: parsed.email,
      name: typeof parsed.name === "string" && parsed.name ? parsed.name : null,
    };
  } catch {
    return null;
  }
}
