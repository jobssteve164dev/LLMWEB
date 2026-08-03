import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxyRunner(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const baseUrl = process.env.LLMWEB_CONTROL_URL ?? "http://localhost:8000";
  const target = `${baseUrl.replace(/\/$/, "")}/v1/${path.join("/")}${request.nextUrl.search}`;

  try {
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
    const authorization = request.headers.get("authorization");
    const response = await fetch(target, {
      method: request.method,
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        ...(body ? { "Content-Type": request.headers.get("content-type") ?? "application/json" } : {}),
      },
      body,
      cache: "no-store",
    });
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ detail: "训练面板暂时无法连接控制服务。" }, { status: 503 });
  }
}

export const GET = proxyRunner;
export const POST = proxyRunner;
