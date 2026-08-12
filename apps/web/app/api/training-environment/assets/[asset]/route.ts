import { fetchReleaseAsset, gatewayResponse } from "../../release";

type RouteContext = { params: Promise<{ asset: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { asset } = await context.params;
  let manifestResponse: Response;
  try {
    manifestResponse = await fetchReleaseAsset("manifest.json");
  } catch {
    return Response.json({ detail: "训练环境清单暂时不可用" }, { status: 503 });
  }
  if (!manifestResponse.ok) return Response.json({ detail: "训练环境清单暂时不可用" }, { status: 503 });
  const manifest = await manifestResponse.json() as {
    runner?: { asset?: string };
    linux_host_runtime?: { asset?: string };
    variants?: Record<string, { artifact?: { asset?: string } }>;
  };
  const allowed = new Set([
    manifest.runner?.asset,
    manifest.linux_host_runtime?.asset,
    ...Object.values(manifest.variants ?? {}).map((variant) => variant.artifact?.asset),
  ].filter((value): value is string => Boolean(value)));
  if (!allowed.has(asset)) return Response.json({ detail: "训练环境文件不存在" }, { status: 404 });
  let upstream: Response;
  try {
    upstream = await fetchReleaseAsset(asset, request.headers.get("range"));
  } catch {
    return Response.json({ detail: "训练环境文件暂时不可用" }, { status: 503 });
  }
  if (!upstream.ok) return Response.json({ detail: "训练环境文件暂时不可用" }, { status: 503 });
  return gatewayResponse(upstream);
}
