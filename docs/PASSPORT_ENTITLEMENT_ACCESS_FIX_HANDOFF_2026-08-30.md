# LLMWEB Passport 付费权益误判修复交接

日期：2026-08-30  
目标仓库：`/home/ubuntu/project/LLMWEB`  
当前仓库基线：`fe4c68a4db9e316eaebe5cae57b7b3e4e5db2510`  
当前生产证据：GitOps deployment `973` 成功，部署源码为上述提交

## 1. 必须交付的用户结果

已经付费且 Passport 返回 `allowed:true` 的用户必须被 LLMWEB 识别为 Pro，获得 Passport
catalog 定义的付费项目额度和 API 连接能力，不能继续看到免费额度、升级 Pro 或再次结账。

没有权益、权益过期或已撤权的用户必须保持 Free；Passport 的 404、产品不匹配、鉴权错误或
服务不可用不能被伪装成 Free 或 Pro，而应保持现有“暂时无法确认方案”的可恢复错误体验。

本次完成标准不是“删除了一个条件”，而是代码、workspace SDK 类型、真实响应同形测试、生产
部署和真实用户路径共同闭环。

## 2. 已确认事实

### Passport 公共合同

Passport 的正式审计位于：

`/home/ubuntu/project/SZLKPassport/docs/ENTITLEMENT_ACCESS_CONTRACT_AUDIT_2026-08-30.md`

`Observed in code/runtime`：

- v1 HTTP 成功或正常拒绝返回 `{ ok:true, data, meta:{apiVersion:"v1"} }`。
- `@szlk/passport-client.checkAccess()` 已解包 envelope，只返回 `data`。
- `data.allowed` 是唯一规范准入结论。
- access decision 的字段是 `allowed`、`reason`、`email`、`userId`、`product`、`featureKey`、
  `mappingStrategy`、`productAccess`、`featureGrant`。
- `POST /api/v1/entitlements/access-check` 从 v1 首版起就没有 `entitlements[]` 或 `features[]`。
- 正常允许/拒绝为 HTTP 200；无用户或无产品关系为 404 `user_not_found`；产品不匹配为 403
  `product_mismatch`；鉴权错误为 401/403；服务错误不得产生付费或免费结论。

Passport 没有单方面删除 `entitlements[]`。不得通过给 Passport 增加该字段、读取完整 snapshot、
读取 billing status、缓存本地付费标记或隐藏升级入口来绕过本次修复。

### LLMWEB 当前故障

当前生产代码位于 `apps/web/app/lib/passport.ts:141-156`：

```ts
const access = await getPassportClient().checkAccess(...) as {
  allowed?: boolean;
  entitlements?: unknown;
};
const exactEntitlement = Array.isArray(access.entitlements)
  && access.entitlements.includes(paidProjectFeature);
const paid = access.allowed === true && exactEntitlement;
```

真实付费响应为 `allowed:true` 且没有 `entitlements`，所以 `exactEntitlement=false`，最终
`paid=false`。这会向控制面发送免费额度和 `X-LLMWEB-Paid-Plan:false`，使工作台显示 Free、
限制为 1 个项目、隐藏 Pro 设置/API 连接，并重新展示升级或结账入口。

当前 `scripts/check-passport-client.mjs` 只检查 SDK timeout 和 catalog，没有让真实 access DTO
穿过 `planAccessForUser()`，因此没有发现该回归。LLMWEB 的 workspace SDK
`packages/passport-client/index.d.ts` 仍把 access 返回值声明得过宽，也没有阻止错误字段依赖。

## 3. 最小正确修复

1. 在 `planAccessForUser()` 中以 `access.allowed === true` 作为唯一付费准入结论。
2. 保留 Passport catalog 的职责：它只提供付费项目额度和产品展示配置，不重新决定该用户是否
   已付费。
3. 移除 access decision 上人为添加的 `entitlements` cast 和所有同类二次判断。
4. 将 LLMWEB workspace SDK 的 access decision 类型同步为 Passport 已确认的强类型合同，使
   再次访问 `decision.entitlements` 在 TypeScript 中失败。不要改变 SDK 运行时解包行为。
5. 保留现有 60 秒用户级 decision cache；不要借此任务改变缓存、认证、支付、计划、工作区、
   API 连接、控制面 header 或部署架构。
6. 审计 `planAccessForUser()` 的所有下游调用，确认它们只消费 `{paid,limit}`，不会再次从其他
   Passport 字段覆盖结论。

## 4. 强制测试与验收矩阵

测试夹具必须来自上述 Passport 正式合同或脱敏生产同形响应，不能根据 LLMWEB 当前假设手写一个
不存在的字段。至少让以下响应穿过真实 SDK 和真实 `planAccessForUser()`：

| 情形 | 预期 |
|---|---|
| `allowed:true`，包含 `productAccess/featureGrant`，不含 `entitlements[]` | `paid=true`，使用 catalog 的付费项目额度 |
| `allowed:false`, `feature_not_granted` | `paid=false`，项目额度为 1 |
| 付费后再次读取 | 不出现 Free/升级/再次结账，Pro 设置和 API 连接可用 |
| 无权益、过期或撤权 | 不放行多项目与 API 连接 |
| v1 404 `user_not_found` | 抛出/传播服务判定错误，不缓存成 Free |
| 403 `product_mismatch` | 不缓存成 Free 或 Pro |
| 401/403 鉴权错误 | 不缓存成 Free 或 Pro |
| 500/503 或网络错误 | `/api/session` 和 control proxy 保持可恢复 503，不把用户标成 Free/Pro |
| SDK 输入是完整 v1 envelope | SDK 解包后 parser 正确读取 `data.allowed`，业务层不再解一次 envelope |

测试应覆盖实际用户结果，而不只断言内部变量：

- 付费账号的工作台账户标签为 Pro。
- 已付费账号不显示“升级 Pro/升级方案”动作，也不会因当前方案判断再次进入
  `/api/billing/checkout`。
- 付费项目额度来自 Passport catalog，当前预期高于免费额度 1。
- Pro API 连接门禁可用。
- deny/revoked 用户仍显示 Free，创建新项目受免费额度约束，API 连接仍拒绝。
- 服务错误显示“当前无法确认项目方案，请稍后重试”，不显示误导性的 Free/升级状态。

优先扩展 `scripts/check-passport-client.mjs` 或增加同级窄契约检查，并把它纳入现有 `pnpm check`；
不要建立一套只在新测试中存在的替代 parser。

## 5. 修改边界

允许修改：

- `apps/web/app/lib/passport.ts`
- `packages/passport-client/index.d.ts` 及为保持 workspace SDK 类型一致必需的最小文件
- 与该权益解析直接相关的测试/检查脚本和精确文档/项目记忆

禁止：

- 修改 SZLKPassport、Cloudapi、GitOps 或其他业务仓库
- 给 access-check 增加或假定 `entitlements[]`
- 从 `productAccess`、`featureGrant`、billing snapshot 或本地数据库重新推导并覆盖 `allowed`
- 默认放行、把错误降级为 Free、隐藏升级按钮来制造“看似修复”
- 改认证、登录、checkout、Passport catalog、计划金额、控制面协议或训练系统
- 顺手重构无关前端、Runner、训练环境或部署链
- 输出或提交产品 secret、真实邮箱、用户 ID、支付标识、cookie 或完整生产响应

## 6. 验证、提交与生产闭环

修改前读取 LLMWEB 的 `AGENTS.md`、`README.md`、`PROJECT_MEMORY.md` 和本交接；以当前代码、
Git 历史、测试、正式 GitOps 状态与 Passport 审计为事实，不把本交接当成高于新证据的绝对事实。

至少执行：

```bash
pnpm install --frozen-lockfile
pnpm check:passport-client
pnpm check
git diff --check
```

若新增独立测试命令，必须直接运行并纳入 `pnpm check`。检查最终构建产物或实际 Next.js route，
不能只检查源文本。代码改动完成后按 LLMWEB 仓库规则提交并推送 `origin/main`，确认 CI 与 Security
真实执行；若 GitHub job 因账户 billing/spending limit 以 0 steps 失败，应明确记录外部阻塞，
不能伪称 CI 通过。

生产仍沿现有受治理 GitOps 业务发布路径，不新建 workflow、Runner 或手工 Compose 旁路。发布前
先读取当前项目、服务和上次成功 deployment，确认正式入口；绑定本次精确 commit/deployment，
监控到终态。最终必须验证：

- GitOps 项目/服务运行健康，部署源码为本次提交。
- `https://llmweb.szlk.ai:3000/api/health` 返回 200 且 `service=llmweb-web`。
- 使用已有安全付费验收主体完成真实浏览器或正式 API 验收：账户显示 Pro、付费项目额度恢复、
  Pro 设置/API 连接可用、无升级/再次结账动作。
- 使用脱敏 deny/revoked 同形主体或正式可回滚验收路径确认不放行。
- 服务错误路径不会生成 Free/Pro 结论。
- 所有临时验收对象明确归类并在本轮清理；不得留下测试用户、checkout、grant、部署或任务残留。

如果无法取得安全的付费/撤权生产验收主体，代码与部署可以报告到其真实进度，但不得宣称用户问题
已闭环；要明确阻塞和所需授权。

## 7. 新对话可直接粘贴的完整提示词

```text
请在 /home/ubuntu/project/LLMWEB 中完成 LLMWEB Passport 付费权益误判的修复、验证、提交、推送和生产部署闭环。

开始前完整读取：

- /home/ubuntu/project/LLMWEB/AGENTS.md
- /home/ubuntu/project/LLMWEB/README.md
- /home/ubuntu/project/LLMWEB/PROJECT_MEMORY.md
- /home/ubuntu/project/LLMWEB/docs/PASSPORT_ENTITLEMENT_ACCESS_FIX_HANDOFF_2026-08-30.md
- /home/ubuntu/project/SZLKPassport/docs/ENTITLEMENT_ACCESS_CONTRACT_AUDIT_2026-08-30.md

我要的最终用户结果是：Passport 已确认 allowed:true 的付费用户在 LLMWEB 中必须恢复 Pro、取得 Passport catalog 定义的付费项目额度和 API 连接能力，不能再看到 Free、升级 Pro 或再次结账；无权益、过期或已撤权用户不能被放行；Passport 404、mismatch、鉴权或服务错误不能被误判为 Free 或 Pro。

已确认根因位于 apps/web/app/lib/passport.ts 的 planAccessForUser()：代码在 access.allowed === true 后又要求 access.entitlements 包含 project_limit_10。但 Passport v1 access-check 从首版起就不返回 entitlements[]；官方 SDK 已解包 envelope，data.allowed 是唯一规范准入结论。不要重新假设 Passport 删除了字段，也不要修改 Passport 或给 access-check 增加 entitlements[]。

按交接中的最小边界直接实施：以 access.allowed === true 作为唯一用户准入判断，catalog 只负责额度和展示配置；移除错误 cast；同步 LLMWEB workspace SDK 的强类型 access contract；补充生产同形的真实 SDK + planAccessForUser 契约测试，覆盖 allow-without-entitlements、deny/revoked、404、product mismatch、鉴权、500/503/网络错误、SDK envelope 解包，以及付费不再出现升级/checkout、撤权不放行、服务错误不降级。

不要改认证、支付、计划、控制面协议、训练系统、Cloudapi、GitOps 公共合同或其他仓库，不要建立本地付费旁路，不要用隐藏 UI 制造修复。

运行 pnpm install --frozen-lockfile、最窄测试、pnpm check 和 git diff --check。完成后提交并推送 origin main，确认 CI/Security；再沿 LLMWEB 既有受治理 GitOps 业务发布路径部署精确提交，验证项目/服务终态、https://llmweb.szlk.ai:3000/api/health，并使用已有安全验收主体确认真实付费用户恢复 Pro 且不再进入结账、deny/revoked 用户仍受限、服务错误不被分类。不得输出密钥、真实身份或完整敏感响应；临时验收对象必须在本轮清理。

最终回答先给用户结果，再给根因证据、改动、测试、提交/部署版本、生产验收和剩余风险。没有真实生产付费与撤权证据时，不得宣称闭环。
```
