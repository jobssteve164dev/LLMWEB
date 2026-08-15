const versionPattern = /^\d+\.\d+\.\d+$/;
const assetPattern = /^[A-Za-z0-9._-]+$/;

function upstreamBaseURL() {
  const value = process.env.LLMWEB_TRAINING_ENVIRONMENT_UPSTREAM_BASE_URL
    ?? "https://gitops-runner.szlk.ai/model-training-releases";
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("训练环境上游地址无效");
  }
  return url.toString().replace(/\/$/, "");
}

export function releaseManifestURL() {
  return `${upstreamBaseURL()}/latest/manifest.json`;
}

export function releaseAssetURL(version: string, asset: string) {
  if (!versionPattern.test(version)) throw new Error("训练环境版本无效");
  if (!assetPattern.test(asset)) throw new Error("训练环境文件名无效");
  return `${upstreamBaseURL()}/${version}/${asset}`;
}

async function fetchUpstream(url: string, range?: string | null) {
  const headers = new Headers({ "User-Agent": "LLMWEB-Artifact-Gateway/1.0" });
  if (range) headers.set("Range", range);
  return fetch(url, { headers, redirect: "follow", cache: "no-store" });
}

export async function fetchReleaseManifest() {
  return fetchUpstream(releaseManifestURL());
}

export async function fetchReleaseAsset(version: string, asset: string, range?: string | null) {
  return fetchUpstream(releaseAssetURL(version, asset), range);
}

export function gatewayResponse(upstream: Response, immutable = true) {
  const headers = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, headers });
}
