# LLMWEB

LLMWEB 是一个面向个人开发者和小团队的网页训练工作台。用户连接自己控制的电脑，在同一套网页体验中完成数据检查、模型训练、训练监控、效果评测和模型导出；原始训练数据默认且必须留在用户环境。

## 首版范围

- Linux x86_64 + NVIDIA GPU + Docker，或 Apple Silicon Mac + Metal/MPS
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

打开 `http://localhost:3000`，使用邮箱注册或登录。账号密码、邮箱验证和密码重置由 SZLKPassport 的 Headless Auth 统一处理，LLMWEB 只建立自己的工作台会话。该命令会启动网页、控制面和 PostgreSQL；它不会接触训练数据。

根路径是产品公开页；登录后的工作台按用户动作使用可直接访问的路径：`/workbench/project`、`/workbench/compute`、`/workbench/data`、`/workbench/train`、`/workbench/evaluation` 与 `/workbench/models`。服务条款、隐私政策等共同法律正文由 SZLKlaws 统一治理，LLMWEB 在自己的公开路径和视觉中展示；产品特有的数据边界、算力责任与模型输出限制位于 `/legal-supplement`。

每个账号拥有独立工作区，切换项目时只加载该项目的数据版本、训练、评测和模型记录。免费用户可保留 1 个项目；Pro 用户可按 Passport catalog 的付费额度管理多个项目，并使用设置中的 API 连接。配额只限制新建，不会在方案变化时删除已有项目。

生产部署使用根目录 `compose.yaml`，只运行网页和控制面，并通过 `LLMWEB_DATABASE_URL` 连接部署平台治理的 PostgreSQL。用于本地开发的一体化 PostgreSQL 单独定义在 `compose.local.yaml`，不会作为生产业务服务发布。

## 连接训练电脑

训练电脑可以是普通 Linux x86_64 CPU 主机、带可用 NVIDIA 驱动的 Linux x86_64 主机，也可以是 Apple Silicon Mac（包括 M1 Max）。在网页“连接算力”步骤生成一次性安装命令并执行后，系统会读取统一训练环境清单，自动选择、下载和验证对应环境，随后注册一次性身份并启动后台 Runner，无需克隆仓库或现场构建训练镜像。

CloudMCP 管理的 GitOps 节点与外部用户电脑消费同一环境版本和内容摘要；中国网络的传输代理属于安装实现，不会成为用户需要配置的第二套流程。发行边界见 [统一训练环境发行与分发](docs/architecture/training-environment-release.md)。

Apple Silicon 当前使用 SFT/LoRA；4 位 QLoRA 依赖 CUDA 量化后端，仅在 Linux NVIDIA GPU 上提供。

默认数据目录为当前登录用户主目录下的 `llmweb/data`，模型和中间结果保存在 `llmweb/output`。原始数据、模型权重、checkpoint 和存储凭证均不上传到网页服务。

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

当前仓库已覆盖项目创建、一次性配对、数据检查、基础模型评测、LoRA/QLoRA 训练、训练版本选择、固定测试集复测、暂停/继续/取消、断线事件补传及产物导出。没有受支持 GPU 的开发机可以验证网页与控制流程，但不能替代 Linux NVIDIA 或 Apple Silicon 上的真实训练验收。

## 许可证

LLMWEB 使用 [MIT License](LICENSE) 开源。
