# Product Marketing Context

*Last updated: 2026-08-04*

## Product Overview
**One-liner:** LLMWEB 是一个让个人开发者和小型 AI 团队连接自己 GPU，在网页中完成数据准备、模型微调、评测与导出的工作台。
**What it does:** LLMWEB 把数据检查、SFT / LoRA / QLoRA、训练监控、同测试集对比和模型导出组织为一条连续流程。训练数据、模型权重和 checkpoint 默认留在用户控制的 GPU 主机或自有 S3 中。
**Product category:** 自带 GPU 的大语言模型微调工作台。
**Product type:** 网页服务 + 用户环境中的 GPU 连接程序。
**Business model:** 免费账号最多保留 2 个项目；具备相应 Passport 权益的账号最多保留 10 个项目。产品不转售 GPU 算力。

## Target Audience
**Target companies:** 拥有本地或云端 NVIDIA GPU 的个人开发者、小型 AI 产品团队与领域团队。
**Decision-makers:** 个人开发者、AI 工程负责人、小团队产品负责人。
**Primary use case:** 在不把原始训练数据交给平台的前提下，完成一次有训练前后证据的大语言模型微调。
**Jobs to be done:**
- 把分散的训练命令、配置、日志和评测整理为一条可完成的网页流程。
- 在自己的算力与存储边界中准备数据、运行训练并取得模型产物。
- 用同一测试条件判断模型是否真的改善，以及改善是否值得性能代价。

## Personas
| Persona | Cares about | Challenge | Value we promise |
|---|---|---|---|
| 个人开发者 | 快速跑通、成本与数据控制 | 不想维护复杂训练脚本 | 用自己的 GPU 从数据走到可导出模型 |
| AI 工程负责人 | 可复现、可评测与可追踪 | 配置、日志和产物散落 | 用数据版本、基线和实验记录保留证据链 |
| 产品或领域成员 | 看懂目标、样本与结果 | 无法参与命令行训练流程 | 在网页中共同定义目标并查看可理解的比较结果 |

## Problems & Pain Points
**Core problem:** 微调工作被框架配置、命令行、数据脚本、训练监控和零散评测割裂，用户很难确认“训练跑完”和“模型变好”之间的差别。
**Why alternatives fall short:**
- 纯命令行方案要求用户自行维护配置、状态和结果证据。
- 托管训练平台常要求数据和模型进入供应方环境。
- 只有损失曲线的训练面板不能证明模型在目标任务上改善。
**What it costs them:** 反复调试、重复训练、难以比较实验，以及数据边界不清带来的风险。
**Emotional tension:** 用户既想减少工程负担，也不愿失去对数据、算力和模型产物的控制。

## Competitive Landscape
**Direct:** 托管式模型微调平台——降低启动门槛，但通常改变用户的数据与算力边界。
**Secondary:** LLaMA-Factory 等训练框架的命令行或原生界面——能力强，但用户仍需自行组织完整实验与评测流程。
**Indirect:** 团队自建脚本、表格和日志面板——可定制，但状态与证据容易分散。

## Differentiation
**Key differentiators:**
- 原始训练数据、权重、checkpoint 与存储凭证默认留在用户环境。
- 从目标、数据、算力、训练、评测到模型产物是一套连续用户动作。
- 基础模型与微调模型必须在同一测试条件下比较，才表达效果变化。
**How we do it differently:** 网页服务只组织动作与展示必要状态，训练执行留在用户控制的 GPU 主机。
**Why that's better:** 用户减少训练工程负担，同时保留数据、算力和产物控制权。
**Why customers choose us:** 他们要的是可完成、可核验的训练流程，而不是新的 GPU 市场或参数面板。

## Objections
| Objection | Response |
|---|---|
| 我是否需要上传训练数据？ | 默认不需要；数据检查、训练和评测在用户环境执行。 |
| 我是否必须熟悉训练框架？ | 用户选择目标、模型与速度/质量偏好，专业参数留在高级设置。 |
| 跑完训练是否代表效果更好？ | 不代表；产品用同一测试集比较基础模型、候选 checkpoint 和微调模型。 |

**Anti-persona:** 没有可用 Linux NVIDIA GPU、需要平台提供算力、需要生产推理托管、多机或多模态训练的用户。

## Switching Dynamics
**Push:** 命令、配置、日志和评测割裂，实验难以复现，托管平台改变数据边界。
**Pull:** 一条网页流程、自带 GPU、数据留在用户环境、训练前后有证据。
**Habit:** 已有脚本和框架虽然麻烦，但团队熟悉且可完全控制。
**Anxiety:** 连接程序是否安全、数据是否上传、已有 GPU 是否兼容、结果是否可导出。

## Customer Language
**How they describe the problem:**
- “我有 GPU，但不想再拼训练脚本、日志和评测。”
- “数据不能上传，但团队又需要一起看结果。”
**How they describe us:**
- “用自己的 GPU，在网页里把微调完整跑完。”
**Words to use:** 自己控制的 GPU、原始数据留在你的环境、同一测试集、可核验、取得模型。
**Words to avoid:** 一键变强、保证提升、零门槛、无限能力、托管一切。

## Brand Voice
**Tone:** 克制、可信、清晰。
**Style:** 先说明用户能完成什么，再说明证据与边界；不夸大模型效果。
**Personality:** 专业、直接、尊重用户控制权、重视证据。

## Proof Points
**Metrics:** 尚无可公开的客户效果指标，不虚构转化、训练提速或模型提升数据。
**Value themes:**
| Theme | Proof |
|---|---|
| 数据控制 | 原始数据、权重与 checkpoint 默认留在用户主机或自有 S3 |
| 训练连续性 | Runner 接受任务后，网页断开不会终止训练 |
| 结果可信度 | 基础模型和微调模型使用同一测试集与推理参数比较 |

## Goals
**Business goal:** 让拥有自有或租用 GPU 的目标用户开始并完成第一个训练项目。
**Conversion action:** 进入工作台并建立项目。
**Current metrics:** 尚未建立公开营销基线。
