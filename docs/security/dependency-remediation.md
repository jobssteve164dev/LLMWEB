# JavaScript 依赖安全整改

## 2026-10-20 风险与根因

GitHub 告警 #12–19 在整改前均为 open。其中 Next.js 的两类漏洞分别同时登记在 manifest 和 lockfile，8 条告警对应 6 个漏洞。

| 告警 | 实际依赖链 | 处理 |
| --- | --- | --- |
| #13、#14 | Web → Next.js 16.3.4 | 升至 16.3.8，修复 ImageResponse RCE |
| #15、#16 | 同上 | 16.3.8 同时修复 Draft Mode 缓存泄漏 |
| #18 | Next.js → PostCSS → source-map-js 1.2.1 | 固定到 1.2.2 |
| #12、#17 | ESLint / TypeScript ESLint → minimatch → brace-expansion | 分别固定兼容的 1.1.21、5.0.12，涵盖递归、重复扫描与二次时间复杂度漏洞 |
| #19 | Next ESLint → fast-glob → micromatch → braces 3.0.3 | 本地回补解析器深度修复，详见下文 |

同次实时 npm 复扫还发现 sharp 0.35.4 的 librsvg 高危漏洞，沿既有 override 升至 0.35.5。Next.js 16.3.8 同时覆盖此次复扫发现的其他 Next.js 漏洞。

代码审计没有发现 `next/og`、`ImageResponse`、`draftMode` 或 `use cache` 的调用；不以当前不可达代替依赖修复。braces 与 brace-expansion 来自开发检查，source-map-js 来自网页构建依赖；生产使用 Next standalone 输出。

## braces 的受测回补

上游截至整改时仍只发布 3.0.3。采用 [上游 PR #79](https://github.com/micromatch/braces/pull/79) 在固定提交 `7e2276abad22413c31147515773e286049fff75f` 提出的两个运行时文件补丁，仅回补该 PR 的深度处理增量，不引入其基线中的其他行为修改。

`patches/braces@3.0.3.patch` 由 pnpm 按锁定摘要应用。所有 braces 解析统一固定到该版本；解析器把超过 256 层的结构作为原文处理，保留普通嵌套、引号、转义和范围展开。花括号、圆括号、混合结构及未闭合输入均纳入回归。Docker 依赖阶段也复制同一补丁，使用同一 frozen lockfile。

`pnpm audit:dependencies` 先对真实 Next ESLint 依赖链运行补丁回归，再读取原始 `pnpm audit --json`。门禁保留并展示全部扫描结果，仅将 `GHSA-vfj7-8cjw-p6xm` 中版本精确为 braces 3.0.3 的 high 记录归类为受测回补；其他版本、其他告警及升级为 critical 的记录均不能继承例外。任何回归失败或扫描异常都会阻断检查，配置中没有持久 ignore，原始 `pnpm audit` 仍失败并显示这条高危，GitHub #19 可能持续 open，未对其执行 dismiss。待官方发布修复版后应替换回补并移除该单项分类。

## 验证入口与影响面

- `node --test scripts/check-dependency-security.test.mjs`：旧版 16 项中 8 项失败；补丁后相同断言全部通过，包含真实 fast-glob 路由发现。
- `pnpm check`：补丁回归、既有契约、训练相关回归、ESLint、TypeScript 和完整 Next.js 生产构建。
- `pnpm audit:dependencies`：包含开发依赖；唯一例外如上。`pnpm audit --prod` 应无漏洞。
- 冻结安装与 Web Dockerfile 的依赖阶段共同验证补丁随构建交付。
- 推送 main 触发既有 CI、Security 以及 GitOps Web 自动发布；独立训练环境 Source Contract 的 pull_request 路径条件不受本次最终差异触发。本次不改变任何共享发行工作流、训练依赖、版本或包分发契约。
- Web 正式路径仍为 GitOps `release` 模式，最近成功基线为部署 1464，对应改动前源码。此次仅网页 watch paths 触发服务发布；控制面保持现有版本。训练包仍须走其独立、显式触发的不可变发行流程，本次源码修复不代表旧训练包已替换。

发布仍需隔离生产产物的健康、页面渲染、语言切换、登录表单和未授权 API 拒绝验收；依赖扫描结果不能代替生产发布成功。

本地 `pnpm check` 已通过（新增 Next ESLint 规则产生 4 条既有导航写法警告，0 错误）；控制面 22 项测试与原版 Go 测试通过。Next standalone 隔离运行已验证语言切换、登录会话、真实 SQLite 控制面代理、篡改签名拒绝及建立项目后进入连接电脑步骤；未连接生产身份与数据库。当前环境无可用 Docker daemon，尚不能验证最终 Web 容器镜像；在这些生产产物证据补齐前不得宣称已上线。

完整安全检查同时复现了本轮清单外、原有工作流已失败的训练风险：Go 1.25.13 标准库有 9 项可达漏洞，GPU requirements 和 CPU wheel 中的 fsspec 命中模板执行漏洞。直接升级 s3fs/fsspec 会违反固定 LlamaFactory 所要求的 datasets 版本约束，因此本轮没有交付该不兼容升级，也没有将它们标为已修复。训练依赖需要单独的兼容回补及完整环境包验收，原有训练发行冻结继续有效；这些失败不被 JavaScript 的扫描结果掩盖。
