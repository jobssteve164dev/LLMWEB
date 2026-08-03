import { NextRequest, NextResponse } from "next/server";
import { sessionCookie, validSession } from "../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: RouteContext) {
  if (!validSession(request.cookies.get(sessionCookie)?.value)) {
    return NextResponse.json({ detail: "请先输入工作台访问密码。" }, { status: 401 });
  }
  const { path } = await context.params;
  const baseUrl = process.env.LLMWEB_CONTROL_URL ?? "http://localhost:8000";
  const token = process.env.LLMWEB_WEB_TOKEN ?? "local-dev-token";
  const target = `${baseUrl.replace(/\/$/, "")}/v1/${path.join("/")}${request.nextUrl.search}`;

  try {
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
    const response = await fetch(target, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": request.headers.get("content-type") ?? "application/json" } : {}),
      },
      body,
      cache: "no-store",
    });
    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json(
      { detail: "训练服务暂时没有响应，请确认控制面已经启动。" },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
