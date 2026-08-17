import { planAccessForUser } from "./passport";

type ResolvedApiConnection = {
  connection: { id: string; capabilities: string[] };
  identity: { user_id: string; email: string; name: string | null; workspace_id: string };
};

export function bearerCredential(header: string | null) {
  if (!header?.startsWith("Bearer ")) return null;
  const credential = header.slice("Bearer ".length).trim();
  return credential || null;
}

export async function resolveApiConnection(credential: string) {
  const baseUrl = process.env.LLMWEB_CONTROL_URL ?? "http://localhost:8000";
  const webToken = process.env.LLMWEB_WEB_TOKEN ?? "local-dev-token";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/api-connections/resolve`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${webToken}`,
      "X-LLMWEB-API-Credential": credential,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new ApiConnectionError(response.status, payload?.detail ?? "API 连接凭证无效。");
  }
  const resolved = await response.json() as ResolvedApiConnection;
  const user = { id: resolved.identity.user_id, email: resolved.identity.email, name: resolved.identity.name };
  const planAccess = await planAccessForUser(user);
  if (!planAccess.paid) throw new ApiConnectionError(403, "API 连接仅对 Pro 用户开放。");
  return { ...resolved, projectLimit: planAccess.limit, webToken };
}

export function trustedApiHeaders(resolved: Awaited<ReturnType<typeof resolveApiConnection>>) {
  return {
    Authorization: `Bearer ${resolved.webToken}`,
    "X-LLMWEB-User-ID": resolved.identity.user_id,
    "X-LLMWEB-User-Email": Buffer.from(resolved.identity.email).toString("base64url"),
    "X-LLMWEB-User-Name": Buffer.from(resolved.identity.name || "").toString("base64url"),
    "X-LLMWEB-Project-Limit": String(resolved.projectLimit),
    "X-LLMWEB-Paid-Plan": "true",
    "X-LLMWEB-API-Connection-ID": resolved.connection.id,
  };
}

export async function recordApiActivity(
  resolved: Awaited<ReturnType<typeof resolveApiConnection>>,
  event: { request_id: string; action: string; outcome: "succeeded" | "failed"; target_type?: string; target_id?: string; parameter_names?: string[] },
) {
  const baseUrl = process.env.LLMWEB_CONTROL_URL ?? "http://localhost:8000";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/api-connections/audit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.LLMWEB_WEB_TOKEN ?? "local-dev-token"}`, "X-LLMWEB-API-Connection-ID": resolved.connection.id, "Content-Type": "application/json" },
    body: JSON.stringify(event),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`API 调用审计写入失败 (${response.status})`);
}

export class ApiConnectionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
