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
DOCKER_STATIC_SHA256="4f798b3ee1e0140eab5bf30b0edc4e84f4cdb53255a429dc3bbae9524845d640"
NANOGPT_REF="3adf61e154c3fe3fca428ad6bc3818b27a3b8291"
NANOGPT_ARCHIVE_SHA256="d2826e3acf7e86204daa0e471d938218f90d7c2064bb51dd7dbd36186c14a8a7"
TORCH_WHEEL="torch-2.10.0+cpu-cp313-cp313-manylinux_2_28_x86_64.whl"
TORCH_SHA256="8d316e5bf121f1eab1147e49ad0511a9d92e4c45cc357d1ab0bee440da71a095"
PACKAGE_NAME="llmweb-model-training-linux-amd64-$VERSION.tar.gz"
PACKAGE_ASSET="$OUTPUT_DIRECTORY/$PACKAGE_NAME"
PACKAGE_ROOT="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/llmweb-model-training-package.XXXXXX")"
cleanup_package_root() {
  find "$PACKAGE_ROOT" -xdev -depth -mindepth 1 -delete
  rmdir "$PACKAGE_ROOT"
}
trap cleanup_package_root EXIT

mkdir -p "$OUTPUT_DIRECTORY" "$RUNTIME_DIRECTORY/python-wheels" "$RUNTIME_DIRECTORY/nanogpt-$NANOGPT_REF" "$PACKAGE_ROOT/bin" "$PACKAGE_ROOT/runtime"

download() {
  local url="$1"
  local target="$2"
  local sha256="$3"
  if printf '%s  %s\n' "$sha256" "$target" | sha256sum -c - >/dev/null 2>&1; then return; fi
  curl -fL --retry 3 --retry-all-errors "$url" -o "$target.download"
  printf '%s  %s\n' "$sha256" "$target.download" | sha256sum -c -
  mv "$target.download" "$target"
}

download "https://download-r2.pytorch.org/whl/cpu/torch-2.10.0%2Bcpu-cp313-cp313-manylinux_2_28_x86_64.whl" "$RUNTIME_DIRECTORY/$TORCH_WHEEL" "$TORCH_SHA256"
download "https://download.docker.com/linux/static/stable/x86_64/docker-$DOCKER_STATIC_VERSION.tgz" \
  "$PACKAGE_ROOT/runtime/docker-static.tgz" "$DOCKER_STATIC_SHA256"

NANOGPT_ARCHIVE="$RUNTIME_DIRECTORY/nanogpt-$NANOGPT_REF.tar.gz"
download "https://codeload.github.com/karpathy/nanoGPT/tar.gz/$NANOGPT_REF" \
  "$NANOGPT_ARCHIVE" "$NANOGPT_ARCHIVE_SHA256"
if [[ ! -f "$RUNTIME_DIRECTORY/nanogpt-$NANOGPT_REF/model.py" ]]; then
  tar -xzf "$NANOGPT_ARCHIVE" --strip-components=1 -C "$RUNTIME_DIRECTORY/nanogpt-$NANOGPT_REF"
fi

python3 -m pip download --only-binary=:all: --no-deps --platform manylinux2014_x86_64 \
  --python-version 313 --implementation cp --abi cp313 --dest "$RUNTIME_DIRECTORY/python-wheels" \
  filelock==3.20.3 typing_extensions==4.14.1 setuptools==80.9.0 sympy==1.14.0 \
  networkx==3.5 jinja2==3.1.6 fsspec==2025.7.0 mpmath==1.3.0 MarkupSafe==3.0.2
(cd "$RUNTIME_DIRECTORY/python-wheels" && sha256sum -c ../python-wheels.sha256)

docker build --platform linux/amd64 --build-arg NANOGPT_REF="$NANOGPT_REF" -t "$IMAGE" -f "$RUNTIME_DIRECTORY/Dockerfile.cpu" "$REPOSITORY_ROOT"
docker run --rm "$IMAGE" python -c 'import torch; print(torch.ones(1))' >/dev/null

RUNNER_ASSET="$PACKAGE_ROOT/bin/llmweb-runner"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go -C "$REPOSITORY_ROOT/runner" build -trimpath -ldflags="-s -w" -o "$RUNNER_ASSET" ./cmd/runner
chmod 0755 "$RUNNER_ASSET"
install -m 0755 "$REPOSITORY_ROOT/scripts/install-runner-package.sh" "$PACKAGE_ROOT/install-runner-package.sh"
bash "$REPOSITORY_ROOT/scripts/export-classic-docker-archive.sh" "$IMAGE" "$PACKAGE_ROOT/runtime/image.tar.gz"

RUNNER_SHA256="$(sha256sum "$PACKAGE_ROOT/bin/llmweb-runner" | cut -d' ' -f1)"
INSTALLER_SHA256="$(sha256sum "$PACKAGE_ROOT/install-runner-package.sh" | cut -d' ' -f1)"
HOST_RUNTIME_SHA256="$(sha256sum "$PACKAGE_ROOT/runtime/docker-static.tgz" | cut -d' ' -f1)"
IMAGE_ARCHIVE_SHA256="$(sha256sum "$PACKAGE_ROOT/runtime/image.tar.gz" | cut -d' ' -f1)"

python3 - "$PACKAGE_ROOT/package-manifest.json" "$VERSION" "$SOURCE_REVISION" "$IMAGE" \
  "$INSTALLER_SHA256" "$RUNNER_SHA256" "$HOST_RUNTIME_SHA256" "$IMAGE_ARCHIVE_SHA256" <<'PY'
import json
import sys

target, version, revision, image, installer_sha, runner_sha, host_runtime_sha, image_archive_sha = sys.argv[1:]
manifest = {
    "schema_version": "1.0",
    "version": version,
    "source_revision": revision,
    "platform": "linux/amd64",
    "image": image,
    "minimum": {"cpu_cores": 4, "memory_mb": 7936, "disk_free_mb": 20480},
    "files": {
        "install-runner-package.sh": installer_sha,
        "bin/llmweb-runner": runner_sha,
        "runtime/docker-static.tgz": host_runtime_sha,
        "runtime/image.tar.gz": image_archive_sha,
    },
}
with open(target, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY

tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  -cf - -C "$PACKAGE_ROOT" \
  install-runner-package.sh package-manifest.json bin runtime \
  | gzip -n > "$PACKAGE_ASSET"
PACKAGE_SHA256="$(sha256sum "$PACKAGE_ASSET" | cut -d' ' -f1)"

python3 - "$OUTPUT_DIRECTORY/manifest.json" "$VERSION" "$SOURCE_REVISION" "$PACKAGE_NAME" "$PACKAGE_SHA256" "$IMAGE" <<'PY'
import json
import sys

target, version, revision, package_name, package_sha, image = sys.argv[1:]
manifest = {
    "schema_version": "2.0",
    "version": version,
    "source_revision": revision,
    "packages": {
        "linux-amd64-cpu": {
            "status": "available",
            "minimum": {"cpu_cores": 4, "memory_mb": 7936, "disk_free_mb": 20480},
            "artifact": {"asset": package_name, "sha256": package_sha},
            "image": image,
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

printf 'package=%s\npackage_sha256=%s\npackage_bytes=%s\nrunner_bytes=%s\nimage_archive_bytes=%s\nimage_bytes=%s\nimage_reference=%s\n' \
  "$PACKAGE_NAME" "$PACKAGE_SHA256" "$(stat -c %s "$PACKAGE_ASSET")" \
  "$(stat -c %s "$RUNNER_ASSET")" "$(stat -c %s "$PACKAGE_ROOT/runtime/image.tar.gz")" \
  "$(docker image inspect --format '{{.Size}}' "$IMAGE")" "$IMAGE" > "$OUTPUT_DIRECTORY/build-evidence.txt"
