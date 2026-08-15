# AGENTS.md

## Project Goal

This repository is a Research / experiment. Keep changes focused on the user-facing project goal, not on internal process decoration.

## Before Changing Files

- Read `README.md` and `PROJECT_MEMORY.md` first.
- Inspect the smallest relevant code or content path before proposing broad changes.
- Preserve existing architecture, routes, and user workflows unless the task explicitly changes them.

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
- GitOps 节点必须精确复用既有业务 Release Bundle 下发链：共享 Release 构建池、单一制品身份、既有业务制品摘要与签名、已有受治理产物代理、Agent 侧授权下载/校验/安全解包和终态回报。复用同一代理 URL 但新增 Release 存储、签名 Secret、令牌族、下载器或身份判据不算复用；验签解包后只允许保留固定 Runner Action 安装入口这一处语义差异。
- Docker daemon 本地导入后的 image ID 不是跨节点制品身份。发布身份以包字节摘要/签名和包内内容摘要为准；镜像导入后通过固定镜像引用、内容检查和功能自检验收。
- 训练环境发布前必须把同一最终包交给真实安装消费者验证，并覆盖受支持的镜像存储后端、平台和架构。只在构建端同类 Docker 环境执行 `docker load` 不得解锁发布；生产 Target 不承担兼容性探索。
- LLMWEB 新版本只通过既有 GitOps Release producer 产生新的不可变 Action 包，不得要求 GitOps 修改运行时代码、公共 Runner Target 契约或 CloudMCP 公共 Bridge 契约，也不得创建 LLMWEB 专属构建 Runner。
