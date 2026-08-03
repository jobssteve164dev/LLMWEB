# LLMWEB

LLMWEB 是一个面向个人开发者和小团队的网页训练工作台。用户连接自己控制的 GPU，在同一套网页体验中完成数据检查、模型微调、训练监控、效果评测和模型导出；原始训练数据默认且必须留在用户环境。

## 首版范围

- Linux x86_64 + NVIDIA GPU + Docker
- 文本生成任务
- SFT、LoRA、QLoRA
- LLaMA-Factory 训练适配器
- 本地文件、Hugging Face、ModelScope 与用户 S3 数据源
- 本地主机或用户 S3 中的模型产物
- 基础模型与微调模型的固定测试集对比
- Adapter、完整 Hugging Face 模型与 GGUF 导出
- Qwen2.5 0.5B、1.5B、3B 指令模型（固定 revision）

产品定义见 [产品设计](docs/product/product-design.md)，技术与责任边界见 [系统边界](docs/architecture/system-boundaries.md)。

## 仓库结构

```text
apps/web/                  Next.js 网页工作台
services/control-plane/    FastAPI 控制面
runner/                    用户 GPU 主机上的 Runner
contracts/                 控制面与 Runner 的版本化协议
docs/                      产品与架构文档
```

## 启动网页服务

准备好 Docker Compose 后，在仓库根目录执行：

```bash
cp .env.example .env
make web-service
```

打开 `http://localhost:3000`，首次登录密码由 `.env` 中的 `LLMWEB_ACCESS_PASSWORD` 决定。该命令会启动网页、控制面和 PostgreSQL；它不会接触训练数据。

## 连接 GPU 主机

GPU 主机需要 Linux x86_64、NVIDIA 驱动和可用的 Docker。先构建受控训练环境和连接程序：

```bash
make gpu-runtime
./runner/bin/llmweb-runner doctor
```

在网页“连接算力”步骤生成一次性配对命令，并在 GPU 主机执行。用户需要把命令中的数据目录与结果目录替换为自己的路径。原始数据、模型权重、checkpoint 和存储凭证均不上传到网页服务。

## 开发模式

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

### GPU 连接程序

```bash
cd runner
go test ./...
go run ./cmd/runner doctor
```

`doctor` 只检查当前主机是否满足首版要求，不会启动训练或修改主机环境。

## 验证

```bash
pnpm check
.venv/bin/pytest services/control-plane
cd runner && go test ./...
```

当前仓库已覆盖项目创建、一次性配对、数据检查、基础模型评测、LoRA/QLoRA 训练、训练版本选择、固定测试集复测、暂停/继续/取消、断线事件补传及产物导出。没有 NVIDIA GPU 和 Docker 的开发机可以验证网页与控制流程，但不能替代真实 GPU 训练验收。
