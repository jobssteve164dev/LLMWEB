import { fetchReleaseManifest, gatewayResponse } from "../release";

export async function GET() {
  let upstream: Response;
  try {
    upstream = await fetchReleaseManifest();
  } catch {
    return Response.json({ detail: "训练环境清单暂时不可用" }, { status: 503 });
  }
  if (!upstream.ok) return Response.json({ detail: "训练环境清单暂时不可用" }, { status: 503 });
  return gatewayResponse(upstream, false);
}
