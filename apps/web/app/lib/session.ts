import { createHmac, timingSafeEqual } from "node:crypto";

export const sessionCookie = "llmweb_session";

function password() {
  return process.env.LLMWEB_ACCESS_PASSWORD ?? "local-llmweb";
}

export function sessionValue() {
  return createHmac("sha256", password()).update("llmweb-single-workspace").digest("hex");
}

export function validSession(value: string | undefined) {
  if (!value) return false;
  const expected = Buffer.from(sessionValue());
  const actual = Buffer.from(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validPassword(value: string) {
  const expected = Buffer.from(password());
  const actual = Buffer.from(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
