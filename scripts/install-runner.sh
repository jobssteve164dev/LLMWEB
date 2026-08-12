#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_URL=""
REGISTRATION_CODE=""
SOURCE_REF="main"
REPOSITORY="jobssteve164dev/LLMWEB"
INSTALL_ROOT="${LLMWEB_INSTALL_ROOT:-/opt/llmweb}"
STATE_ROOT="${LLMWEB_STATE_ROOT:-/var/lib/llmweb/state}"
RUNTIME_IMAGE="llmweb/runtime:0.1.0"
CPU_RUNTIME_IMAGE="llmweb/runtime-cpu:0.1.0"

say() {
  printf '\n[LLMWEB] %s\n' "$1"
}

fail() {
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
mkdir -p "$INSTALL_ROOT/bin" "$INSTALL_ROOT/source" "$STATE_ROOT"
if [[ -s "$STATE_ROOT/state.json" ]] && python3 - "$STATE_ROOT/state.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    state = json.load(handle)
raise SystemExit(0 if state.get("device_token") else 1)
PY
then
  fail "这台电脑已经连接到另一个训练工作区，请先在原工作区完成正式解除连接"
fi
INSTALL_STAGE_FILE="$STATE_ROOT/install-stage"
CURRENT_INSTALL_STAGE="base_runtime"
record_install_stage() {
  CURRENT_INSTALL_STAGE="$1"
  printf '%s\n' "$CURRENT_INSTALL_STAGE" > "$INSTALL_STAGE_FILE"
}
trap 'printf "failed:%s\n" "$CURRENT_INSTALL_STAGE" > "$INSTALL_STAGE_FILE"' EXIT
record_install_stage "base_runtime"

start_docker() {
  if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
    systemctl enable --now docker
  elif command -v service >/dev/null 2>&1; then
    service docker start
  fi
  docker info >/dev/null 2>&1 || fail "Docker 服务未能启动"
}

HAS_NVIDIA=0
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  HAS_NVIDIA=1
fi

if [[ "$HAS_NVIDIA" -eq 0 ]]; then
  MANIFEST_URL="${LLMWEB_TRAINING_ENVIRONMENT_MANIFEST_URL:-$CONTROL_URL/api/training-environment/manifest}"
  MANIFEST_PATH="$INSTALL_ROOT/training-environment.json"
  record_install_stage "environment_manifest"
  curl -fL --retry 3 --retry-all-errors "$MANIFEST_URL" -o "$MANIFEST_PATH.download"
  mv "$MANIFEST_PATH.download" "$MANIFEST_PATH"
  manifest_value() {
    python3 - "$MANIFEST_PATH" "$1" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    value = json.load(handle)
for key in sys.argv[2].split("."):
    value = value[key]
print(value)
PY
  }
fi

if ! command -v docker >/dev/null 2>&1; then
  say "正在安装容器运行环境"
  if [[ "$HAS_NVIDIA" -eq 1 ]]; then
    curl -fsSL https://get.docker.com -o "$INSTALL_ROOT/get-docker.sh"
    sh "$INSTALL_ROOT/get-docker.sh"
  else
    HOST_RUNTIME_ASSET="$(manifest_value linux_host_runtime.asset)"
    HOST_RUNTIME_SHA256="$(manifest_value linux_host_runtime.sha256)"
    GATEWAY_BASE="${LLMWEB_TRAINING_ENVIRONMENT_ASSET_BASE_URL:-$CONTROL_URL/api/training-environment/assets}"
    HOST_RUNTIME_ARCHIVE="$INSTALL_ROOT/$HOST_RUNTIME_ASSET"
    record_install_stage "host_runtime"
    curl -fL -C - --retry 3 --retry-all-errors "$GATEWAY_BASE/$HOST_RUNTIME_ASSET" -o "$HOST_RUNTIME_ARCHIVE.download"
    printf '%s  %s\n' "$HOST_RUNTIME_SHA256" "$HOST_RUNTIME_ARCHIVE.download" | sha256sum -c -
    mv "$HOST_RUNTIME_ARCHIVE.download" "$HOST_RUNTIME_ARCHIVE"
    tar -xzf "$HOST_RUNTIME_ARCHIVE" --strip-components=1 -C /usr/local/bin
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
fi
start_docker

if [[ "$HAS_NVIDIA" -eq 1 ]]; then
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
fi

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
if [[ "$HAS_NVIDIA" -eq 1 ]]; then
  record_install_stage "runtime_image"
  if ! docker info --format '{{json .Runtimes}}' | grep -q 'nvidia'; then
    install_nvidia_toolkit
  fi
  docker build --platform "$PLATFORM" -t "$RUNTIME_IMAGE" -f "$INSTALL_ROOT/source/runtime/Dockerfile" "$INSTALL_ROOT/source"
  docker run --rm --gpus all "$RUNTIME_IMAGE" nvidia-smi >/dev/null \
    || fail "训练环境无法使用 NVIDIA GPU，请检查驱动与 NVIDIA Container Toolkit"
else
  TRAINING_ENVIRONMENT_VERSION="$(manifest_value version)"
  [[ "$(manifest_value variants.linux-amd64-cpu.status)" == "available" ]] || fail "当前训练环境暂不支持这台普通电脑"
  MINIMUM_CPU_CORES="$(manifest_value variants.linux-amd64-cpu.minimum.cpu_cores)"
  MINIMUM_MEMORY_MB="$(manifest_value variants.linux-amd64-cpu.minimum.memory_mb)"
  MINIMUM_DISK_MB="$(manifest_value variants.linux-amd64-cpu.minimum.disk_free_mb)"
  CURRENT_CPU_CORES="$(getconf _NPROCESSORS_ONLN)"
  CURRENT_MEMORY_MB="$(awk '/MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)"
  CURRENT_DISK_MB="$(df -Pm / | awk 'NR == 2 { print $4 }')"
  (( CURRENT_CPU_CORES >= MINIMUM_CPU_CORES )) || fail "这台电脑至少需要 ${MINIMUM_CPU_CORES} 核处理器"
  (( CURRENT_MEMORY_MB >= MINIMUM_MEMORY_MB )) || fail "这台电脑至少需要约 8GB 内存"
  (( CURRENT_DISK_MB >= MINIMUM_DISK_MB )) || fail "这台电脑至少需要 20GB 可用空间"

  RUNNER_ASSET="$(manifest_value runner.asset)"
  RUNNER_BINARY_SHA256="$(manifest_value runner.sha256)"
  RUNTIME_ASSET="$(manifest_value variants.linux-amd64-cpu.artifact.asset)"
  RUNTIME_SHA256="$(manifest_value variants.linux-amd64-cpu.artifact.sha256)"
  CPU_RUNTIME_IMAGE="$(manifest_value variants.linux-amd64-cpu.image)"
  EXPECTED_IMAGE_ID="$(manifest_value variants.linux-amd64-cpu.image_id)"
  GATEWAY_BASE="${LLMWEB_TRAINING_ENVIRONMENT_ASSET_BASE_URL:-$CONTROL_URL/api/training-environment/assets}"

  say "正在下载已校验的连接程序"
  record_install_stage "runner_download"
  curl -fL -C - --retry 3 --retry-all-errors "$GATEWAY_BASE/$RUNNER_ASSET" -o "$INSTALL_ROOT/bin/llmweb-runner.download"
  printf '%s  %s\n' "$RUNNER_BINARY_SHA256" "$INSTALL_ROOT/bin/llmweb-runner.download" | sha256sum -c -
  mv "$INSTALL_ROOT/bin/llmweb-runner.download" "$INSTALL_ROOT/bin/llmweb-runner"
  chmod 0755 "$INSTALL_ROOT/bin/llmweb-runner"

  say "正在下载统一训练环境"
  record_install_stage "runtime_asset"
  RUNTIME_ARCHIVE="$INSTALL_ROOT/$RUNTIME_ASSET"
  curl -fL -C - --retry 3 --retry-all-errors "$GATEWAY_BASE/$RUNTIME_ASSET" -o "$RUNTIME_ARCHIVE.download"
  printf '%s  %s\n' "$RUNTIME_SHA256" "$RUNTIME_ARCHIVE.download" | sha256sum -c -
  mv "$RUNTIME_ARCHIVE.download" "$RUNTIME_ARCHIVE"
  record_install_stage "runtime_load"
  docker load -i "$RUNTIME_ARCHIVE" >/dev/null
  ACTUAL_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$CPU_RUNTIME_IMAGE")"
  [[ "$ACTUAL_IMAGE_ID" == "$EXPECTED_IMAGE_ID" ]] || fail "训练环境内容校验失败"
  docker run --rm "$CPU_RUNTIME_IMAGE" python -c 'import torch; print(torch.ones(1))' >/dev/null \
    || fail "普通电脑训练环境没有通过自检"
fi

say "正在注册这台训练主机"
record_install_stage "runner_register"
LLMWEB_TRAINING_ENVIRONMENT_VERSION="${TRAINING_ENVIRONMENT_VERSION:-legacy-0.1.0}" \
  "$INSTALL_ROOT/bin/llmweb-runner" register \
    --url "$CONTROL_URL" \
    --code "$REGISTRATION_CODE" \
    --data-root "$DATA_ROOT" \
    --output-root "$OUTPUT_ROOT" \
    --state-dir "$STATE_ROOT"

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
systemctl enable --now llmweb-runner
systemctl is-active --quiet llmweb-runner || fail "后台连接服务未能启动，请运行 systemctl status llmweb-runner 查看原因"
record_install_stage "ready"
trap - EXIT

if [[ "$HAS_NVIDIA" -eq 1 ]]; then
  say "连接完成。已启用 GPU 训练；数据目录：$DATA_ROOT；模型与结果目录：$OUTPUT_ROOT"
else
  say "连接完成。已启用普通电脑入门训练；数据目录：$DATA_ROOT；模型与结果目录：$OUTPUT_ROOT"
fi
