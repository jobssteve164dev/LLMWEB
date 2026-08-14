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
