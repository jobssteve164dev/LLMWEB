#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_URL=""
REGISTRATION_CODE=""
SOURCE_REF="main"
REPOSITORY="jobssteve164dev/LLMWEB"
INSTALL_ROOT="/opt/llmweb"
STATE_ROOT="/var/lib/llmweb/state"
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
mkdir -p "$INSTALL_ROOT/bin" "$INSTALL_ROOT/source" "$STATE_ROOT"

start_docker() {
  if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
    systemctl enable --now docker
  elif command -v service >/dev/null 2>&1; then
    service docker start
  fi
  docker info >/dev/null 2>&1 || fail "Docker 服务未能启动"
}

if ! command -v docker >/dev/null 2>&1; then
  say "正在安装 Docker"
  curl -fsSL https://get.docker.com -o "$INSTALL_ROOT/get-docker.sh"
  sh "$INSTALL_ROOT/get-docker.sh"
fi
start_docker

HAS_NVIDIA=0
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  HAS_NVIDIA=1
fi

say "正在下载与 ${PLATFORM} 匹配的连接程序"
curl -fL "https://github.com/${REPOSITORY}/archive/${SOURCE_REF}.tar.gz" -o "$INSTALL_ROOT/source.tar.gz.download"
mv "$INSTALL_ROOT/source.tar.gz.download" "$INSTALL_ROOT/source.tar.gz"
tar -xzf "$INSTALL_ROOT/source.tar.gz" --strip-components=1 -C "$INSTALL_ROOT/source"

RUNNER_BINARY_URL="https://github.com/${REPOSITORY}/releases/download/llmweb-runner-bec5876f/llmweb-runner-linux-amd64"
RUNNER_BINARY_SHA256="5b647a97c9403d443c58415c56e5d3b8217fb0cd28a8ec0d0d6e231353fbb76b"
say "正在下载已校验的连接程序"
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

say "正在注册这台训练主机"
"$INSTALL_ROOT/bin/llmweb-runner" register \
  --url "$CONTROL_URL" \
  --code "$REGISTRATION_CODE" \
  --data-root "$DATA_ROOT" \
  --output-root "$OUTPUT_ROOT" \
  --state-dir "$STATE_ROOT"

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
  if ! docker info --format '{{json .Runtimes}}' | grep -q 'nvidia'; then
    install_nvidia_toolkit
  fi
  docker build --platform "$PLATFORM" -t "$RUNTIME_IMAGE" -f "$INSTALL_ROOT/source/runtime/Dockerfile" "$INSTALL_ROOT/source"
  docker run --rm --gpus all "$RUNTIME_IMAGE" nvidia-smi >/dev/null \
    || fail "训练环境无法使用 NVIDIA GPU，请检查驱动与 NVIDIA Container Toolkit"
else
  docker build --platform "$PLATFORM" -t "$CPU_RUNTIME_IMAGE" -f "$INSTALL_ROOT/source/runtime/Dockerfile.cpu" "$INSTALL_ROOT/source"
  docker run --rm "$CPU_RUNTIME_IMAGE" python -c 'import torch; print(torch.ones(1))' >/dev/null \
    || fail "普通电脑训练环境没有通过自检"
fi

command -v systemctl >/dev/null 2>&1 || fail "当前系统不支持 systemd，无法安装后台连接服务"
[[ -d /run/systemd/system ]] || fail "systemd 当前未运行，无法安装后台连接服务"

say "正在启动后台连接服务"
cat > /etc/systemd/system/llmweb-runner.service <<EOF
[Unit]
Description=LLMWEB Training Runner
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
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

if [[ "$HAS_NVIDIA" -eq 1 ]]; then
  say "连接完成。已启用 GPU 训练；数据目录：$DATA_ROOT；模型与结果目录：$OUTPUT_ROOT"
else
  say "连接完成。已启用普通电脑入门训练；数据目录：$DATA_ROOT；模型与结果目录：$OUTPUT_ROOT"
fi
