# PROJECT_MEMORY.md

This file stores stable project facts future agents should reuse. Do not paste run logs, prompts, terminal output, or one-off debugging notes here.

## Project Identity

- Name: LLMWEB
- Type: Research / experiment
- Users: 拥有自有或租用 GPU 的个人开发者与小型 AI 团队
- Current stage: 项目初始化，首版产品与系统边界已确认

## Stable Decisions

- 产品形态是网页控制面加用户环境中的 GPU Runner，不开发多端客户端。
- 原始训练、验证和测试数据不离开用户环境；控制面默认只保存统计、元数据和授权预览。
- 首版只支持能够运行 Docker 的 Linux NVIDIA GPU 主机。
- 首版训练范围是文本 SFT、LoRA、QLoRA，默认训练引擎为 LLaMA-Factory。
- 首版以模型导出结束，不转售 GPU，也不承担生产推理托管。
- 没有同一测试集上的基础模型与微调模型对比，不得宣称效果已经提升。

## Architecture Boundaries

- Web 只与控制面通信；Runner 通过出站 HTTPS 主动连接，不要求用户开放入站端口。
- Runner 只接受版本化结构任务和批准镜像，不能成为通用远程 Shell。
- Runner 接受任务后持有本地执行状态；浏览器或控制面断开不能终止训练。
- 模型、checkpoint 和原始数据默认留在用户本地目录或用户自己的 S3 兼容存储。

## Verification

- Default CI: `.github/workflows/ci.yml`
- Default security checks: `.github/workflows/security.yml`
- Frontend: `pnpm check`
- Control plane: `.venv/bin/python -m pytest services/control-plane`
- Runner: `cd runner && go test ./...`

## Handoff Notes

- 产品基线见 `docs/product/product-design.md`，技术责任与数据边界见 `docs/architecture/system-boundaries.md`。
