#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_URL=""
REGISTRATION_CODE=""
SOURCE_REF="main"
REPOSITORY="jobssteve164dev/LLMWEB"
INSTALL_ROOT="/opt/llmweb"
STATE_ROOT="/var/lib/llmweb/state"
RUNTIME_IMAGE="llmweb/runtime:0.1.0"

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
[[ "$(uname -s)" == "Linux" ]] || fail "当前只支持 Linux GPU 主机"

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
command -v nvidia-smi >/dev/null 2>&1 || fail "没有检测到 NVIDIA 驱动，请先安装与 GPU 匹配的驱动"
nvidia-smi >/dev/null 2>&1 || fail "NVIDIA 驱动当前不可用，请先修复驱动状态"

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

say "正在下载与 ${PLATFORM} 匹配的连接程序"
curl -fL "https://github.com/${REPOSITORY}/archive/${SOURCE_REF}.tar.gz" -o "$INSTALL_ROOT/source.tar.gz.download"
mv "$INSTALL_ROOT/source.tar.gz.download" "$INSTALL_ROOT/source.tar.gz"
tar -xzf "$INSTALL_ROOT/source.tar.gz" --strip-components=1 -C "$INSTALL_ROOT/source"

docker run --rm --platform "$PLATFORM" \
  -v "$INSTALL_ROOT/source/runner:/src:ro" \
  -v "$INSTALL_ROOT/bin:/out" \
  -w /src \
  golang:1.24.0 \
  go build -trimpath -ldflags="-s -w" -o /out/llmweb-runner ./cmd/runner
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

say "正在注册这台 GPU 主机"
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

if ! docker info --format '{{json .Runtimes}}' | grep -q 'nvidia'; then
  install_nvidia_toolkit
fi

say "正在安装受控训练环境，这一步可能需要几分钟"
docker build --platform "$PLATFORM" -t "$RUNTIME_IMAGE" -f "$INSTALL_ROOT/source/runtime/Dockerfile" "$INSTALL_ROOT/source"
docker run --rm --gpus all "$RUNTIME_IMAGE" nvidia-smi >/dev/null \
  || fail "训练环境无法使用 NVIDIA GPU，请检查驱动与 NVIDIA Container Toolkit"

command -v systemctl >/dev/null 2>&1 || fail "当前系统不支持 systemd，无法安装后台连接服务"
[[ -d /run/systemd/system ]] || fail "systemd 当前未运行，无法安装后台连接服务"

say "正在启动后台连接服务"
cat > /etc/systemd/system/llmweb-runner.service <<EOF
[Unit]
Description=LLMWEB GPU Runner
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

say "连接完成。数据目录：$DATA_ROOT；模型与结果目录：$OUTPUT_ROOT"
