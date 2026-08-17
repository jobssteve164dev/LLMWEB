#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_URL=""
REGISTRATION_CODE=""
SOURCE_REF="main"
REPOSITORY="jobssteve164dev/LLMWEB"
INSTALL_ROOT="${LLMWEB_INSTALL_ROOT:-/opt/llmweb}"
STATE_ROOT="${LLMWEB_STATE_ROOT:-/var/lib/llmweb/state}"
RUNTIME_IMAGE="llmweb/runtime:0.1.0"
CURRENT_FAILURE_CODE=""
FAILURE_MARKER_EMITTED=0
INSTALL_FAILURE_CODE_FILE=""

emit_install_failure_marker() {
  local failure_code="${1:-install_failed}"
  [[ "$failure_code" =~ ^[a-z][a-z0-9_]*$ ]] || failure_code="install_failed"
  CURRENT_FAILURE_CODE="$failure_code"
  FAILURE_MARKER_EMITTED=1
  printf 'GITOPS_LLMWEB_INSTALL_FAILURE_CODE=%s\n' "$failure_code" >&2
  if [[ -n "$INSTALL_FAILURE_CODE_FILE" && -d "$STATE_ROOT" ]]; then
    printf '%s\n' "$failure_code" > "$INSTALL_FAILURE_CODE_FILE"
  fi
}

say() {
  printf '\n[LLMWEB] %s\n' "$1"
}

fail() {
  local failure_code="${2:-${CURRENT_INSTALL_STAGE:-install}_failed}"
  emit_install_failure_marker "$failure_code"
  printf '\n[LLMWEB] 安装未完成：%s\n' "$1" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      [[ $# -ge 2 ]] || fail "--url 缺少地址"
      CONTROL_URL="$2"
      shift 2
      ;;
    --code)
      [[ $# -ge 2 ]] || fail "--code 缺少注册码"
      REGISTRATION_CODE="$2"
      shift 2
      ;;
    --source-ref)
      [[ $# -ge 2 ]] || fail "--source-ref 缺少版本"
      SOURCE_REF="$2"
      shift 2
      ;;
    *)
      fail "无法识别参数 $1"
      ;;
  esac
done

[[ -n "$CONTROL_URL" ]] || fail "缺少控制面地址"
[[ -n "$REGISTRATION_CODE" ]] || fail "缺少注册码"
[[ "$(id -u)" -eq 0 ]] || fail "请使用网页生成的完整命令运行，安装需要 sudo 权限"

install_apple_silicon() {
  [[ "$(uname -m)" == "arm64" ]] || fail "macOS Runner 需要 Apple Silicon（M1、M2、M3、M4 或更新芯片）"
  command -v curl >/dev/null 2>&1 || fail "缺少 curl，无法下载安装文件"
  command -v tar >/dev/null 2>&1 || fail "缺少 tar，无法解压安装文件"
  command -v git >/dev/null 2>&1 || fail "缺少 Xcode 命令行工具，请先运行 xcode-select --install"

  TARGET_USER="${SUDO_USER:-$(stat -f '%Su' /dev/console)}"
  [[ -n "$TARGET_USER" && "$TARGET_USER" != "root" ]] || fail "没有识别到当前登录的 macOS 用户"
  TARGET_UID="$(id -u "$TARGET_USER")"
  TARGET_HOME="$(dscl . -read "/Users/$TARGET_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
  [[ -n "$TARGET_HOME" ]] || fail "没有识别到当前用户主目录"

  INSTALL_ROOT="/Library/Application Support/LLMWEB"
  STATE_ROOT="$TARGET_HOME/Library/Application Support/LLMWEB/state"
  RUNTIME_ROOT="$INSTALL_ROOT/runtime-mps"
  SOURCE_ROOT="$INSTALL_ROOT/source"
  GO_ROOT="$INSTALL_ROOT/toolchains/go1.25.12"
  MINIFORGE_ROOT="$INSTALL_ROOT/miniforge"
  LLAMA_FACTORY_ROOT="$INSTALL_ROOT/LlamaFactory-95ac3f2"
  LLAMA_CPP_ROOT="$RUNTIME_ROOT/llama.cpp"
  DATA_ROOT="$TARGET_HOME/llmweb/data"
  OUTPUT_ROOT="$TARGET_HOME/llmweb/output"

  mkdir -p "$INSTALL_ROOT/bin" "$SOURCE_ROOT" "$STATE_ROOT" "$DATA_ROOT" "$OUTPUT_ROOT" "$INSTALL_ROOT/toolchains"
  chown -R "$TARGET_USER":staff "$STATE_ROOT" "$DATA_ROOT" "$OUTPUT_ROOT"

  say "正在下载 Apple Silicon 连接程序"
  curl -fL "https://github.com/${REPOSITORY}/archive/${SOURCE_REF}.tar.gz" -o "$INSTALL_ROOT/source.tar.gz.download"
  mv "$INSTALL_ROOT/source.tar.gz.download" "$INSTALL_ROOT/source.tar.gz"
  tar -xzf "$INSTALL_ROOT/source.tar.gz" --strip-components=1 -C "$SOURCE_ROOT"

  if [[ ! -x "$GO_ROOT/bin/go" ]]; then
    mkdir -p "$GO_ROOT"
    curl -fL "https://go.dev/dl/go1.25.12.darwin-arm64.tar.gz" -o "$INSTALL_ROOT/go1.25.12.darwin-arm64.tar.gz"
    tar -xzf "$INSTALL_ROOT/go1.25.12.darwin-arm64.tar.gz" --strip-components=1 -C "$GO_ROOT"
  fi
  "$GO_ROOT/bin/go" -C "$SOURCE_ROOT/runner" build -trimpath -ldflags="-s -w" -o "$INSTALL_ROOT/bin/llmweb-runner" ./cmd/runner
  chmod 0755 "$INSTALL_ROOT/bin/llmweb-runner"

  if [[ ! -x "$MINIFORGE_ROOT/bin/conda" ]]; then
    say "正在安装隔离的 Python 运行环境"
    curl -fL "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-MacOSX-arm64.sh" -o "$INSTALL_ROOT/miniforge-installer.sh"
    bash "$INSTALL_ROOT/miniforge-installer.sh" -b -p "$MINIFORGE_ROOT"
  fi
  if [[ ! -x "$RUNTIME_ROOT/bin/python" ]]; then
    "$MINIFORGE_ROOT/bin/conda" create --yes --prefix "$RUNTIME_ROOT" python=3.11 pip
  fi

  if [[ ! -d "$LLAMA_FACTORY_ROOT/.git" ]]; then
    git clone --filter=blob:none https://github.com/hiyouga/LlamaFactory.git "$LLAMA_FACTORY_ROOT"
  fi
  git -C "$LLAMA_FACTORY_ROOT" fetch --depth=1 origin 95ac3f2373b82662c1bd855c284d3379e6a763d3
  git -C "$LLAMA_FACTORY_ROOT" checkout 95ac3f2373b82662c1bd855c284d3379e6a763d3

  say "正在安装 Metal/MPS 训练环境，这一步可能需要几分钟"
  "$RUNTIME_ROOT/bin/python" -m pip install --upgrade pip packaging wheel setuptools editables "hatchling>=1.18.0"
  "$RUNTIME_ROOT/bin/python" -m pip install torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0
  "$RUNTIME_ROOT/bin/python" -m pip install --no-build-isolation -e "$LLAMA_FACTORY_ROOT[metrics]"
  "$RUNTIME_ROOT/bin/python" -m pip install -r "$SOURCE_ROOT/runtime/requirements.txt"

  if [[ ! -d "$LLAMA_CPP_ROOT/.git" ]]; then
    git clone --filter=blob:none https://github.com/ggerganov/llama.cpp.git "$LLAMA_CPP_ROOT"
  fi
  git -C "$LLAMA_CPP_ROOT" fetch --depth=1 origin 4ed2b13f758ea467282cf0b0e1a938fca7f51211
  git -C "$LLAMA_CPP_ROOT" checkout 4ed2b13f758ea467282cf0b0e1a938fca7f51211
  "$RUNTIME_ROOT/bin/python" -m pip install -r "$LLAMA_CPP_ROOT/requirements/requirements-convert_hf_to_gguf.txt"
  mkdir -p "$RUNTIME_ROOT/llmweb"
  install -m 0644 "$SOURCE_ROOT/runtime/evaluate.py" "$RUNTIME_ROOT/llmweb/evaluate.py"
  install -m 0644 "$SOURCE_ROOT/runtime/chat.py" "$RUNTIME_ROOT/llmweb/chat.py"
  install -m 0644 "$SOURCE_ROOT/runtime/prepare_dataset.py" "$RUNTIME_ROOT/llmweb/prepare_dataset.py"
  install -m 0644 "$SOURCE_ROOT/runtime/upload_artifacts.py" "$RUNTIME_ROOT/llmweb/upload_artifacts.py"

  LLMWEB_RUNTIME_ROOT="$RUNTIME_ROOT" "$RUNTIME_ROOT/bin/python" -c 'import torch; assert torch.backends.mps.is_available(); print(torch.ones(1, device="mps"))' >/dev/null \
    || fail "Metal/MPS 无法使用；M1 Max 需要受支持的 macOS 版本和可用的 PyTorch MPS 后端"

  say "正在注册这台 Apple Silicon Mac"
  sudo -u "$TARGET_USER" env LLMWEB_RUNTIME_ROOT="$RUNTIME_ROOT" "$INSTALL_ROOT/bin/llmweb-runner" register \
    --url "$CONTROL_URL" \
    --code "$REGISTRATION_CODE" \
    --data-root "$DATA_ROOT" \
    --output-root "$OUTPUT_ROOT" \
    --state-dir "$STATE_ROOT"

  PLIST="$TARGET_HOME/Library/LaunchAgents/ai.szlk.llmweb.runner.plist"
  mkdir -p "$TARGET_HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.szlk.llmweb.runner</string>
  <key>ProgramArguments</key><array><string>$INSTALL_ROOT/bin/llmweb-runner</string><string>connect</string><string>--state-dir</string><string>$STATE_ROOT</string></array>
  <key>EnvironmentVariables</key><dict><key>LLMWEB_RUNTIME_ROOT</key><string>$RUNTIME_ROOT</string><key>PYTORCH_ENABLE_MPS_FALLBACK</key><string>1</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$STATE_ROOT/runner.log</string>
  <key>StandardErrorPath</key><string>$STATE_ROOT/runner-error.log</string>
</dict></plist>
EOF
  chown "$TARGET_USER":staff "$PLIST"
  launchctl bootout "gui/$TARGET_UID/ai.szlk.llmweb.runner" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$TARGET_UID" "$PLIST"
  launchctl kickstart -k "gui/$TARGET_UID/ai.szlk.llmweb.runner"

  say "连接完成。M1 Max 将通过 Metal/MPS 运行 LoRA；数据目录：$DATA_ROOT；模型与结果目录：$OUTPUT_ROOT"
}

if [[ "$(uname -s)" == "Darwin" ]]; then
  install_apple_silicon
  exit 0
fi

[[ "$(uname -s)" == "Linux" ]] || fail "当前支持 Linux x86_64 主机和 Apple Silicon Mac"

case "$(uname -m)" in
  x86_64|amd64)
    PLATFORM="linux/amd64"
    ;;
  aarch64|arm64)
    fail "已识别 ARM64 架构，当前训练环境只支持 Linux x86_64"
    ;;
  *)
    fail "不支持的机器架构：$(uname -m)"
    ;;
esac

command -v curl >/dev/null 2>&1 || fail "缺少 curl，无法下载安装文件"
command -v tar >/dev/null 2>&1 || fail "缺少 tar，无法解压安装文件"
command -v sha256sum >/dev/null 2>&1 || fail "缺少 sha256sum，无法校验连接程序工具链"
command -v python3 >/dev/null 2>&1 || fail "缺少 Python 3，无法读取训练环境清单"
command -v openssl >/dev/null 2>&1 || fail "缺少 OpenSSL，无法验证训练环境签名"

install_cpu_release_package() {
  local manifest_url="${LLMWEB_TRAINING_ENVIRONMENT_MANIFEST_URL:-$CONTROL_URL/api/training-environment/manifest}"
  local asset_base="${LLMWEB_TRAINING_ENVIRONMENT_ASSET_BASE_URL:-$CONTROL_URL/api/training-environment/assets}"
  local work_root
  local package_root
  local manifest_path
  local package_path
  local digest_path
  local signature_path
  local public_key_path
  local pairing_code_path
  local version
  local package_asset
  local expected_digest
  local sidecar_digest

  work_root="$(mktemp -d /tmp/llmweb-model-training.XXXXXX)"
  package_root="$work_root/package"
  manifest_path="$work_root/manifest.json"
  digest_path="$work_root/package.sha256"
  signature_path="$work_root/package.sig"
  public_key_path="$work_root/release-signing-public-key.pem"
  pairing_code_path="$work_root/pairing-code"

  cleanup_cpu_release_package() {
    local path
    for path in \
      "$package_root/install-runner-package.sh" \
      "$package_root/package-manifest.json" \
      "$package_root/bin/llmweb-runner" \
      "$package_root/runtime/docker-static.tgz" \
      "$package_root/runtime/image.tar.gz" \
      "$manifest_path" "$package_path" "$digest_path" "$signature_path" \
      "$public_key_path" "$pairing_code_path"; do
      if [[ -e "$path" || -L "$path" ]]; then unlink "$path"; fi
    done
    rmdir "$package_root/bin" "$package_root/runtime" "$package_root" "$work_root" 2>/dev/null || true
  }
  trap cleanup_cpu_release_package EXIT

  say "正在读取统一训练环境"
  curl -fL --retry 3 --retry-all-errors "$manifest_url" -o "$manifest_path"
  mapfile -t release_values < <(python3 - "$manifest_path" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    manifest = json.load(handle)
if set(manifest) != {"schema_version", "version", "source_revision", "packages"}:
    raise SystemExit("invalid release manifest fields")
if manifest["schema_version"] != "2.0" or not re.fullmatch(r"\d+\.\d+\.\d+", manifest["version"]):
    raise SystemExit("invalid release identity")
if not re.fullmatch(r"[0-9a-f]{40}", manifest["source_revision"]):
    raise SystemExit("invalid source revision")
packages = manifest["packages"]
if set(packages) != {"linux-amd64-cpu", "linux-amd64-cuda", "darwin-arm64-mps"}:
    raise SystemExit("invalid release package set")
package = packages["linux-amd64-cpu"]
if package.get("status") != "available" or package.get("image") != f"llmweb/runtime-cpu:{manifest['version']}":
    raise SystemExit("CPU package is unavailable")
artifact = package.get("artifact") or {}
expected_asset = f"llmweb-model-training-linux-amd64-{manifest['version']}.tar.gz"
if artifact.get("asset") != expected_asset or not re.fullmatch(r"[0-9a-f]{64}", str(artifact.get("sha256", ""))):
    raise SystemExit("invalid CPU package identity")
print(manifest["version"])
print(artifact["asset"])
print(artifact["sha256"])
PY
  ) || fail "训练环境清单验证失败" "environment_manifest_invalid"
  [[ "${#release_values[@]}" -eq 3 ]] || fail "训练环境清单不完整" "environment_manifest_invalid"
  version="${release_values[0]}"
  package_asset="${release_values[1]}"
  expected_digest="${release_values[2]}"
  package_path="$work_root/$package_asset"

  say "正在下载统一训练环境包"
  curl -fL --retry 3 --retry-all-errors "$asset_base/$package_asset" -o "$package_path"
  curl -fL --retry 3 --retry-all-errors "$asset_base/$package_asset.sha256" -o "$digest_path"
  curl -fL --retry 3 --retry-all-errors "$asset_base/$package_asset.sig" -o "$signature_path"
  sidecar_digest="$(tr -d '\n' < "$digest_path")"
  [[ "$sidecar_digest" == "$expected_digest" && "$sidecar_digest" =~ ^[0-9a-f]{64}$ ]] \
    || fail "训练环境摘要不一致" "package_digest_mismatch"
  [[ "$(stat -c %s "$signature_path")" -eq 64 ]] \
    || fail "训练环境签名无效" "package_signature_invalid"
  printf '%s\n' "$sidecar_digest" > "$digest_path"
  cat > "$public_key_path" <<'EOF'
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0UXdF8Z4E2lswdmS2dFLQMq64EnlXDLPota9POlJrtw=
-----END PUBLIC KEY-----
EOF
  openssl pkeyutl -verify -pubin -inkey "$public_key_path" -rawin \
    -in "$digest_path" -sigfile "$signature_path" >/dev/null \
    || fail "训练环境签名验证失败" "package_signature_invalid"
  printf '%s  %s\n' "$expected_digest" "$package_path" | sha256sum -c - >/dev/null \
    || fail "训练环境包校验失败" "package_digest_mismatch"

  mkdir -p "$package_root/bin" "$package_root/runtime"
  python3 - "$package_path" "$package_root" <<'PY'
import os
import pathlib
import shutil
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
root = pathlib.Path(sys.argv[2]).resolve()
expected = {
    "install-runner-package.sh",
    "package-manifest.json",
    "bin/llmweb-runner",
    "runtime/docker-static.tgz",
    "runtime/image.tar.gz",
}
with tarfile.open(archive, "r:gz") as handle:
    members = []
    seen = set()
    for member in handle.getmembers():
        name = member.name.lstrip("./")
        if not name or member.isdir():
            continue
        if name in seen or name not in expected or not member.isfile() or member.issym() or member.islnk():
            raise SystemExit("unsafe package member")
        seen.add(name)
        members.append((member, name))
    if seen != expected:
        raise SystemExit("package member set is not exact")
    for member, name in members:
        target = (root / name).resolve()
        if root not in target.parents:
            raise SystemExit("package path escapes extraction root")
        source = handle.extractfile(member)
        if source is None:
            raise SystemExit("package member cannot be read")
        with target.open("wb") as output:
            shutil.copyfileobj(source, output)
        os.chmod(target, 0o755 if name in {"install-runner-package.sh", "bin/llmweb-runner"} else 0o644)
PY
  umask 077
  printf '%s\n' "$REGISTRATION_CODE" > "$pairing_code_path"
  bash "$package_root/install-runner-package.sh" \
    --url "$CONTROL_URL" \
    --code-file "$pairing_code_path"
  cleanup_cpu_release_package
  trap - EXIT
  say "连接完成。已启用普通电脑训练环境。"
}

if ! command -v nvidia-smi >/dev/null 2>&1 || ! nvidia-smi >/dev/null 2>&1; then
  install_cpu_release_package
  exit 0
fi

mkdir -p "$INSTALL_ROOT/bin" "$INSTALL_ROOT/source" "$STATE_ROOT"
UPGRADE_EXISTING=0
if [[ -s "$STATE_ROOT/state.json" ]] && python3 - "$STATE_ROOT/state.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    state = json.load(handle)
raise SystemExit(0 if state.get("device_token") else 1)
PY
then
  EXISTING_DEVICE_TOKEN="$(python3 - "$STATE_ROOT/state.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["device_token"])
PY
)"
  UPGRADE_PAYLOAD="$(python3 - "$REGISTRATION_CODE" <<'PY'
import json
import sys
print(json.dumps({"code": sys.argv[1]}))
PY
)"
  if ! curl -fsS -H "Authorization: Bearer $EXISTING_DEVICE_TOKEN" -H "Content-Type: application/json" \
    --data "$UPGRADE_PAYLOAD" "$CONTROL_URL/v1/runners/upgrade-authorization" >/dev/null; then
    fail "这台电脑已经连接到另一个训练工作区，请回到原工作区生成连接命令；如需转移，请先正式解除原连接"
  fi
  UPGRADE_EXISTING=1
fi
INSTALL_STAGE_FILE="$STATE_ROOT/install-stage"
INSTALL_FAILURE_CODE_FILE="$STATE_ROOT/install-failure-code"
CURRENT_INSTALL_STAGE="base_runtime"
record_install_stage() {
  CURRENT_INSTALL_STAGE="$1"
  printf '%s\n' "$CURRENT_INSTALL_STAGE" > "$INSTALL_STAGE_FILE"
}
on_install_exit() {
  local exit_code="$1"
  if [[ "$exit_code" -ne 0 ]]; then
    if [[ "$FAILURE_MARKER_EMITTED" -ne 1 ]]; then
      emit_install_failure_marker "${CURRENT_FAILURE_CODE:-${CURRENT_INSTALL_STAGE}_failed}"
    fi
    printf 'failed:%s\n' "$CURRENT_INSTALL_STAGE" > "$INSTALL_STAGE_FILE"
  fi
}
printf 'none\n' > "$INSTALL_FAILURE_CODE_FILE"
trap 'on_install_exit $?' EXIT
record_install_stage "base_runtime"

start_docker() {
  if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
    systemctl enable --now docker
  elif command -v service >/dev/null 2>&1; then
    service docker start
  fi
  docker info >/dev/null 2>&1 || fail "Docker 服务未能启动"
}

if ! command -v docker >/dev/null 2>&1; then
  say "正在安装容器运行环境"
  curl -fsSL https://get.docker.com -o "$INSTALL_ROOT/get-docker.sh"
  sh "$INSTALL_ROOT/get-docker.sh"
fi
start_docker

say "正在下载与 ${PLATFORM} 匹配的连接程序"
record_install_stage "source_download"
SOURCE_ARCHIVE_URL="${LLMWEB_SOURCE_ARCHIVE_URL:-https://github.com/${REPOSITORY}/archive/${SOURCE_REF}.tar.gz}"
curl -fL --retry 3 --retry-all-errors \
  "$SOURCE_ARCHIVE_URL" \
  -o "$INSTALL_ROOT/source.tar.gz.download"
mv "$INSTALL_ROOT/source.tar.gz.download" "$INSTALL_ROOT/source.tar.gz"
tar -xzf "$INSTALL_ROOT/source.tar.gz" --strip-components=1 -C "$INSTALL_ROOT/source"

RUNNER_BINARY_URL="${LLMWEB_RUNNER_BINARY_URL:-https://github.com/${REPOSITORY}/releases/download/llmweb-runner-bec5876f/llmweb-runner-linux-amd64}"
RUNNER_BINARY_SHA256="5b647a97c9403d443c58415c56e5d3b8217fb0cd28a8ec0d0d6e231353fbb76b"
say "正在下载已校验的连接程序"
record_install_stage "runner_download"
curl -fL --retry 3 --retry-all-errors "$RUNNER_BINARY_URL" \
  -o "$INSTALL_ROOT/bin/llmweb-runner.download"
printf '%s  %s\n' "$RUNNER_BINARY_SHA256" "$INSTALL_ROOT/bin/llmweb-runner.download" | sha256sum -c -
mv "$INSTALL_ROOT/bin/llmweb-runner.download" "$INSTALL_ROOT/bin/llmweb-runner"
chmod 0755 "$INSTALL_ROOT/bin/llmweb-runner"

TARGET_USER="${SUDO_USER:-root}"
TARGET_HOME="$(getent passwd "$TARGET_USER" 2>/dev/null | cut -d: -f6 || true)"
[[ -n "$TARGET_HOME" ]] || TARGET_HOME="/root"
DATA_ROOT="$TARGET_HOME/llmweb/data"
OUTPUT_ROOT="$TARGET_HOME/llmweb/output"
mkdir -p "$DATA_ROOT" "$OUTPUT_ROOT"
if [[ "$TARGET_USER" != "root" ]]; then
  chown "$TARGET_USER":"$TARGET_USER" "$DATA_ROOT" "$OUTPUT_ROOT"
fi

install_nvidia_toolkit() {
  say "正在安装 NVIDIA 容器运行环境"
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install --yes ca-certificates curl gnupg
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
      | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
      > /etc/apt/sources.list.d/nvidia-container-toolkit.list
    apt-get update
    apt-get install --yes nvidia-container-toolkit
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo \
      > /etc/yum.repos.d/nvidia-container-toolkit.repo
    dnf install --assumeyes nvidia-container-toolkit
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo \
      > /etc/yum.repos.d/nvidia-container-toolkit.repo
    yum install --assumeyes nvidia-container-toolkit
  else
    fail "无法自动安装 NVIDIA 容器运行环境：当前系统没有 apt、dnf 或 yum"
  fi
  nvidia-ctk runtime configure --runtime=docker
  if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
    systemctl restart docker
  elif command -v service >/dev/null 2>&1; then
    service docker restart
  fi
  docker info >/dev/null 2>&1 || fail "安装 NVIDIA 容器运行环境后 Docker 未能启动"
}

say "正在安装受控训练环境，这一步可能需要几分钟"
record_install_stage "runtime_image"
if ! docker info --format '{{json .Runtimes}}' | grep -q 'nvidia'; then
  install_nvidia_toolkit
fi
docker build --platform "$PLATFORM" -t "$RUNTIME_IMAGE" -f "$INSTALL_ROOT/source/runtime/Dockerfile" "$INSTALL_ROOT/source"
docker run --rm --gpus all "$RUNTIME_IMAGE" nvidia-smi >/dev/null \
  || fail "训练环境无法使用 NVIDIA GPU，请检查驱动与 NVIDIA Container Toolkit"

if [[ "$UPGRADE_EXISTING" -eq 0 ]]; then
  say "正在注册这台训练主机"
  record_install_stage "runner_register"
  LLMWEB_TRAINING_ENVIRONMENT_VERSION="${TRAINING_ENVIRONMENT_VERSION:-legacy-0.1.0}" \
    "$INSTALL_ROOT/bin/llmweb-runner" register \
      --url "$CONTROL_URL" \
      --code "$REGISTRATION_CODE" \
      --data-root "$DATA_ROOT" \
      --output-root "$OUTPUT_ROOT" \
      --state-dir "$STATE_ROOT"
else
  say "已确认原工作区，正在升级训练环境"
fi

command -v systemctl >/dev/null 2>&1 || fail "当前系统不支持 systemd，无法安装后台连接服务"
[[ -d /run/systemd/system ]] || fail "systemd 当前未运行，无法安装后台连接服务"

say "正在启动后台连接服务"
record_install_stage "service_install"
SYSTEMD_UNIT_PATH="${LLMWEB_SYSTEMD_UNIT_PATH:-/etc/systemd/system/llmweb-runner.service}"
cat > "$SYSTEMD_UNIT_PATH" <<EOF
[Unit]
Description=LLMWEB Training Runner
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
Environment=LLMWEB_TRAINING_ENVIRONMENT_VERSION=${TRAINING_ENVIRONMENT_VERSION:-legacy-0.1.0}
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
systemctl is-active --quiet llmweb-runner || fail "后台连接服务未能启动，请运行 systemctl status llmweb-runner 查看原因"
record_install_stage "ready"
trap - EXIT

say "连接完成。已启用 GPU 训练；数据目录：$DATA_ROOT；模型与结果目录：$OUTPUT_ROOT"
