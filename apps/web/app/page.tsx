import type { Metadata } from "next";
import Link from "next/link";
import { LanguageSwitcher } from "./components/language-provider";
import { homeText } from "./lib/home-copy";
import { getRequestLocale } from "./lib/i18n-server";
import { getLlmwebPlanTruth } from "./lib/passport";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return locale === "en"
    ? { title: "Train and fine-tune a model on your own computer", description: "Prepare data, fine-tune with SFT/LoRA/QLoRA, evaluate on the same test set, and export models in one web workbench while raw data stays in your environment.", alternates: { canonical: "/" } }
    : { title: "用自己的电脑完成第一次模型训练与进阶微调", description: "LLMWEB 把数据准备、SFT/LoRA/QLoRA 微调、同测试集评测和模型导出放进一个网页工作台，原始训练数据默认留在你的环境。", alternates: { canonical: "/" } };
}

const workflow = [
  ["定义目标", "先写清模型要完成的任务，以及怎样才算成功。"],
  ["连接算力", "用一次性命令连接普通 Ubuntu 电脑、Linux NVIDIA GPU 或 Apple Silicon Mac。"],
  ["准备数据", "在你的环境中检查格式、重复、长度、切分与泄漏风险。"],
  ["设置训练", "选择模型与速度、质量偏好，系统给出可执行方案。"],
  ["比较结果", "用同一测试集比较基础模型、checkpoint 与微调模型。"],
  ["取得模型", "把 Adapter、合并权重、Hugging Face 或 GGUF 留在自己的存储中。"],
] as const;

const faqs = [
  ["LLMWEB 会上传我的原始训练数据吗？", "默认不会。数据检查、训练和评测在你连接的电脑上执行；网页只接收统计、进度、指标和你主动授权的少量预览。"],
  ["我需要准备什么环境？", "第一次练习可使用 4 核 8G、至少 20GB 可用空间的 Ubuntu 普通电脑；进阶微调可使用 Linux NVIDIA GPU 或 Apple Silicon Mac。"],
  ["支持哪些微调方式？", "支持文本 SFT 与 LoRA；Linux NVIDIA GPU 还支持 4 位 QLoRA。Apple Silicon 使用原生 Metal/MPS LoRA，并提供固定版本的 Qwen2.5 0.5B、1.5B 与 3B 指令模型。"],
  ["怎样判断微调真的有效？", "LLMWEB 会先建立基础模型基线，再用同一测试集复测候选模型；页面同时展示质量变化、推理性能和失败样本，避免只看一条损失曲线。"],
  ["LLMWEB 会托管训练后的模型吗？", "默认不会。模型权重、checkpoint 和导出产物保存在你的 GPU 主机或你自己的 S3 兼容存储中，平台只保留版本、指标和产物引用。"],
] as const;

export default async function HomePage() {
  const locale = await getRequestLocale();
  const t = (value: string) => homeText(locale, value);
  const localizedWorkflow = workflow.map(([title, description]) => [t(title), t(description)] as const);
  const localizedFaqs = faqs.map(([question, answer]) => [t(question), t(answer)] as const);
  const plan = await getLlmwebPlanTruth().catch((error) => {
    console.error("[LLMWEB] Passport public plan unavailable", error);
    return null;
  });
  const softwareSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "LLMWEB",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web; Linux x86_64 CPU or NVIDIA GPU with Docker; macOS on Apple Silicon",
    description: locale === "en" ? "Connect a computer you control to train, prepare data, fine-tune language models, evaluate on the same test set, and export models in a web workbench." : "连接用户自己控制的电脑，在网页中完成入门训练、数据准备、大语言模型微调、同测试集评测和模型导出。",
    inLanguage: locale,
    featureList: locale === "en" ? ["SFT, LoRA, and QLoRA", "Local data checks", "Before-and-after evaluation on the same test set", "Adapter, Hugging Face, and GGUF exports"] : ["SFT、LoRA 与 QLoRA", "本地数据检查", "训练前后同测试集评测", "Adapter、Hugging Face 与 GGUF 导出"],
    ...(plan ? { offers: { "@type": "Offer", price: (plan.amountCents / 100).toFixed(2), priceCurrency: plan.currency.toUpperCase(), availability: "https://schema.org/InStock", url: "https://llmweb.szlk.ai/#pricing" } } : {}),
  };
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: localizedFaqs.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };

  return (
    <main className="landingPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <header className="landingNav">
        <Link className="landingBrand" href="/" aria-label={locale === "en" ? "LLMWEB home" : "LLMWEB 首页"}>
          <span className="brandMark" aria-hidden="true">L</span>
          <span>LLMWEB</span>
        </Link>
        <nav aria-label={locale === "en" ? "Main navigation" : "主要导航"}>
          <a href="#workflow">{t("工作流程")}</a>
          <a href="#data-boundary">{t("数据边界")}</a>
          <a href="#pricing">{t("方案")}</a>
          <a href="#faq">{t("常见问题")}</a>
        </nav>
        <div className="landingNavActions"><LanguageSwitcher /><Link className="navCta" href="/workbench/project">{t("进入工作台")}</Link></div>
      </header>

      <section className="landingHero">
        <div className="heroCopy">
          <p className="landingEyebrow"><span /> {t("从普通电脑入门的模型训练工作台")}</p>
          <h1>{t("把一次模型微调，")}<br />{t("变成一条清晰的网页流程。")}</h1>
          <p className="heroLead">{t("先用一台 4 核 8G Ubuntu 电脑完成第一次模型训练；有 GPU 时，再继续进行 SFT / LoRA / QLoRA 微调。数据检查、训练前后评测和模型导出都在同一条网页流程中完成。")}</p>
          <div className="heroActions">
            <Link className="landingPrimary" href="/workbench/project">{t("开始建立训练项目")} <span aria-hidden="true">→</span></Link>
            <a className="landingSecondary" href="#workflow">{t("查看完整流程")}</a>
          </div>
          <p className="heroRequirement">{t("入门：Ubuntu 4 核 8G · 进阶：Linux NVIDIA GPU 或 Apple Silicon")}</p>
        </div>

        <div className="productPreview" aria-label={locale === "en" ? "LLMWEB workflow preview" : "LLMWEB 工作台流程预览"}>
          <div className="previewTop"><span className="previewLogo">L</span><strong>{locale === "en" ? "Product support assistant" : "产品客服助手"}</strong><i>{t("训练中")}</i></div>
          <div className="previewBody">
            <ol>
              {localizedWorkflow.map(([title], index) => <li className={index < 3 ? "done" : index === 3 ? "current" : ""} key={title}><span>{index < 3 ? "✓" : index + 1}</span>{title}</li>)}
            </ol>
            <div className="previewPanel">
              <span className="previewKicker">{t("当前阶段")}</span>
              <h2>{t("微调模型")}</h2>
              <p>{t("数据版本与基础模型基线已经就绪。")}</p>
              <div className="previewProgress"><i /></div>
              <div className="previewMetrics"><span><small>{t("进度")}</small><strong>64%</strong></span><span><small>{t("验证损失")}</small><strong>0.82</strong></span><span><small>{t("剩余时间")}</small><strong>{t("38 分钟")}</strong></span></div>
              <div className="previewBoundary"><span aria-hidden="true">✓</span><p><strong>{t("原始数据留在你的环境")}</strong><small>{t("网页只接收统计、进度和授权预览")}</small></p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="trustBand" aria-label={locale === "en" ? "Product boundaries" : "产品边界"}>
        <div><strong>{t("数据不搬家")}</strong><span>{t("原始数据、权重与 checkpoint 默认留在你的环境")}</span></div>
        <div><strong>{t("无需开放端口")}</strong><span>{t("连接程序主动访问网页服务，不需要公网 IP 或 SSH")}</span></div>
        <div><strong>{t("结果可核验")}</strong><span>{t("同一测试集对比训练前后，不把“跑完”当“有效”")}</span></div>
      </section>

      <section className="landingSection outcomeSection">
        <header className="landingSectionHeader">
          <p>{t("从训练配置到可用结果")}</p>
          <h2>{t("你负责目标与判断，")}<br />{t("LLMWEB 收起训练流程的复杂度。")}</h2>
          <span>{t("不再在命令、配置文件、日志窗口和零散脚本之间来回切换。每一步都围绕用户要完成的动作，并留下下一步可以依赖的结果。")}</span>
        </header>
        <div className="outcomeGrid">
          <article><span>01</span><h3>{t("先让数据可训练")}</h3><p>{t("在数据离开你的环境之前就完成格式、重复、Token 长度、切分和泄漏检查，并形成不可变的数据版本。")}</p></article>
          <article><span>02</span><h3>{t("让训练过程看得懂")}</h3><p>{t("持续展示阶段、剩余时间、损失、吞吐和 GPU 状态；断开网页不会终止已被主机接受的训练。")}</p></article>
          <article><span>03</span><h3>{t("用证据选择模型")}</h3><p>{t("把基础模型、候选 checkpoint 和历史模型放在同一测试条件下比较，再结合盲测样本与性能代价作决定。")}</p></article>
        </div>
      </section>

      <section className="landingSection workflowSection" id="workflow">
        <header className="landingSectionHeader compact">
          <p>{t("一套连续工作流")}</p>
          <h2>{t("从任务目标，到自己的模型产物。")}</h2>
        </header>
        <ol className="workflowGrid">
          {localizedWorkflow.map(([title, description], index) => <li key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}
        </ol>
      </section>

      <section className="landingSection boundarySection" id="data-boundary">
        <div className="boundaryCopy">
          <p className="landingEyebrow"><span /> {t("数据边界从产品设计开始")}</p>
          <h2>{t("训练发生在你的算力上，")}<br />{t("不是在我们的黑盒里。")}</h2>
          <p>{t("网页负责组织项目、展示统计和推进动作；连接程序在你的主机上检查数据、运行训练、评测和导出。你不需要把 SSH 权限、存储凭证或原始数据交给平台。")}</p>
          <ul>
            <li><span>✓</span>{t("原始训练、验证与测试数据留在用户环境")}</li>
            <li><span>✓</span>{t("模型权重、checkpoint 与导出产物留在用户主机或自己的 S3")}</li>
            <li><span>✓</span>{t("网页只接收完成工作所需的统计、进度、指标与授权预览")}</li>
          </ul>
          <Link href="/legal-supplement">{t("查看 LLMWEB 产品法律补充说明 →")}</Link>
        </div>
        <div className="boundaryDiagram" aria-label={locale === "en" ? "LLMWEB data flow" : "LLMWEB 数据流说明"}>
          <article><span>{t("网页工作台")}</span><strong>{t("目标 · 状态 · 指标")}</strong><small>{t("不保存原始训练数据")}</small></article>
          <div><i /><b>{t("出站连接")}</b><i /></div>
          <article className="local"><span>{t("你的训练电脑")}</span><strong>{t("数据 · 训练 · 模型")}</strong><small>{t("你控制主机与存储位置")}</small></article>
        </div>
      </section>

      <section className="landingSection pricingSection" id="pricing">
        <header className="landingSectionHeader compact"><p>{t("简单透明的方案")}</p><h2>{t("算力属于你，订阅只为更顺畅的训练管理。")}</h2><span>{t("两个方案都使用你自己的电脑和存储；LLMWEB 不收取训练时长或算力费用。")}</span></header>
        {plan ? <div className="pricingGrid">
          <article><span>{locale === "en" ? "Free" : plan.metadata.freeTier.name.zh}</span><h3>${(plan.metadata.freeTier.amountCents / 100).toFixed(0)}</h3><p>{locale === "en" ? "Learn the complete workflow with your own compute and storage." : plan.metadata.freeTier.summary.zh}</p><strong>{plan.metadata.quotas.projects.free}{t("个活跃项目")}</strong><Link className="landingSecondary" href="/workbench/project">{t("开始使用")}</Link></article>
          <article className="featuredPrice"><span>{locale === "en" ? "For active projects" : plan.metadata.customerDisplay.zh.offerLabel}</span><h3>${(plan.amountCents / 100).toFixed(0)} <small>{locale === "en" ? "/ year" : plan.metadata.customerDisplay.zh.billingSuffix}</small></h3><p>{locale === "en" ? "Manage more active training projects with the same data and compute boundaries." : plan.metadata.customerDisplay.zh.summary}</p><strong>{plan.metadata.quotas.projects.paid}{t("个活跃项目")}</strong><Link className="landingPrimary" href="/api/billing/checkout">{t("升级 Pro")} <span aria-hidden="true">→</span></Link></article>
          <p className="pricingBoundary">{locale === "en" ? `GPU, cloud compute, model hosting, and storage are not included · ${plan.metadata.refundDays}-day refund period` : `不包含 GPU、云算力、模型托管或存储费用 · ${plan.metadata.refundDays} 天退款期`}</p>
        </div> : <p className="pricingUnavailable">{t("方案暂时无法加载，购买入口已安全关闭；免费工作台不受影响。")}</p>}
      </section>

      <section className="landingSection fitSection">
        <header className="landingSectionHeader compact"><p>{t("适用边界")}</p><h2>{t("选择 LLMWEB，如果你想掌控算力与数据。")}</h2></header>
        <div className="fitGrid">
          <article><span>{t("适合")}</span><h3>{t("个人开发者与小型 AI 团队")}</h3><ul><li>{t("想先用普通 Ubuntu 电脑学会完整训练流程")}</li><li>{t("已有 Linux NVIDIA GPU 或 Apple Silicon Mac")}</li><li>{t("希望减少训练框架和命令行负担")}</li><li>{t("希望模型产物留在自己的基础设施")}</li></ul></article>
          <article className="notFit"><span>{t("暂不适合")}</span><h3>{t("需要托管算力或生产推理的平台")}</h3><ul><li>{t("没有可连接的 Ubuntu、Linux GPU 或 Apple Silicon 电脑")}</li><li>{t("需要 Windows、AMD、Intel GPU 或多机训练")}</li><li>{t("需要 DPO、PPO、GRPO 或多模态训练")}</li><li>{t("希望平台直接托管生产推理服务")}</li></ul></article>
        </div>
      </section>

      <section className="landingSection faqSection" id="faq">
        <header className="landingSectionHeader compact"><p>{t("常见问题")}</p><h2>{t("开始前，你可能还想确认这些。")}</h2></header>
        <div className="faqList">{localizedFaqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
      </section>

      <section className="landingFinal">
        <div><p>{t("准备好开始了吗？")}</p><h2>{t("用自己的电脑，完成一次有证据的模型训练。")}</h2></div>
        <Link className="landingPrimary light" href="/workbench/project">{t("进入工作台")} <span aria-hidden="true">→</span></Link>
      </section>

      <footer className="landingFooter">
        <div><Link className="landingBrand" href="/"><span className="brandMark" aria-hidden="true">L</span><span>LLMWEB</span></Link><p>{t("让模型微调留在你的算力与数据边界里。")}</p></div>
        <nav aria-label={t("法律与产品信息")}><Link href="/terms">{t("服务条款")}</Link><Link href="/privacy">{t("隐私政策")}</Link><Link href="/cookie-policy">{t("Cookie 政策")}</Link><Link href="/refund-policy">{t("退款与取消")}</Link><Link href="/data-rights">{t("数据权利")}</Link><Link href="/do-not-sell">{t("不出售或不分享")}</Link><Link href="/ai-disclaimer">{t("AI 免责声明")}</Link><Link href="/legal-supplement">{t("产品说明")}</Link></nav>
        <p>© {new Date().getUTCFullYear()} <a className="companyLink" href="https://szlk.ai" target="_blank" rel="noopener noreferrer">SZLK LTD</a></p>
      </footer>
    </main>
  );
}
