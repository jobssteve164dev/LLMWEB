#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_URL=""
PAIRING_CODE_FILE=""
PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PACKAGE_MANIFEST="$PACKAGE_ROOT/package-manifest.json"
INSTALL_ROOT="${LLMWEB_INSTALL_ROOT:-/opt/llmweb}"
STATE_ROOT="${LLMWEB_STATE_ROOT:-/var/lib/llmweb/state}"
SYSTEMD_UNIT_PATH="${LLMWEB_SYSTEMD_UNIT_PATH:-/etc/systemd/system/llmweb-runner.service}"
SYSTEMD_RUNTIME_DIRECTORY="${LLMWEB_SYSTEMD_RUNTIME_DIRECTORY:-/run/systemd/system}"
CURRENT_STAGE="package_verify"
FAILURE_MARKER_EMITTED=0

emit_failure() {
  local code="${1:-install_failed}"
  [[ "$code" =~ ^[a-z][a-z0-9_]*$ ]] || code="install_failed"
  FAILURE_MARKER_EMITTED=1
  printf 'GITOPS_LLMWEB_INSTALL_FAILURE_CODE=%s\n' "$code" >&2
  if [[ -d "$STATE_ROOT" ]]; then
    printf '%s\n' "$code" > "$STATE_ROOT/install-failure-code"
    printf 'failed:%s\n' "$CURRENT_STAGE" > "$STATE_ROOT/install-stage"
  fi
}

fail() {
  local message="$1"
  local code="${2:-${CURRENT_STAGE}_failed}"
  emit_failure "$code"
  printf '[LLMWEB] 安装未完成：%s\n' "$message" >&2
  exit 1
}

classify_runtime_self_test_failure() {
  local output="${1,,}"
  case "$output" in
    *"illegal instruction"*|*"sigill"*) printf 'runtime_cpu_incompatible\n' ;;
    *"exec format error"*|*"no matching manifest"*|*"platform does not match"*) printf 'runtime_architecture_incompatible\n' ;;
    *"cannot allocate memory"*|*"out of memory"*|*"signal: killed"*) printf 'runtime_out_of_memory\n' ;;
    *"no space left on device"*) printf 'storage_full\n' ;;
    *"cannot connect to the docker daemon"*|*"docker daemon is not running"*) printf 'docker_unavailable\n' ;;
    *"modulenotfounderror"*|*"importerror"*) printf 'runtime_dependency_missing\n' ;;
    *"permission denied"*|*"operation not permitted"*) printf 'permission_denied\n' ;;
    *) printf 'runtime_self_test_failed\n' ;;
  esac
}

RUNTIME_SELF_TEST_FAILURE_CODE=""
run_cpu_runtime_self_test() {
  local output=""
  if docker run --rm "$CPU_RUNTIME_IMAGE" python -c 'import torch; print(torch.ones(1))' > /dev/null 2>"$STATE_ROOT/runtime-self-test.stderr"; then
    RUNTIME_SELF_TEST_FAILURE_CODE=""
    unlink "$STATE_ROOT/runtime-self-test.stderr"
    return 0
  fi
  output="$(tail -c 16384 "$STATE_ROOT/runtime-self-test.stderr" 2>/dev/null || true)"
  unlink "$STATE_ROOT/runtime-self-test.stderr" 2>/dev/null || true
  RUNTIME_SELF_TEST_FAILURE_CODE="$(classify_runtime_self_test_failure "$output")"
  printf '[LLMWEB] 训练环境自检输出（末尾最多 16384 字符）：\n%s\n' "$output" >&2
  return 1
}

record_stage() {
  CURRENT_STAGE="$1"
  if [[ -d "$STATE_ROOT" ]]; then
    printf '%s\n' "$CURRENT_STAGE" > "$STATE_ROOT/install-stage"
  fi
}

on_exit() {
  local status="$1"
  if [[ "$status" -ne 0 && "$FAILURE_MARKER_EMITTED" -ne 1 ]]; then
    emit_failure "${CURRENT_STAGE}_failed"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      [[ $# -ge 2 ]] || fail "--url 缺少地址" "invalid_request"
      CONTROL_URL="$2"
      shift 2
      ;;
    --code-file)
      [[ $# -ge 2 ]] || fail "--code-file 缺少路径" "invalid_request"
      PAIRING_CODE_FILE="$2"
      shift 2
      ;;
    *)
      fail "无法识别参数 $1" "invalid_request"
      ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || fail "安装需要 root 权限" "permission_denied"
[[ "$(uname -s)" == "Linux" ]] || fail "当前包只支持 Linux" "runtime_platform_incompatible"
case "$(uname -m)" in
  x86_64|amd64) ;;
  *) fail "当前包只支持 Linux x86_64" "runtime_architecture_incompatible" ;;
esac
[[ "$CONTROL_URL" =~ ^https://[^/]+/?$ ]] || fail "控制面地址无效" "invalid_request"
CONTROL_URL="${CONTROL_URL%/}"
[[ -n "$PAIRING_CODE_FILE" ]] || fail "缺少配对码文件" "invalid_request"
[[ -s "$PAIRING_CODE_FILE" && ! -L "$PAIRING_CODE_FILE" ]] || fail "配对码文件无效" "invalid_request"
[[ -s "$PACKAGE_MANIFEST" ]] || fail "训练包内容清单缺失" "package_manifest_missing"
command -v python3 >/dev/null 2>&1 || fail "缺少 Python 3，无法验证训练包" "package_verifier_missing"
command -v sha256sum >/dev/null 2>&1 || fail "缺少 SHA256 校验工具" "package_verifier_missing"
command -v tar >/dev/null 2>&1 || fail "缺少归档工具" "package_verifier_missing"
command -v systemctl >/dev/null 2>&1 || fail "当前系统不支持 systemd" "systemd_unavailable"
[[ -d "$SYSTEMD_RUNTIME_DIRECTORY" ]] || fail "systemd 当前未运行" "systemd_unavailable"

trap 'on_exit $?' EXIT
mkdir -p "$STATE_ROOT"
chmod 0700 "$STATE_ROOT"
printf 'none\n' > "$STATE_ROOT/install-failure-code"
record_stage "package_verify"

PACKAGE_VALUES_OUTPUT="$(python3 - "$PACKAGE_ROOT" "$PACKAGE_MANIFEST" <<'PY'
import hashlib
import json
import os
import pathlib
import sys
import tarfile

root = pathlib.Path(sys.argv[1]).resolve()
manifest_path = pathlib.Path(sys.argv[2]).resolve()
with manifest_path.open(encoding="utf-8") as handle:
    manifest = json.load(handle)

expected_top = {"schema_version", "version", "source_revision", "platform", "image", "minimum", "files"}
if set(manifest) != expected_top or manifest["schema_version"] != "1.0" or manifest["platform"] != "linux/amd64":
    raise SystemExit("invalid package manifest contract")
if not isinstance(manifest["files"], dict):
    raise SystemExit("invalid package file map")
required_files = {
    "install-runner-package.sh",
    "bin/llmweb-runner",
    "runtime/docker-static.tgz",
    "runtime/image.tar.gz",
}
if set(manifest["files"]) != required_files:
    raise SystemExit("package file map is not exact")
actual_files = {
    str(path.relative_to(root))
    for path in root.rglob("*")
    if path.is_file()
}
if actual_files != required_files | {"package-manifest.json"}:
    raise SystemExit("package member set is not exact")
for relative, expected in manifest["files"].items():
    path = (root / relative).resolve()
    if root not in path.parents or not path.is_file() or path.is_symlink():
        raise SystemExit(f"unsafe package member: {relative}")
    if not isinstance(expected, str) or len(expected) != 64:
        raise SystemExit(f"invalid digest: {relative}")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected:
        raise SystemExit(f"digest mismatch: {relative}")

archive = root / "runtime/image.tar.gz"
with tarfile.open(archive, "r:gz") as handle:
    members = handle.getmembers()
    names = {member.name.lstrip("./") for member in members if member.isfile()}
    if "manifest.json" not in names or "repositories" not in names:
        raise SystemExit("Docker archive metadata is incomplete")
    if not any(name.endswith("/layer.tar") for name in names):
        raise SystemExit("Docker archive has no regular legacy layer")
    if any(member.issym() or member.islnk() for member in members):
        raise SystemExit("Docker archive must not contain links")
    manifest_member = next(member for member in members if member.name.lstrip("./") == "manifest.json")
    image_manifest = json.load(handle.extractfile(manifest_member))
    tags = {tag for item in image_manifest for tag in item.get("RepoTags") or []}
    if manifest["image"] not in tags:
        raise SystemExit("Docker archive is missing the fixed image reference")

minimum = manifest["minimum"]
for key in ("cpu_cores", "memory_mb", "disk_free_mb"):
    if not isinstance(minimum.get(key), int) or minimum[key] <= 0:
        raise SystemExit("invalid minimum resource contract")
print(manifest["version"])
print(manifest["image"])
print(minimum["cpu_cores"])
print(minimum["memory_mb"])
print(minimum["disk_free_mb"])
PY
)" || fail "训练包内容验证失败" "package_content_invalid"
mapfile -t PACKAGE_VALUES <<< "$PACKAGE_VALUES_OUTPUT"

[[ "${#PACKAGE_VALUES[@]}" -eq 5 ]] || fail "训练包内容清单不完整" "package_manifest_invalid"
TRAINING_ENVIRONMENT_VERSION="${PACKAGE_VALUES[0]}"
CPU_RUNTIME_IMAGE="${PACKAGE_VALUES[1]}"
MINIMUM_CPU_CORES="${PACKAGE_VALUES[2]}"
MINIMUM_MEMORY_MB="${PACKAGE_VALUES[3]}"
MINIMUM_DISK_MB="${PACKAGE_VALUES[4]}"

CURRENT_CPU_CORES="$(getconf _NPROCESSORS_ONLN)"
CURRENT_MEMORY_MB="$(awk '/MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)"
CURRENT_DISK_MB="$(df -Pm / | awk 'NR == 2 { print $4 }')"
(( CURRENT_CPU_CORES >= MINIMUM_CPU_CORES )) || fail "这台电脑至少需要 ${MINIMUM_CPU_CORES} 核处理器" "insufficient_cpu"
(( CURRENT_MEMORY_MB >= MINIMUM_MEMORY_MB )) || fail "这台电脑内存不足" "insufficient_memory"
(( CURRENT_DISK_MB >= MINIMUM_DISK_MB )) || fail "这台电脑可用磁盘不足" "insufficient_storage"

UPGRADE_EXISTING=0
if [[ -s "$STATE_ROOT/state.json" ]]; then
  record_stage "runner_upgrade_authorization"
  "$PACKAGE_ROOT/bin/llmweb-runner" authorize-upgrade \
    --url "$CONTROL_URL" \
    --code-file "$PAIRING_CODE_FILE" \
    --state-dir "$STATE_ROOT" \
    || fail "这台电脑已经连接到另一个训练工作区；如需转移，请先正式解除原连接" "runner_upgrade_unauthorized"
  UPGRADE_EXISTING=1
fi

mkdir -p "$INSTALL_ROOT/bin" "$INSTALL_ROOT/runtime"
install -m 0644 "$PACKAGE_MANIFEST" "$INSTALL_ROOT/package-manifest.json"

record_stage "host_runtime"
if ! command -v docker >/dev/null 2>&1; then
  tar -xzf "$PACKAGE_ROOT/runtime/docker-static.tgz" --strip-components=1 -C /usr/local/bin
  cat > /etc/systemd/system/docker.service <<'EOF'
[Unit]
Description=Docker Application Container Engine
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/dockerd --host=unix:///var/run/docker.sock
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
fi
systemctl enable --now docker
docker info >/dev/null 2>&1 || fail "Docker 服务未能启动" "docker_unavailable"

record_stage "runtime_load"
docker load --input "$PACKAGE_ROOT/runtime/image.tar.gz" >/dev/null \
  || fail "训练环境镜像导入失败" "runtime_load_failed"
RUNTIME_PLATFORM="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$CPU_RUNTIME_IMAGE" 2>/dev/null || true)"
[[ "$RUNTIME_PLATFORM" == "linux/amd64" ]] \
  || fail "训练环境平台校验失败" "runtime_architecture_incompatible"
run_cpu_runtime_self_test \
  || fail "训练环境没有通过功能自检" "$RUNTIME_SELF_TEST_FAILURE_CODE"

install -m 0755 "$PACKAGE_ROOT/bin/llmweb-runner" "$INSTALL_ROOT/bin/llmweb-runner"
"$INSTALL_ROOT/bin/llmweb-runner" version >/dev/null \
  || fail "Runner 二进制自检失败" "runner_self_test_failed"

TARGET_USER="${SUDO_USER:-root}"
TARGET_HOME="$(getent passwd "$TARGET_USER" 2>/dev/null | cut -d: -f6 || true)"
[[ -n "$TARGET_HOME" ]] || TARGET_HOME="/root"
DATA_ROOT="${LLMWEB_DATA_ROOT:-$TARGET_HOME/llmweb/data}"
OUTPUT_ROOT="${LLMWEB_OUTPUT_ROOT:-$TARGET_HOME/llmweb/output}"
mkdir -p "$DATA_ROOT" "$OUTPUT_ROOT"
if [[ "$TARGET_USER" != "root" ]]; then
  chown "$TARGET_USER":"$TARGET_USER" "$DATA_ROOT" "$OUTPUT_ROOT"
fi

record_stage "runner_register"
if [[ "$UPGRADE_EXISTING" -eq 0 ]]; then
  LLMWEB_TRAINING_ENVIRONMENT_VERSION="$TRAINING_ENVIRONMENT_VERSION" \
    "$INSTALL_ROOT/bin/llmweb-runner" register \
      --url "$CONTROL_URL" \
      --code-file "$PAIRING_CODE_FILE" \
      --data-root "$DATA_ROOT" \
      --output-root "$OUTPUT_ROOT" \
      --state-dir "$STATE_ROOT" \
    || fail "训练 Runner 注册失败" "runner_registration_failed"
fi

record_stage "service_install"
cat > "$SYSTEMD_UNIT_PATH" <<EOF
[Unit]
Description=LLMWEB Training Runner
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
Environment=LLMWEB_TRAINING_ENVIRONMENT_VERSION=$TRAINING_ENVIRONMENT_VERSION
ExecStart=$INSTALL_ROOT/bin/llmweb-runner connect --state-dir $STATE_ROOT
Restart=always
RestartSec=5
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable llmweb-runner
systemctl restart llmweb-runner
systemctl is-active --quiet llmweb-runner \
  || fail "训练 Runner 服务未能启动" "service_start_failed"

record_stage "ready"
printf 'GITOPS_LLMWEB_TRAINING_ENVIRONMENT_VERSION=%s\n' "$TRAINING_ENVIRONMENT_VERSION"
printf 'GITOPS_LLMWEB_RUNTIME_IMAGE=%s\n' "$CPU_RUNTIME_IMAGE"
printf 'GITOPS_LLMWEB_RUNNER_READY=true\n'
trap - EXIT
