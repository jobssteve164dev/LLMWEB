import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path?: string[] }> };

async function proxy(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  const baseUrl = process.env.LLMWEB_CONTROL_URL ?? "http://localhost:8000";
  const suffix = path.length ? `/${path.join("/")}` : "";
  const target = `${baseUrl.replace(/\/$/, "")}/api/provider-bridge${suffix}${request.nextUrl.search}`;
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
  const forwardedHeaders = [
    "authorization",
    "x-cloudmcp-bridge-client",
    "x-cloudmcp-bridge-provider",
    "x-cloudmcp-bridge-version",
  ];

  try {
    const response = await fetch(target, {
      method: request.method,
      headers: Object.fromEntries(
        forwardedHeaders
          .map((name) => [name, request.headers.get(name)] as const)
          .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
      ),
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
  } catch {
    return NextResponse.json({ detail: "训练服务暂时没有响应。" }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
