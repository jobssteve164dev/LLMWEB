# AGENTS.md

## Project Goal

This repository is a Research / experiment. Keep changes focused on the user-facing project goal, not on internal process decoration.

## Before Changing Files

- Read `README.md` and `PROJECT_MEMORY.md` first.
- Inspect the smallest relevant code or content path before proposing broad changes.
- Preserve existing architecture, routes, and user workflows unless the task explicitly changes them.
- Before deploying, identify the repository's established release entrypoint from its scripts, documentation, and last successful production evidence. If the user explicitly names that entrypoint, use it directly; an unrelated CI or Runner failure does not authorize introducing or repairing a different deployment path.

## Verification

- Prefer the narrowest command that proves the changed behavior.
- Run the CI/security commands when the change affects runtime, packaging, release, dependencies, or security.
- Verify generated files directly when users will rely on generated output.

## Safety

- Do not expose secrets, tokens, local paths, prompts, or execution logs in user-facing output.
- Do not delete or rewrite unrelated project files.
- Treat high and critical security findings as action-changing risks.

## CloudMCP Provider Bridge

- LLMWEB 是 CloudMCP 公共 Provider Bridge 契约的消费者，不是该契约的定义者。
- 运行时只使用公共 `CLOUDMCP_BRIDGE_*` 与 `CLOUDMCP_BASE_URL` 合同；项目差异留在 LLMWEB 适配层，不得要求 CloudMCP 注册表为 LLMWEB 创建专属变量、请求头或协议版本。
- 修改 Bridge 接入时必须同时验证 Settings 读取、Compose 最终注入和 CloudMCP 正式 `list_tools` 读回；任一层仍使用项目专属合同即不得发布。

## Training Action Artifact Delivery

- GitOps 管理节点与普通用户电脑消费同一不可变、按平台自包含的训练环境包；每个节点一次只下载一个包含固定安装入口、Runner 和训练运行时的包，不得把 manifest、Runner、容器运行时或镜像拆成节点侧平行下载合同。
- 训练环境包由独立、按训练版本显式触发的受管发行工作流从不可变 LLMWEB 源码 SHA 生产；该工作流与 Agent Release、业务 Compose Bundle 的公共工作流生命周期完全分离，但复用既有签名信任、GitOps Release 存储、受治理产物代理、Agent-bound 授权、摘要/签名校验、安全解包和终态回报。不得为了单一 `model-training` 消费者修改 GitOps 共享 `build-agent` 或 `dispatch-build` 事件、Job、条件、输入、签名和 Runner 布局，也不得把 Runner Action 注册成业务项目。
- Docker daemon 本地导入后的 image ID 不是跨节点制品身份。发布身份以包字节摘要/签名和包内内容摘要为准；镜像导入后通过固定镜像引用、内容检查和功能自检验收。
- 训练环境按普通项目产物模式验证：标准 Docker archive、固定镜像引用、摘要/签名和既有 Agent 消费入口构成同一身份链。不得再用 daemon-local image ID 或额外镜像存储矩阵定义发行身份，也不得让训练专用验证阻塞 Agent 或业务公共发布。
- LLMWEB 新版本只向同一独立训练发行工作流提交新版本号和不可变源码 SHA；不得要求修改 GitOps 运行时代码、Agent/业务共享发布工作流、公共 Runner Target 契约或 CloudMCP 公共 Bridge 契约，也不得创建 LLMWEB 专属构建 Runner。
