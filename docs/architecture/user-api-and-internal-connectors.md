# 用户训练 API 与内部连接器

状态：实施设计基线

更新日期：2026-08-15

## 1. 目标

LLMWEB 把现有内部 Provider Bridge 能力升级为平台正式的用户训练 API。Pro 用户可以在设置页创建、查看、轮换和撤销自己的 API 连接，并把项目、算力、数据、训练、评测和模型能力接入自己选择的调用服务；免费用户不开放 API 设置和调用。

CloudMCP 是这套标准 API 的一个内部消费者，不是 LLMWEB 用户需要理解、选择或绑定的平台。GitOps 负责把内部受管节点接入某个真实 LLMWEB 用户的训练池，也不进入普通用户的产品心智。

最终关系是：

```text
LLMWEB 注册用户
  │
  ├── 网页工作台 ──────────────┐
  │                            │
  └── 设置 / API 连接           │
         │                      ▼
         ├── 用户自己的调用服务 ──► LLMWEB 统一应用服务
         ├── 用户自己的 Agent    │
         └── CloudMCP 连接器 ────┘
                    │
                    └── GitOps 连接器 ──► 内部 Runner 节点
```

## 2. 产品主语与用户心智

设置页使用“API 连接”或“外部调用”作为用户可见名称。用户只需要理解：

- 我可以为自己的账户创建一个 API 连接。
- 我可以给连接命名，说明它将接到哪个调用服务。
- 连接只能访问我的工作区和我明确允许的动作。
- 我能看到最近使用时间和操作记录。
- 我可以随时轮换凭证或撤销连接。

普通用户界面不得出现 CloudMCP、Provider Bridge、GitOps、内部工作区、Bridge Header、Runner Agent 或后端路由等实现概念。CloudMCP 不能成为设置卡片名称、授权对象或账户类型。

普通用户连接自有算力时，只运行 LLMWEB 设置页生成的一次性连接命令。安装器从 LLMWEB 产品域下载发行清单、正式包、摘要和签名；LLMWEB 在服务端代理 GitOps 中已经通过最终验证的同一 Bundle。用户不持有 CloudMCP 或 GitOps 凭证，也不选择内部仓库、Tag、节点或代理。内部 GitOps target 安装与普通用户安装的入口不同，但消费包字节、摘要、签名和固定安装器完全相同。

## 3. 核心决策

- API 调用身份必须来自真实 Passport 注册用户，不能来自内部虚拟用户或固定工作区。
- API 与网页只在身份入口不同，必须复用同一套应用服务、项目配额、Runner 归属、任务状态和数据隔离规则。
- 用户 API 凭证由已登录用户创建，服务端绑定 Passport 用户与唯一 LLMWEB 工作区。
- 调用方不能通过请求参数或请求头声明可信用户 ID、邮箱、工作区或配额。
- 第一版一个账户可以创建多个命名 API 连接，以对应不同调用服务；每个连接拥有独立凭证、权限、审计和撤销状态。
- 第一版不向用户 API 提供删除项目、数据或模型的能力，不提供任意脚本、Shell 或训练镜像执行能力。
- CloudMCP 使用标准用户 API，不保留 LLMWEB 专属内部身份或业务旁路。
- GitOps 通过通用 Runner Target 内的 `model-training` Runner 动作完成节点准备与训练 Agent 接入；Target 仍只表示 Agent 节点范围，训练 Agent 必须归属于发起连接的真实用户工作区。
- 现有内部 CloudMCP 工作区中的关联对象完成显式迁移和验收后硬退役，不保留隐式回退。

## 4. 设置页 API 连接

### 4.1 未创建连接

“API 连接”区域说明用户可以把 LLMWEB 接到自己的自动化服务或训练助手。主动作是“创建 API 连接”。

创建表单只要求用户理解必要选择：

- 连接名称，例如“我的训练助手”。
- 用途说明，例如“从团队自动化服务启动并查看训练”。
- 允许完成的用户动作。

不得要求用户填写 CloudMCP、MCP backend、Bridge 地址、工作区 ID 或 GitOps 节点信息。

### 4.2 权限表达

用户界面按动作表达权限：

- 查看工作台状态和训练结果。
- 管理项目和数据准备。
- 连接算力。
- 启动、暂停和继续训练。
- 读取模型产物信息。

内部可使用稳定 capability：

```text
workspace:read
project:write
runner:pair
training:write
artifact:read
```

技术 capability 不直接暴露给普通用户。取消正在运行的训练需要该次调用携带明确确认；Runner 转移和任何删除动作不属于第一版 API 权限。

### 4.3 凭证交付

API 凭证只在创建或轮换成功后显示一次。设置页必须清楚说明：

- 凭证代表当前账户，请只交给用户信任的调用服务。
- LLMWEB 之后不能再次显示原始凭证。
- 丢失时应轮换，而不是尝试找回。

服务端只保存不可逆摘要。凭证不得出现在 URL、日志、审计详情、任务 JSON、Runner 环境或模型产物中。

### 4.4 已创建连接

每张连接卡片展示：

- 用户自定义名称与用途。
- 允许的用户动作。
- 创建时间和最近使用时间。
- 最近操作入口。
- “轮换凭证”和“撤销连接”。

撤销后立即拒绝该连接的新请求，但不删除用户对象，也不默认终止已被 Runner 领取的训练。不同连接相互独立，撤销一个连接不影响同一账户的其他连接或网页会话。

## 5. 用户 API 鉴权与业务边界

### 5.1 身份解析

API 凭证直接绑定：

```text
credential -> api_connection -> passport_user_id -> workspace_id
```

服务端按凭证摘要读取仍然有效的连接，并由绑定记录解析用户与工作区。请求中的用户 ID、邮箱、工作区、项目额度及对象归属全部不可信，不能覆盖解析结果。

### 5.2 权益

Passport catalog 与 access decision 仍是配额真相。任何创建项目或增加受配额约束资源的 API 操作都必须按绑定账户实时读取当前权益；调用服务不能声明配额，LLMWEB 也不能把创建连接时的配额快照当作长期真相。

权益不可确认时拒绝新增，不删除或隐藏已有项目、训练记录和模型。

### 5.3 统一应用服务

```text
网页可信会话 ─────┐
                 ▼
            LLMWEB 统一应用服务
                 ▲
用户 API 凭证 ────┘
```

统一应用服务负责工作区隔离、项目配额、Runner 配对、数据准备、训练任务、checkpoint、控制动作、指标和产物。网页路由与 API 路由只负责各自的身份解析和参数适配，不能复制两套业务逻辑，也不能通过伪造网页内部身份头实现 API。

## 6. API 能力

第一版用户 API 至少覆盖现有训练闭环：

- 读取账户工作台、项目、Runner、数据集、训练和最近操作。
- 创建项目。
- 为当前账户生成一次性 Runner 配对凭证。
- 按精确 Runner ID 撤销当前账户的一台空闲 Runner；撤销必须重复确认同一 ID，存在未结束任务时拒绝执行。撤销后旧设备身份立即失去心跳、领任务和上报权限，并从训练池退出，但不删除 Runner Target、节点数据或模型产物。
- 创建并检查数据集。
- 创建训练实验。
- 查询训练阶段、进度、指标、checkpoint 和产物引用。
- 选择 checkpoint。
- 暂停和继续训练。
- 经过明确确认后取消训练。

API 使用稳定、版本化、面向用户动作的请求与响应。不得暴露任意数据库查询、任意控制面路由转发、任意 Runner 命令或调用方提供的训练镜像。

## 7. 数据模型与审计

API 连接至少保存：

```text
ApiConnection
- id
- passport_user_id
- workspace_id
- name
- purpose
- granted_capabilities
- credential_hash
- status
- created_at
- last_used_at
- revoked_at
- rotated_at
```

操作审计至少保存：

```text
ApiAuditEvent
- id
- connection_id
- workspace_id
- actor_user_id
- action
- target_type
- target_id
- outcome
- occurred_at
- safe_request_summary
```

网页操作与 API 操作共享业务对象，但审计必须能区分“网页操作”和具体 API 连接代用户执行。用户看到的是自己命名的连接，例如“由‘我的训练助手’执行”，而不是内部平台名称。

## 8. CloudMCP 侧 LLMWEB 连接器

CloudMCP 增加 LLMWEB 用户 API 连接器，职责仅为消费标准 API：

- 由内部操作者把一个真实 LLMWEB 用户创建的 API 凭证安全绑定到连接器。
- 从 LLMWEB 的正式 API 能力目录生成 CloudMCP 工具目录。
- 把 CloudMCP 工具参数转换成标准 LLMWEB API 请求。
- 保持 LLMWEB 返回的账户、权限、配额和对象归属，不自行制造用户身份。
- 对凭证只保留受治理的 Secret 引用，不把明文写入工具参数、日志、项目配置或审计正文。

CloudMCP 的租户工具授权继续决定哪个内部消费者能调用哪些 LLMWEB 工具；LLMWEB API 凭证则决定这些调用最终只能访问哪个真实 LLMWEB 账户。两层授权缺一不可：

```text
CloudMCP 消费者授权
        ↓
CloudMCP LLMWEB 连接器
        ↓
LLMWEB 用户 API 凭证
        ↓
真实用户工作区
```

不得继续使用 `cloudmcp-operator`、`ws_cloudmcp_operator` 或 CloudMCP 专属配额。CloudMCP 连接器故障时必须失败关闭，不能回退到旧内部 Bridge。

## 9. GitOps Runner Target 与 Runner 动作

### 9.1 对象模型

GitOps 不增加“LLMWEB Target”。Runner Target 是绑定已有 Agent 注册节点的范围和归属证明；GitHub Action、模型训练和固件编译是这个范围内并列的 Runner 动作：

```text
GitOps Agent 注册节点
└── Runner Target（节点范围、归属、资源上限）
    ├── Runner Action: action-runner
    ├── Runner Action: model-training
    └── Runner Action: firmware-compilation
```

- Target 只绑定现有 `agent_id`，不要求 SSH/Server 凭证；Server 凭证只能是个别 Runner 适配器的辅助对象，不能决定 Target 是否有效。
- `model-training` 是通用 Runner 动作，不是 LLMWEB 专属 Target 类型。LLMWEB Agent 是该动作当前受批准的实现和平台侧 Runner 身份。
- 同一 Target 可以安装多个 Runner 动作，不存在“主要工作负载”或用途互斥；Target 的总资源预算和每个 Runner 的运行时限位负责隔离。
- Runner 动作使用稳定身份 `runner-action:<runner_target_id>:<action_kind>`；一次安装、升级或重试使用独立 `operation_id`。不得把 Agent Job ID、容器名或外部 Runner ID 冒充 Runner 动作身份。
- GitOps 是节点、Target、Runner 动作安装状态、资源预算和可调度状态的真相；LLMWEB 是账户、训练 Runner 身份、训练任务和心跳的真相。
- Target、Runner 动作、实例与运行时证据必须按显式 ID 关联；禁止根据名称或容器位置猜测归属。

以下状态直接视为对象模型错误：把 Target 当成 GitHub Runner、LLMWEB Runner 或容器；要求 Target 拥有 Server 凭证；把 Runner 类型写成 Target 类型；用“主要用途”阻止同一 Target 中的其他 Runner 动作。

### 9.2 绑定流程

1. 上层通过已绑定真实账户的 LLMWEB API 连接生成一次性 Runner 配对凭证。
2. CloudMCP 选择一个调用方已获授权的精确 `runner_target_id`，请求安装 `model-training` Runner 动作；Target 创建和节点选择是此前完成的 GitOps 治理动作，不是本次安装的隐含副作用。
3. GitOps 控制面从 Target 解析已注册 Agent，验证调用主体、Target 启用状态、节点在线、调度状态、资源预算和动作状态。
4. 独立训练环境发行工作流只在训练版本发布时从不可变 LLMWEB 源码 SHA 生成单个平台包；它使用已有受管构建 Runner 作为执行位置，复用既有业务制品签名信任和 GitOps Release 存储，但不修改或触发 Agent/业务公共构建工作流，也不在构建节点安装训练 Runner。
5. 服务端把 producer 记录的源码 revision、包名、包 SHA256 和签名固化到 Runner Action 与本次 Operation；随后只为这一份包生成一个既有 Agent-bound `/gh-release` 授权。Agent 复用业务发布的下载、验签、验摘要和安全解包代码，再执行包内固定 Action 安装入口。
6. 包内安装器不再下载执行资产；它校验包内 Runner 与训练运行时内容、导入固定镜像引用并运行最小自检，再向 LLMWEB 注册。
7. GitOps 以稳定 `runner_action_id` 回报 Runner 动作，以 `operation_id` 回报本次安装阶段；最终同时以 GitOps Agent 终态和 LLMWEB 用户训练池中对应 Runner 心跳正常为完成证据。

公共 Runner 动作接口只接受 `runner_target_id`、固定 `action_kind=model-training` 和不透明的一次性配对材料，不接受 `agent_id`、Server 凭证、任意 URL、源码 revision、Shell、安装命令、镜像名、账户或工作区 ID。配对材料绑定目标账户且短时一次有效；GitOps 不解析、保存或改写其账户归属。

### 9.3 身份、权限与资源

- GitOps 只持久化 Target 下 `model-training` Runner 动作、批准的单一发行包身份、安装阶段和安全状态摘要，不持久化 LLMWEB 用户 API 凭证或配对码。
- 训练环境版本是每个 Runner Action 的已解析包身份，不是 GitOps 源码常量。LLMWEB 新版本只向同一独立发行工作流提交新版本号与源码 SHA，不得要求修改 GitOps 运行时代码、独立发行工作流、Agent/业务公共工作流或公共 Runner 动作契约；仅当包协议、信任来源或稳定动作语义改变时才进行跨系统升级。
- 安装事务可以使用完成受批准系统安装所需的宿主机权限；训练 Agent 不能继承通用高权限 Shell，只能领取版本化结构任务并启动批准的非特权训练运行时。
- 训练任务不得携带任意命令、镜像、宿主机路径、特权容器、Docker Socket、网络目标或未批准启动参数。
- Target 至少声明 CPU、内存、磁盘、GPU 分配、最大并发、可调度与维护状态。LLMWEB 只能使用分配给该 Target 的预算，不能把整台 Node 当作隐式资源池。

### 9.4 生命周期

Runner 动作使用通用状态：

```text
inactive → installing → registering → ready → busy
                    ↘ upgrading / degraded / disabled
ready / degraded / disabled / inactive → retiring → inactive
                                      ↘ degraded
```

GitOps 判断节点、产物、安装和系统服务健康；LLMWEB 判断账户注册、心跳和训练执行健康。聚合展示不得用一侧状态覆盖另一侧事实。

- 解绑账户：先通过 LLMWEB 用户 API 按精确 `runner_id` 撤销设备身份；有非终态训练任务时拒绝撤销，成功后该身份不能心跳、领取或上报，Runner Target 保持不变。
- 移除 Runner 动作：再通过 GitOps 通用 `retire_runner_action` 按精确 `runner_target_id`、稳定 `runner_action_id` 和同值确认执行。GitOps 只从 Target 解析现有 Agent，并调用代码内固定的动作退役适配器；调用方不能提交 Agent、Shell、路径或清理命令。
- `model-training` 退役适配器只停止并禁用 `llmweb-runner.service`、移除该服务单元、清空本地状态中的 `device_token`，然后重新核验服务、主进程、单元文件和凭据均已消失。`/opt/llmweb` 中的受信运行缓存以及训练数据、checkpoint、模型和同 Target 其他 Runner 动作均保留。
- 退役只有在节点物理核验完成、Runner Action 写回 `inactive` 且 `action_retired` 审计落盘后才成功。节点动作失败时写回 `degraded`、结构化失败阶段和 `action_retirement_failed` 审计；因 LLMWEB 身份已先撤销，失败期间不能领取新任务，可按同一 Action 身份安全重试。
- 失败补偿：仅在 Runner 动作为 `degraded` 且没有生成任何运行实例时，按精确 `runner_action_id` 转回 `inactive` 并保留操作、错误和状态审计；已有服务、进程、凭据或实例时禁止用 `remove_failed_runner_action` 冒充退役，必须走 `retire_runner_action`。
- 转移账户：必须先正式撤销旧绑定，再用新账户重新配对，禁止直接改写归属。
- 退役 Target：先停止调度，再处理所有 Runner 动作，最后解除 Agent 节点范围。

账户撤销与节点动作退役是跨真相源的有序补偿链，不伪装成分布式事务：必须先关闭 LLMWEB 任务入口，再清理 GitOps 节点动作；第二步失败时保持“平台身份已撤销、节点动作退役失败”的可观察状态并只重试第二步，禁止恢复旧身份或回退直连路径。

已有训练身份升级时必须保留身份、数据和模型产物，并证明新配对与原 Runner 属于同一工作区。跨账户连接必须拒绝。

## 10. 三端正式链路

```text
LLMWEB 用户在设置页创建 API 连接
        ↓
一次显示用户 API 凭证
        ↓
CloudMCP 将凭证保存为受治理 Secret
        ↓
CloudMCP LLMWEB 连接器调用用户训练 API
        ↓
LLMWEB 在该用户工作区生成 Runner 配对凭证
        ↓
CloudMCP 请求在精确 Runner Target 内安装 model-training Runner 动作
        ↓
独立训练发行工作流构建签名单包；Target Agent 经既有代理安装/升级
        ↓
Runner 主动连接 LLMWEB 并领取结构化训练任务
        ↓
训练状态回到同一用户工作区和 API 连接审计
```

CloudMCP 不直接向 Runner 下发训练命令。GitOps 不创建第二套训练项目和任务。Runner 仍只通过出站连接向 LLMWEB 领取所属工作区的任务。

## 11. 现有内部路径迁移与退役

现有内部工作区中的 Runner、项目、数据集、实验、任务、事件和模型记录必须作为一个关联集合迁移到用户明确指定的真实注册账户。

迁移顺序：

1. 目标用户登录 LLMWEB 并创建用于内部自动化的 API 连接。
2. CloudMCP 连接器完成该凭证的受治理绑定和安全只读验证。
3. 确认旧工作区没有运行中、租约中或等待用户选择的任务。
4. 生成迁移预览，列出全部关联对象的数量、稳定 ID 和目标工作区。
5. 在单个事务中迁移工作区归属，保留 Runner 设备身份、对象 ID、指标、checkpoint 和产物引用。
6. 从普通网页和标准用户 API 分别验证相同对象可见、可继续操作且遵守真实配额。
7. 通过 CloudMCP 连接器完成一次只读查询和一个安全的真实训练闭环。
8. 验证旧内部身份无法再读取或写入任何迁移对象。
9. 删除代码与配置中的旧内部身份和专属业务 Bridge；缺少用户 API 凭证时必须失败关闭。

迁移不得创建第二个 Runner 冒充转移完成，不得只迁移部分对象，不得删除节点数据或模型产物。

## 12. 验收标准

### 12.1 LLMWEB

- Pro 用户能创建多个命名 API 连接，并且原始凭证只显示一次；免费用户无法通过界面或接口绕过权益限制。
- 每个连接只访问创建它的真实用户工作区。
- 请求不能通过用户、邮箱、工作区或配额字段切换身份。
- 网页与 API 执行相同项目配额、Runner 归属和训练规则。
- 用户能查看最近操作、轮换凭证和撤销连接。
- 撤销后该凭证立即失效，其他连接、网页和已领取训练不受破坏。
- 普通用户界面不出现 CloudMCP、GitOps 或 Provider Bridge。

### 12.2 CloudMCP

- LLMWEB 工具通过标准用户 API 连接器暴露，不再调用旧专属 Bridge。
- 连接器凭证以受治理 Secret 保存，不进入工具参数和日志。
- CloudMCP 租户授权和 LLMWEB 用户 API 授权都通过时工具才可调用。
- 缺少、撤销或错账户凭证时在调用 LLMWEB 前后均失败关闭，不能回退内部身份。

### 12.3 GitOps

- Runner 动作只能安装到调用方获准的精确 Runner Target，并由 GitOps 从 Target 解析已注册 Agent 节点。
- Target 创建只绑定现有 Agent 节点范围并登记 CPU、内存、磁盘、GPU、最大并发、调度和维护状态；不要求 Server 凭证，也不得生成 Runner、容器或账户绑定。
- GitOps 治理面不新增 LLMWEB 专属 Runner、Target 类型或专属下载协议。
- 调用方只提交固定 `action_kind=model-training` 与不透明配对材料；GitOps 在安装开始时解析并校验当前可信正式发行，将确切标签、源码 revision、一个自包含平台包、包摘要和签名固化到本次 Runner Action/Operation。
- LLMWEB 发布新的训练环境版本不修改 GitOps 运行时代码或公共契约；执行中的 Operation 始终使用开始时固化的不可变发行身份。
- 节点只经既有 Agent 制品代理与校验下载器取得摘要/签名锁定的正式包，不接受任意 URL、源码、镜像或命令，也不为 manifest、Runner、runtime 或镜像建立第二组节点下载。
- Docker daemon 导入后产生的本地 image ID 不作为跨节点发行身份；完成证据使用包摘要/签名、包内内容摘要、固定镜像引用、导入内容检查和功能自检。
- Runner 动作具有稳定 `runner_action_id`，安装、升级和重试分别使用 `operation_id`；状态读取不能把容器名或 Agent Job ID 当成 Runner 动作身份。
- `retire_runner_action` 是正式通用动作退役入口，和仅处理“没有运行实例”的 `remove_failed_runner_action` 具有不同语义；退役操作保留独立 `operation_id`，`get_runner_action_status` 必须同时读回控制面状态与节点物理核验结果。
- `action-runner` 实例退役必须精确撤销外部注册、移除该实例及其构建守护运行时、删除实例记录并保留 Target；审计记录不随实例或 Target 删除而消失。
- 完成状态同时具有同一最终项目产物经过既有 Agent 消费入口的摘要、签名、标准 archive 与固定镜像引用证据，以及 GitOps Agent 终态、Runner 身份保持、环境功能自检和 LLMWEB 用户训练池心跳证据；不得再引入 daemon-local image ID 或双镜像存储矩阵。

### 12.4 完整闭环

- 内部受管 Runner Target 安装 `model-training` Runner 动作并进入指定真实用户训练池；同一 Target 中的其他 Runner 动作不被改写或移除。
- CloudMCP 通过该用户的标准 API 连接创建项目、准备数据、启动训练、读取对比结果和模型产物。
- 同一用户从网页看到完全一致的项目、Runner、进度、指标、模型和调用记录。
- 旧 `cloudmcp-operator`、`ws_cloudmcp_operator` 和专属直连路径从代码、配置、生产运行与工具目录中清零。

## 13. 不改变的边界

- 原始训练数据、checkpoint 和模型权重默认留在 Runner 所在环境。
- Runner 不开放入站端口，继续主动领取版本化结构任务。
- 用户 API 不提供任意 Shell、脚本或镜像执行。
- GitOps 继续负责节点治理，不成为训练业务状态真相。
- CloudMCP 继续负责内部工具聚合与租户授权，不成为 LLMWEB 用户身份真相。
