import { fetchReleaseAsset, fetchReleaseManifest, gatewayResponse } from "../../release";

type RouteContext = { params: Promise<{ asset: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { asset } = await context.params;
  let manifestResponse: Response;
  try {
    manifestResponse = await fetchReleaseManifest();
  } catch {
    return Response.json({ detail: "训练环境清单暂时不可用" }, { status: 503 });
  }
  if (!manifestResponse.ok) return Response.json({ detail: "训练环境清单暂时不可用" }, { status: 503 });
  const manifest = await manifestResponse.json() as {
    schema_version?: string;
    version?: string;
    packages?: Record<string, { status?: string; artifact?: { asset?: string } }>;
  };
  const packageAsset = manifest.packages?.["linux-amd64-cpu"]?.artifact?.asset;
  if (manifest.schema_version !== "2.0" || !manifest.version || !packageAsset) {
    return Response.json({ detail: "训练环境清单暂时不可用" }, { status: 503 });
  }
  const allowed = new Set([packageAsset, `${packageAsset}.sha256`, `${packageAsset}.sig`]);
  if (!allowed.has(asset)) return Response.json({ detail: "训练环境文件不存在" }, { status: 404 });
  let upstream: Response;
  try {
    upstream = await fetchReleaseAsset(manifest.version, asset, request.headers.get("range"));
  } catch {
    return Response.json({ detail: "训练环境文件暂时不可用" }, { status: 503 });
  }
  if (!upstream.ok) return Response.json({ detail: "训练环境文件暂时不可用" }, { status: 503 });
  return gatewayResponse(upstream);
}
