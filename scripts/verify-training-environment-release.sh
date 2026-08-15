#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_DIRECTORY="${1:-}"
[[ -d "$RELEASE_DIRECTORY" ]] || { echo "release directory is required" >&2; exit 2; }
MANIFEST="$RELEASE_DIRECTORY/manifest.json"
[[ -s "$MANIFEST" ]] || { echo "manifest.json is missing" >&2; exit 1; }

RELEASE_CONTRACT_OUTPUT="$(python3 - "$MANIFEST" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    manifest = json.load(handle)
if manifest.get("schema_version") != "2.0":
    raise SystemExit("unsupported release manifest")
cpu = manifest["packages"]["linux-amd64-cpu"]
if cpu.get("status") != "available":
    raise SystemExit("CPU package is unavailable")
for field in (
    cpu["artifact"]["asset"],
    cpu["artifact"]["sha256"],
    cpu["image"],
    manifest["version"],
    manifest["source_revision"],
):
    print(field)
PY
)" || { echo "release manifest contract is invalid" >&2; exit 1; }
mapfile -t RELEASE_CONTRACT <<< "$RELEASE_CONTRACT_OUTPUT"
[[ "${#RELEASE_CONTRACT[@]}" -eq 5 ]] || { echo "release manifest contract is incomplete" >&2; exit 1; }
PACKAGE_ASSET="${RELEASE_CONTRACT[0]}"
PACKAGE_SHA256="${RELEASE_CONTRACT[1]}"
CPU_RUNTIME_IMAGE="${RELEASE_CONTRACT[2]}"
VERSION="${RELEASE_CONTRACT[3]}"
SOURCE_REVISION="${RELEASE_CONTRACT[4]}"

[[ "$PACKAGE_ASSET" == "$(basename "$PACKAGE_ASSET")" && "$PACKAGE_ASSET" != .* ]] \
  || { echo "unsafe package asset name" >&2; exit 1; }
[[ "$PACKAGE_SHA256" =~ ^[a-f0-9]{64}$ ]] || { echo "invalid package digest" >&2; exit 1; }
PACKAGE_PATH="$RELEASE_DIRECTORY/$PACKAGE_ASSET"
[[ -s "$PACKAGE_PATH" ]] || { echo "package asset is missing" >&2; exit 1; }
printf '%s  %s\n' "$PACKAGE_SHA256" "$PACKAGE_PATH" | sha256sum --check --strict

python3 - "$PACKAGE_PATH" "$VERSION" "$SOURCE_REVISION" "$CPU_RUNTIME_IMAGE" <<'PY'
import hashlib
import json
import pathlib
import sys
import tarfile

package_path = pathlib.Path(sys.argv[1])
expected_version, expected_revision, expected_image = sys.argv[2:]
required = {
    "install-runner-package.sh",
    "package-manifest.json",
    "bin/llmweb-runner",
    "runtime/docker-static.tgz",
    "runtime/image.tar.gz",
}
with tarfile.open(package_path, "r:gz") as package:
    members = package.getmembers()
    names = {member.name.lstrip("./") for member in members if member.isfile()}
    if names != required or any(member.issym() or member.islnk() for member in members):
        raise SystemExit("package member set is invalid")
    by_name = {member.name.lstrip("./"): member for member in members}
    manifest = json.load(package.extractfile(by_name["package-manifest.json"]))
    if manifest.get("schema_version") != "1.0":
        raise SystemExit("package manifest schema is invalid")
    if manifest.get("version") != expected_version or manifest.get("source_revision") != expected_revision:
        raise SystemExit("package identity does not match release manifest")
    if manifest.get("platform") != "linux/amd64" or manifest.get("image") != expected_image:
        raise SystemExit("package runtime identity does not match release manifest")
    expected_files = required - {"package-manifest.json"}
    if set(manifest.get("files") or {}) != expected_files:
        raise SystemExit("package content map is not exact")
    for name, digest in manifest["files"].items():
        content = package.extractfile(by_name[name]).read()
        if hashlib.sha256(content).hexdigest() != digest:
            raise SystemExit(f"package member digest mismatch: {name}")
PY

RUNTIME_ARCHIVE="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/llmweb-runtime.XXXXXX.tar.gz")"
RUNNER_BINARY="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/llmweb-runner.XXXXXX")"
trap 'rm -f "$RUNTIME_ARCHIVE" "$RUNNER_BINARY"' EXIT
tar -xOzf "$PACKAGE_PATH" runtime/image.tar.gz > "$RUNTIME_ARCHIVE"
tar -xOzf "$PACKAGE_PATH" bin/llmweb-runner > "$RUNNER_BINARY"
chmod 0755 "$RUNNER_BINARY"
"$RUNNER_BINARY" version >/dev/null

python3 - "$RUNTIME_ARCHIVE" "$CPU_RUNTIME_IMAGE" <<'PY'
import json
import sys
import tarfile

with tarfile.open(sys.argv[1], "r:gz") as archive:
    members = archive.getmembers()
    regular = {member.name.lstrip("./") for member in members if member.isfile()}
    if "manifest.json" not in regular or "repositories" not in regular:
        raise SystemExit("Docker archive metadata is incomplete")
    if not any(name.endswith("/layer.tar") for name in regular):
        raise SystemExit("Docker archive has no regular legacy layer")
    if any(member.issym() or member.islnk() for member in members):
        raise SystemExit("Docker archive contains links")
    manifest_member = next(member for member in members if member.name.lstrip("./") == "manifest.json")
    manifest = json.load(archive.extractfile(manifest_member))
    tags = {tag for entry in manifest for tag in entry.get("RepoTags") or []}
    if sys.argv[2] not in tags:
        raise SystemExit("Docker archive is missing the fixed image reference")
PY

docker info >/dev/null
docker load --input "$RUNTIME_ARCHIVE" >/dev/null
ACTUAL_PLATFORM="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$CPU_RUNTIME_IMAGE")"
[[ "$ACTUAL_PLATFORM" == "linux/amd64" ]] || { echo "loaded runtime platform does not match linux/amd64" >&2; exit 1; }
docker run --rm "$CPU_RUNTIME_IMAGE" python -c 'import torch; print(torch.ones(1))' >/dev/null

printf 'verified_training_environment_version=%s\n' "$VERSION"
printf 'verified_source_revision=%s\n' "$SOURCE_REVISION"
printf 'verified_package_sha256=%s\n' "$PACKAGE_SHA256"
printf 'verified_runtime_platform=%s\n' "$ACTUAL_PLATFORM"
