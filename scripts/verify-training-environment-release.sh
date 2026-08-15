#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_DIRECTORY="${1:-}"
[[ -d "$RELEASE_DIRECTORY" ]] || { echo "release directory is required" >&2; exit 2; }
MANIFEST="$RELEASE_DIRECTORY/manifest.json"
[[ -s "$MANIFEST" ]] || { echo "manifest.json is missing" >&2; exit 1; }

mapfile -t RELEASE_CONTRACT < <(python3 - "$MANIFEST" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    manifest = json.load(handle)

cpu = manifest["variants"]["linux-amd64-cpu"]
fields = [
    manifest["installer"]["asset"], manifest["installer"]["sha256"],
    manifest["runner"]["asset"], manifest["runner"]["sha256"],
    manifest["linux_host_runtime"]["asset"], manifest["linux_host_runtime"]["sha256"],
    cpu["artifact"]["asset"], cpu["artifact"]["sha256"],
    cpu["image"], cpu["image_id"], manifest["version"], manifest["source_revision"],
]
for field in fields:
    print(field)
PY
)

[[ "${#RELEASE_CONTRACT[@]}" -eq 12 ]] || { echo "release manifest contract is incomplete" >&2; exit 1; }
INSTALLER_ASSET="${RELEASE_CONTRACT[0]}"
INSTALLER_SHA256="${RELEASE_CONTRACT[1]}"
RUNNER_ASSET="${RELEASE_CONTRACT[2]}"
RUNNER_SHA256="${RELEASE_CONTRACT[3]}"
HOST_RUNTIME_ASSET="${RELEASE_CONTRACT[4]}"
HOST_RUNTIME_SHA256="${RELEASE_CONTRACT[5]}"
CPU_RUNTIME_ASSET="${RELEASE_CONTRACT[6]}"
CPU_RUNTIME_SHA256="${RELEASE_CONTRACT[7]}"
CPU_RUNTIME_IMAGE="${RELEASE_CONTRACT[8]}"
EXPECTED_IMAGE_ID="${RELEASE_CONTRACT[9]}"
VERSION="${RELEASE_CONTRACT[10]}"
SOURCE_REVISION="${RELEASE_CONTRACT[11]}"

verify_asset() {
  local asset="$1"
  local sha256="$2"
  [[ "$asset" == "$(basename "$asset")" && "$asset" != .* ]] || { echo "unsafe release asset name" >&2; exit 1; }
  [[ "$sha256" =~ ^[a-f0-9]{64}$ ]] || { echo "invalid release asset digest" >&2; exit 1; }
  [[ -s "$RELEASE_DIRECTORY/$asset" ]] || { echo "release asset is missing: $asset" >&2; exit 1; }
  printf '%s  %s\n' "$sha256" "$RELEASE_DIRECTORY/$asset" | sha256sum --check --strict
}

verify_asset "$INSTALLER_ASSET" "$INSTALLER_SHA256"
verify_asset "$RUNNER_ASSET" "$RUNNER_SHA256"
verify_asset "$HOST_RUNTIME_ASSET" "$HOST_RUNTIME_SHA256"
verify_asset "$CPU_RUNTIME_ASSET" "$CPU_RUNTIME_SHA256"

[[ "$(tar -tzf "$RELEASE_DIRECTORY/$INSTALLER_ASSET")" == "install-runner.sh" ]] \
  || { echo "installer package layout is invalid" >&2; exit 1; }
gzip -t "$RELEASE_DIRECTORY/$CPU_RUNTIME_ASSET"
docker info >/dev/null
docker load -i "$RELEASE_DIRECTORY/$CPU_RUNTIME_ASSET" >/dev/null
ACTUAL_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$CPU_RUNTIME_IMAGE")"
[[ "$ACTUAL_IMAGE_ID" == "$EXPECTED_IMAGE_ID" ]] || { echo "loaded runtime image identity does not match the manifest" >&2; exit 1; }
docker run --rm "$CPU_RUNTIME_IMAGE" python -c 'import torch; print(torch.ones(1))' >/dev/null

printf 'verified_training_environment_version=%s\n' "$VERSION"
printf 'verified_source_revision=%s\n' "$SOURCE_REVISION"
printf 'verified_image_id=%s\n' "$ACTUAL_IMAGE_ID"
