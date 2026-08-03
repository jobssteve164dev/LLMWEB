# LLMWEB

LLMWEB 是一个面向个人开发者和小团队的网页训练工作台。用户连接自己控制的 GPU，在同一套网页体验中完成数据检查、模型微调、训练监控、效果评测和模型导出；原始训练数据默认且必须留在用户环境。

## 首版范围

- Linux + NVIDIA GPU + Docker Runner
- 文本生成任务
- SFT、LoRA、QLoRA
- LLaMA-Factory 训练适配器
- 本地数据处理与本地优先的模型产物
- 基础模型与微调模型的固定测试集对比
- Adapter、合并权重、Hugging Face 与 GGUF 导出目标

产品定义见 [产品设计](docs/product/product-design.md)，技术与责任边界见 [系统边界](docs/architecture/system-boundaries.md)。

## 仓库结构

```text
apps/web/                  Next.js 网页工作台
services/control-plane/    FastAPI 控制面
runner/                    用户 GPU 主机上的 Runner
contracts/                 控制面与 Runner 的版本化协议
docs/                      产品与架构文档
```

## 本地启动

### 网页

```bash
pnpm install
pnpm dev:web
```

访问 `http://localhost:3000`，健康检查位于 `http://localhost:3000/api/health`。

### 控制面

```bash
python3 -m venv .venv
.venv/bin/pip install -e 'services/control-plane[dev]'
.venv/bin/uvicorn llmweb_control.main:app --reload --port 8000
```

访问 `http://localhost:8000/health`。

### Runner

```bash
cd runner
go test ./...
go run ./cmd/runner doctor
```

`doctor` 只检查当前主机是否满足首版 Runner 的基础要求，不会启动训练或修改主机环境。

## 验证

```bash
pnpm check
.venv/bin/pytest services/control-plane
cd runner && go test ./...
```
