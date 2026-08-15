# model-training 对 GitOps 成功 Release Bundle 路径的逐段复用映射

状态：P000 实施与发布硬门禁  
日期：2026-08-15

## 1. 绑定结果

`model-training` Runner Action 必须消费一个不可变、自包含的平台包。制品生产、签名、Release 存储、受治理代理、目标 Agent 授权下载、摘要/签名校验和安全解包，精确复用 GitOps 已用于其他业务发布的 Release Bundle 链；不能只复用 `/gh-release` URL 后另建下载与身份合同。

Runner Action 仍不是 GitOps 业务项目。普通业务 Bundle 在验签解包后进入 Compose 部署；`model-training` 在相同消费者边界后进入代码内固定的 Action 安装入口。这是唯一必要差异，不得因此创建 LLMWEB 专属 Target、GitOps 项目、OC 节点训练 Runner 或公共制品字段。

## 2. 逐段映射

| 成功业务 Release Bundle 基线阶段 | model-training 对应阶段 | 精确复用点 | 不可避免差异 | 证据与状态 |
|---|---|---|---|---|
| GitOps Release Runner 从固定业务源码 SHA 构建候选 | 同一既有构建池从固定 LLMWEB 源码 SHA 构建平台包 | `gitops-release-oc` 只是构建平面；固定源码、干净 Job、候选只构建一次、验证与发布消费同一候选 | 构建命令调用 LLMWEB 仓库内固定 package builder，不调用 Compose builder | 基线：`GITOPS/.github/workflows/dispatch-build.yml`；不得创建 LLMWEB 专属 GitHub Runner 或在 OC 安装训练 Action |
| 一个业务构建形成一个完整 `.tar.gz` Bundle | 一个平台形成一个自包含训练环境 `.tar.gz` | 节点一次只取得一个最终资产 | 普通 Bundle 含 Compose；训练包含固定安装入口、Runner、宿主 runtime、标准 Docker archive、内容清单与自检 | 包成员集合和内部摘要由发布、Agent 与安装器三层校验 |
| Bundle 内 `image.tar.gz` 被规范化为 classic Docker archive | 训练包内 runtime archive 使用同一规范化器与结构门禁 | `manifest.json`、`repositories`、普通 `*/layer.tar`、固定 RepoTag | 训练包只承载一个批准的 CPU runtime 镜像 | 基线代码：`dispatch-build.yml` 的 skopeo + legacy layout normalizer；禁止 daemon-local image ID |
| 最终 Bundle 生成 canonical `.sha256` 与 Ed25519 `.sig` | 最终训练包生成同格式 sidecar | 完全复用 `BUSINESS_ARTIFACT_SIGNING_PRIVATE_KEY`、摘要文本、签名格式和 Agent 固定公钥 | 资产命名和业务类别不同 | 不再给 LLMWEB 仓库另建签名 Secret；签名只在既有 GitOps Release producer 内发生 |
| Bundle 以唯一资产名写入 GitOps Release，存在即拒绝覆盖 | 训练包以稳定 Action + 平台 + build identity 的唯一资产名写入同一 Release 体系 | 同一 GitOps 仓库、不可变资产、资产与 sidecar 三件套、既有保留策略 | 训练包使用固定 `model-training` Action 命名空间 | 不在 LLMWEB Release 或另一存储中建立平行正式生产者 |
| 产品安装器经产品域下载正式资产 | LLMWEB 产品域只读代理同一 GitOps Release Bundle | 同一包 SHA256、同一签名、同一包内清单 | GitOps 仅暴露固定 `model-training` 最终资产白名单，LLMWEB 吸收内部路径 | 普通用户不需要 GitOps/CloudMCP 账户，不允许自选仓库、Tag、URL 或资产 |
| Release 元数据绑定 source/asset/digest/signature | Action Operation 从最终 GitOps Release 解析并固化同一事实 | 不信任调用方选择 URL、摘要或签名；源码 SHA、版本与包身份精确绑定 | Operation 绑定 Action release Tag，不创建 business deployment/project | 仅新增 GitOps 内部固定适配器，不修改公共 Runner Target/Action 或 Provider Bridge 契约 |
| 控制面创建 Agent-bound `/gh-release/...` 下载 grant | Action Operation 为同一训练包创建一个相同类型 grant | 完全复用 `deployment-asset` 的 audience、purpose、expiry、clean URL 和代理实现 | 安装后进入固定 Runner Action | 不再为 manifest、Runner、Docker runtime、CPU image 分别建 grant/token |
| Agent `/deploy` 下载候选、验签/验摘要、安全解包 | Agent 固定 Action handler 复用相同下载、校验、临时文件与 `extractTarGzSafe` | 同一资产字节、相同 Ed25519/SHA256 验证、大小/成员/路径边界与失败清理 | 验签解包后不进入通用 `/deploy` Compose 状态机 | handler 不接受 Shell、镜像或入口；内部包 URL、摘要和签名必须匹配固定 GitOps Release 与现有 grant |
| Bundle 安全解包后校验标准 Docker archive，再进入固定 Compose 消费 | 训练包安全解包后校验内容清单和标准 Docker archive，再进入固定安装入口 | 最终消费者校验先于宿主副作用 | 最后动作是安装 Runner、runtime、systemd 和配对，而不是 `compose up` | 配对材料写入 0600 临时文件，不进入 argv、日志或持久 metadata |
| deployment id + Agent job + 物理容器状态共同证明终态 | runner_action_id + operation_id + Agent 物理状态 + LLMWEB Runner 心跳共同证明终态 | 稳定治理身份、阶段、真实目标读回 | 跨 GitOps/LLMWEB 两个真相源 | 复用 `get_runner_action_status` 与 `list_llmweb_training_pool`，不新增旁路状态 |
| 同一最终 Bundle 经过独立消费者验证 | 同一最终训练包进入真实 Agent Action consumer | 同一候选字节、真实消费者、生产前隔离验证 | 还必须覆盖 classic overlay2 与 containerd image store | 当前同类 hosted Docker 验证无效，保持发布闩锁 |

## 3. 明确禁止

- 不把 `model-training` 注册成 GitOps 业务项目，也不让通用 `/deploy`、Compose 或项目部署记录承载 Runner Action 语义。
- 不创建 LLMWEB 专属 GitHub Actions Runner、Runner Target 或 OC 节点训练 Runner；现有 `gitops-release-oc` 仅作为共享构建执行位置。
- 不再为 manifest、Runner、Docker static runtime 或 CPU image 分别创建代理 grant/token。
- 不再由包内 installer 下载执行资产；包内任何动态执行资产 URL 都使发布失败。
- 不再把 Docker daemon 导入后的本地 image ID 写入跨节点发行合同。
- 不再把 Release 版本写成 GitOps 运行时代码常量；Operation 固化构建系统解析出的不可变包身份。
- 不修改 CloudMCP 公共 Bridge 字段、公共 Runner Target/Action 工具 schema 或其他业务接入语义。
- 不在生产 Target 上验证归档兼容性；相同失败不得靠新 Operation 重试。
- 普通用户只访问 LLMWEB 的发行清单和资产 API；其下载字节必须与 Agent-bound GitOps 路径一致。

## 4. 发布解锁证据

只有以下证据同时存在，才允许一次生产安装复验：

1. 最终包成员清单固定，且不含 Git、缓存、Secret、用户数据或动态执行资产 URL。
2. 最终包由既有 GitOps producer 用业务制品签名密钥签名，并由真实 Agent 验证代码通过；篡改包、摘要或签名均在副作用前失败。
3. 同一最终包分别由 classic overlay2 与 containerd image store 导入；固定镜像引用、平台检查和 PyTorch 自检均通过。
4. Agent 结构化 Action handler 对错 action、错资产身份、错签名、越界归档、路径逃逸、重复 Operation 和 pairing 泄露均失败关闭。
5. 最终生成安装执行不发起第二份执行资产下载；服务单元、Runner doctor、结构化失败码和有界日志链通过。
6. CloudMCP 仍只调用 `create_llmweb_runner_pairing → install_runner_action → get_runner_action_status → list_llmweb_training_pool`，正式工具 schema 无新增制品字段。
