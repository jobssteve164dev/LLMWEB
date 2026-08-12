const repository = "jobssteve164dev/LLMWEB";
const versionPattern = /^\d+\.\d+\.\d+$/;
const assetPattern = /^[A-Za-z0-9._-]+$/;

export function trainingEnvironmentVersion() {
  const version = process.env.LLMWEB_TRAINING_ENVIRONMENT_VERSION ?? "0.2.0";
  if (!versionPattern.test(version)) throw new Error("训练环境版本配置无效");
  return version;
}

export function releaseAssetURL(asset: string) {
  if (!assetPattern.test(asset)) throw new Error("训练环境文件名无效");
  return `https://github.com/${repository}/releases/download/training-env-v${trainingEnvironmentVersion()}/${asset}`;
}

export async function fetchReleaseAsset(asset: string, range?: string | null) {
  const headers = new Headers({ "User-Agent": "LLMWEB-Artifact-Gateway/1.0" });
  if (range) headers.set("Range", range);
  return fetch(releaseAssetURL(asset), { headers, redirect: "follow", cache: "no-store" });
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
