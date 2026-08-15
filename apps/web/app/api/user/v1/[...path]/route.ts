import { NextRequest, NextResponse } from "next/server";
import { ApiConnectionError, bearerCredential, recordApiActivity, resolveApiConnection, trustedApiHeaders } from "../../../../lib/api-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

const routeRules = [
  { method: "GET", pattern: /^state$/, capability: "workspace:read", action: "read_workspace" },
  { method: "POST", pattern: /^projects$/, capability: "project:write", action: "create_project" },
  { method: "POST", pattern: /^runners\/pairing$/, capability: "runner:pair", action: "create_runner_pairing" },
  { method: "POST", pattern: /^datasets$/, capability: "project:write", action: "create_dataset" },
  { method: "POST", pattern: /^experiments$/, capability: "training:write", action: "start_training" },
  { method: "POST", pattern: /^experiments\/[^/]+\/select-checkpoint$/, capability: "training:write", action: "select_training_result" },
  { method: "POST", pattern: /^jobs\/[^/]+\/control$/, capability: "training:write", action: "control_training" },
] as const;

async function proxy(request: NextRequest, context: RouteContext) {
  const credential = bearerCredential(request.headers.get("authorization"));
  if (!credential) return NextResponse.json({ detail: "API 连接凭证缺失。" }, { status: 401 });
  const { path } = await context.params;
  const route = path.join("/");
  const rule = routeRules.find((item) => item.method === request.method && item.pattern.test(route));
  if (!rule) {
    return NextResponse.json({ detail: "这个 API 路径不可用。" }, { status: 404 });
  }

  try {
    const resolved = await resolveApiConnection(credential);
    if (!resolved.connection.capabilities.includes(rule.capability)) {
      return NextResponse.json({ detail: "这个 API 连接没有执行该动作的权限。" }, { status: 403 });
    }
    const baseUrl = process.env.LLMWEB_CONTROL_URL ?? "http://localhost:8000";
    let body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
    const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    let parameterNames: string[] = [];
    if (body) {
      const parsedBody = JSON.parse(body) as Record<string, unknown>;
      parameterNames = Object.keys(parsedBody);
    }
    if (/^jobs\/[^/]+\/control$/.test(route) && body) {
      const parsed = JSON.parse(body) as { action?: string; confirmation?: string };
      if (parsed.action === "cancel" && parsed.confirmation !== "CONFIRM_CANCEL_TRAINING") {
        return NextResponse.json({ detail: "取消训练需要本次调用的明确确认。" }, { status: 400 });
      }
      body = JSON.stringify({ action: parsed.action });
    }
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/${route}${request.nextUrl.search}`, {
      method: request.method,
      headers: {
        ...trustedApiHeaders(resolved),
        "X-Request-ID": requestId,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body,
      cache: "no-store",
    });
    const pathParts = route.split("/");
    const targetIndex = pathParts.findIndex((part) => part === "experiments" || part === "jobs");
    await recordApiActivity(resolved, {
      request_id: requestId,
      action: rule.action,
      outcome: response.ok ? "succeeded" : "failed",
      ...(targetIndex >= 0 && pathParts[targetIndex + 1] ? { target_type: pathParts[targetIndex].slice(0, -1), target_id: pathParts[targetIndex + 1] } : {}),
      parameter_names: parameterNames,
    });
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ApiConnectionError) return NextResponse.json({ detail: error.message }, { status: error.status });
    console.error("[LLMWEB] User API request failed", error);
    return NextResponse.json({ detail: "用户 API 暂时不可用。" }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
