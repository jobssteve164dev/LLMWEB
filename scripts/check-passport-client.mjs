import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPassportClient } from "../packages/passport-client/index.js";

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

console.log("Passport client deadline regression check passed");
