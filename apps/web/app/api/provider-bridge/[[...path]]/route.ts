import { NextRequest, NextResponse } from "next/server";
import { ApiConnectionError, bearerCredential, resolveApiConnection, trustedApiHeaders } from "../../../lib/api-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path?: string[] }> };

const PROVIDER_BRIDGE_RETIRED = true;

async function proxy(request: NextRequest, context: RouteContext) {
  if (PROVIDER_BRIDGE_RETIRED) {
    return NextResponse.json(
      { detail: "此接口已退役，请使用账户 API。" },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { path = [] } = await context.params;
  const baseUrl = process.env.LLMWEB_CONTROL_URL ?? "http://localhost:8000";
  const suffix = path.length ? `/${path.join("/")}` : "";
  const target = `${baseUrl.replace(/\/$/, "")}/api/provider-bridge${suffix}${request.nextUrl.search}`;
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();

  try {
    if (request.method === "GET" || request.method === "HEAD") {
      const response = await fetch(target, { method: request.method, cache: "no-store" });
      return new NextResponse(await response.text(), { status: response.status, headers: { "Content-Type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
    }
    const credential = bearerCredential(request.headers.get("authorization"));
    if (!credential) return NextResponse.json({ detail: "API 连接凭证缺失。" }, { status: 401 });
    const resolved = await resolveApiConnection(credential);
    const response = await fetch(target, {
      method: request.method,
      headers: {
        ...trustedApiHeaders(resolved),
        "Content-Type": "application/json",
        "X-Request-ID": request.headers.get("x-request-id") || crypto.randomUUID(),
      },
      body,
      cache: "no-store",
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ApiConnectionError) return NextResponse.json({ detail: error.message }, { status: error.status });
    console.error("[LLMWEB] Provider-compatible user API request failed", error);
    return NextResponse.json({ detail: "训练服务暂时没有响应。" }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
