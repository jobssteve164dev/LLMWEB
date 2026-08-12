#!/usr/bin/env bash
set -Eeuo pipefail

VERSION="${1:-}"
OUTPUT_DIRECTORY="${2:-}"
SOURCE_REVISION="${3:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid version" >&2; exit 2; }
[[ "$SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid source revision" >&2; exit 2; }
[[ -n "$OUTPUT_DIRECTORY" ]] || { echo "output directory is required" >&2; exit 2; }

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIRECTORY="$REPOSITORY_ROOT/runtime"
IMAGE="llmweb/runtime-cpu:$VERSION"
DOCKER_STATIC_VERSION="27.5.1"
NANOGPT_REF="3adf61e154c3fe3fca428ad6bc3818b27a3b8291"
TORCH_WHEEL="torch-2.8.0+cpu-cp311-cp311-manylinux_2_28_x86_64.whl"
TORCH_SHA256="cb06175284673a581dd91fb1965662ae4ecaba6e5c357aa0ea7bb8b84b6b7eeb"

mkdir -p "$OUTPUT_DIRECTORY" "$RUNTIME_DIRECTORY/python-wheels" "$RUNTIME_DIRECTORY/nanogpt-$NANOGPT_REF"

download() {
  local url="$1"
  local target="$2"
  local sha256="$3"
  if printf '%s  %s\n' "$sha256" "$target" | sha256sum -c - >/dev/null 2>&1; then return; fi
  curl -fL --retry 3 --retry-all-errors "$url" -o "$target.download"
  printf '%s  %s\n' "$sha256" "$target.download" | sha256sum -c -
  mv "$target.download" "$target"
}

download "https://download-r2.pytorch.org/whl/cpu/torch-2.8.0%2Bcpu-cp311-cp311-manylinux_2_28_x86_64.whl" "$RUNTIME_DIRECTORY/$TORCH_WHEEL" "$TORCH_SHA256"
curl -fL --retry 3 --retry-all-errors \
  "https://download.docker.com/linux/static/stable/x86_64/docker-$DOCKER_STATIC_VERSION.tgz" \
  -o "$OUTPUT_DIRECTORY/docker-static-linux-amd64-$DOCKER_STATIC_VERSION.tgz"

NANOGPT_ARCHIVE="$RUNTIME_DIRECTORY/nanogpt-$NANOGPT_REF.tar.gz"
if [[ ! -f "$RUNTIME_DIRECTORY/nanogpt-$NANOGPT_REF/model.py" ]]; then
  curl -fL --retry 3 --retry-all-errors "https://codeload.github.com/karpathy/nanoGPT/tar.gz/$NANOGPT_REF" -o "$NANOGPT_ARCHIVE.download"
  mv "$NANOGPT_ARCHIVE.download" "$NANOGPT_ARCHIVE"
  tar -xzf "$NANOGPT_ARCHIVE" --strip-components=1 -C "$RUNTIME_DIRECTORY/nanogpt-$NANOGPT_REF"
fi

python3 -m pip download --only-binary=:all: --no-deps --platform manylinux2014_x86_64 \
  --python-version 311 --implementation cp --abi cp311 --dest "$RUNTIME_DIRECTORY/python-wheels" \
  filelock==3.20.3 typing_extensions==4.14.1 setuptools==80.9.0 sympy==1.14.0 \
  networkx==3.5 jinja2==3.1.6 fsspec==2025.7.0 mpmath==1.3.0 MarkupSafe==3.0.2
(cd "$RUNTIME_DIRECTORY/python-wheels" && sha256sum -c ../python-wheels.sha256)

docker build --platform linux/amd64 --build-arg NANOGPT_REF="$NANOGPT_REF" -t "$IMAGE" -f "$RUNTIME_DIRECTORY/Dockerfile.cpu" "$REPOSITORY_ROOT"
docker run --rm "$IMAGE" python -c 'import torch; print(torch.ones(1))' >/dev/null

RUNNER_ASSET="$OUTPUT_DIRECTORY/llmweb-runner-linux-amd64"
RUNTIME_ASSET="$OUTPUT_DIRECTORY/llmweb-runtime-cpu-$VERSION.tar.gz"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go -C "$REPOSITORY_ROOT/runner" build -trimpath -ldflags="-s -w" -o "$RUNNER_ASSET" ./cmd/runner
chmod 0755 "$RUNNER_ASSET"
docker save "$IMAGE" | gzip -1 > "$RUNTIME_ASSET"

RUNNER_SHA256="$(sha256sum "$RUNNER_ASSET" | cut -d' ' -f1)"
RUNTIME_SHA256="$(sha256sum "$RUNTIME_ASSET" | cut -d' ' -f1)"
DOCKER_SHA256="$(sha256sum "$OUTPUT_DIRECTORY/docker-static-linux-amd64-$DOCKER_STATIC_VERSION.tgz" | cut -d' ' -f1)"
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"

python3 - "$OUTPUT_DIRECTORY/manifest.json" "$VERSION" "$SOURCE_REVISION" "$RUNNER_SHA256" "$RUNTIME_SHA256" "$IMAGE" "$IMAGE_ID" "$DOCKER_STATIC_VERSION" "$DOCKER_SHA256" <<'PY'
import json
import sys

target, version, revision, runner_sha, runtime_sha, image, image_id, docker_version, docker_sha = sys.argv[1:]
manifest = {
    "schema_version": "1.0",
    "version": version,
    "source_revision": revision,
    "runner": {"asset": "llmweb-runner-linux-amd64", "sha256": runner_sha},
    "linux_host_runtime": {"asset": f"docker-static-linux-amd64-{docker_version}.tgz", "sha256": docker_sha},
    "variants": {
        "linux-amd64-cpu": {
            "status": "available",
            "minimum": {"cpu_cores": 4, "memory_mb": 7936, "disk_free_mb": 20480},
            "artifact": {"asset": f"llmweb-runtime-cpu-{version}.tar.gz", "sha256": runtime_sha},
            "image": image,
            "image_id": image_id,
        },
        "linux-amd64-cuda": {
            "status": "unavailable",
            "minimum": {"cpu_cores": 4, "memory_mb": 16384, "disk_free_mb": 40960},
            "reason": "等待预构建 CUDA 发行物和真实 NVIDIA 节点验收",
        },
        "darwin-arm64-mps": {
            "status": "unavailable",
            "minimum": {"cpu_cores": 8, "memory_mb": 16384, "disk_free_mb": 40960},
            "reason": "等待原生 MPS 发行包和真实 Apple Silicon 节点验收",
        },
    },
}
with open(target, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY

printf 'runner_bytes=%s\nruntime_archive_bytes=%s\nimage_bytes=%s\nimage_id=%s\n' \
  "$(stat -c %s "$RUNNER_ASSET")" "$(stat -c %s "$RUNTIME_ASSET")" \
  "$(docker image inspect --format '{{.Size}}' "$IMAGE")" "$IMAGE_ID" > "$OUTPUT_DIRECTORY/build-evidence.txt"
