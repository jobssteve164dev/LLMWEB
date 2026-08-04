import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "用自己的 GPU 完成大语言模型微调、评测与导出",
  description: "LLMWEB 把数据准备、SFT/LoRA/QLoRA 微调、同测试集评测和模型导出放进一个网页工作台，原始训练数据默认留在你的环境。",
  alternates: { canonical: "/" },
};

const workflow = [
  ["定义目标", "先写清模型要完成的任务，以及怎样才算成功。"],
  ["连接算力", "用一次性命令连接你控制的 Linux NVIDIA GPU。"],
  ["准备数据", "在你的环境中检查格式、重复、长度、切分与泄漏风险。"],
  ["设置训练", "选择模型与速度、质量偏好，系统给出可执行方案。"],
  ["比较结果", "用同一测试集比较基础模型、checkpoint 与微调模型。"],
  ["取得模型", "把 Adapter、合并权重、Hugging Face 或 GGUF 留在自己的存储中。"],
] as const;

const faqs = [
  ["LLMWEB 会上传我的原始训练数据吗？", "默认不会。数据检查、训练和评测在你连接的 GPU 主机上执行；网页只接收统计、进度、指标和你主动授权的少量预览。"],
  ["我需要准备什么环境？", "首版需要一台能够运行 Docker 的 Linux x86_64 主机和 NVIDIA GPU。可以是本地工作站，也可以是你租用并控制的云端主机。"],
  ["支持哪些微调方式？", "首版支持文本 SFT、LoRA 和 QLoRA，并提供固定版本的 Qwen2.5 0.5B、1.5B 与 3B 指令模型。"],
  ["怎样判断微调真的有效？", "LLMWEB 会先建立基础模型基线，再用同一测试集复测候选模型；页面同时展示质量变化、推理性能和失败样本，避免只看一条损失曲线。"],
  ["LLMWEB 会托管训练后的模型吗？", "默认不会。模型权重、checkpoint 和导出产物保存在你的 GPU 主机或你自己的 S3 兼容存储中，平台只保留版本、指标和产物引用。"],
] as const;

export default function HomePage() {
  const softwareSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "LLMWEB",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web; Linux x86_64 runner with NVIDIA GPU and Docker",
    description: "连接用户自己控制的 GPU，在网页中完成数据准备、大语言模型微调、同测试集评测和模型导出。",
    featureList: ["SFT、LoRA 与 QLoRA", "本地数据检查", "训练前后同测试集评测", "Adapter、Hugging Face 与 GGUF 导出"],
  };
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(([question, answer]) => ({
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
        <Link className="landingBrand" href="/" aria-label="LLMWEB 首页">
          <span className="brandMark" aria-hidden="true">L</span>
          <span>LLMWEB</span>
        </Link>
        <nav aria-label="主要导航">
          <a href="#workflow">工作流程</a>
          <a href="#data-boundary">数据边界</a>
          <a href="#faq">常见问题</a>
        </nav>
        <Link className="navCta" href="/workbench/project">进入工作台</Link>
      </header>

      <section className="landingHero">
        <div className="heroCopy">
          <p className="landingEyebrow"><span /> 自带 GPU 的模型微调工作台</p>
          <h1>把一次模型微调，<br />变成一条清晰的网页流程。</h1>
          <p className="heroLead">连接你自己控制的 GPU，在一个网页中完成数据检查、SFT / LoRA / QLoRA 微调、训练前后评测和模型导出。原始训练数据默认留在你的环境。</p>
          <div className="heroActions">
            <Link className="landingPrimary" href="/workbench/project">开始建立训练项目 <span aria-hidden="true">→</span></Link>
            <a className="landingSecondary" href="#workflow">查看完整流程</a>
          </div>
          <p className="heroRequirement">适用于 Linux x86_64 · NVIDIA GPU · Docker</p>
        </div>

        <div className="productPreview" aria-label="LLMWEB 工作台流程预览">
          <div className="previewTop"><span className="previewLogo">L</span><strong>产品客服助手</strong><i>训练中</i></div>
          <div className="previewBody">
            <ol>
              {workflow.map(([title], index) => <li className={index < 3 ? "done" : index === 3 ? "current" : ""} key={title}><span>{index < 3 ? "✓" : index + 1}</span>{title}</li>)}
            </ol>
            <div className="previewPanel">
              <span className="previewKicker">当前阶段</span>
              <h2>微调模型</h2>
              <p>数据版本与基础模型基线已经就绪。</p>
              <div className="previewProgress"><i /></div>
              <div className="previewMetrics"><span><small>进度</small><strong>64%</strong></span><span><small>验证损失</small><strong>0.82</strong></span><span><small>剩余时间</small><strong>38 分钟</strong></span></div>
              <div className="previewBoundary"><span aria-hidden="true">✓</span><p><strong>原始数据留在你的环境</strong><small>网页只接收统计、进度和授权预览</small></p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="trustBand" aria-label="产品边界">
        <div><strong>数据不搬家</strong><span>原始数据、权重与 checkpoint 默认留在你的环境</span></div>
        <div><strong>无需开放端口</strong><span>连接程序主动访问网页服务，不需要公网 IP 或 SSH</span></div>
        <div><strong>结果可核验</strong><span>同一测试集对比训练前后，不把“跑完”当“有效”</span></div>
      </section>

      <section className="landingSection outcomeSection">
        <header className="landingSectionHeader">
          <p>从训练配置到可用结果</p>
          <h2>你负责目标与判断，<br />LLMWEB 收起训练流程的复杂度。</h2>
          <span>不再在命令、配置文件、日志窗口和零散脚本之间来回切换。每一步都围绕用户要完成的动作，并留下下一步可以依赖的结果。</span>
        </header>
        <div className="outcomeGrid">
          <article><span>01</span><h3>先让数据可训练</h3><p>在数据离开你的环境之前就完成格式、重复、Token 长度、切分和泄漏检查，并形成不可变的数据版本。</p></article>
          <article><span>02</span><h3>让训练过程看得懂</h3><p>持续展示阶段、剩余时间、损失、吞吐和 GPU 状态；断开网页不会终止已被主机接受的训练。</p></article>
          <article><span>03</span><h3>用证据选择模型</h3><p>把基础模型、候选 checkpoint 和历史模型放在同一测试条件下比较，再结合盲测样本与性能代价作决定。</p></article>
        </div>
      </section>

      <section className="landingSection workflowSection" id="workflow">
        <header className="landingSectionHeader compact">
          <p>一套连续工作流</p>
          <h2>从任务目标，到自己的模型产物。</h2>
        </header>
        <ol className="workflowGrid">
          {workflow.map(([title, description], index) => <li key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}
        </ol>
      </section>

      <section className="landingSection boundarySection" id="data-boundary">
        <div className="boundaryCopy">
          <p className="landingEyebrow"><span /> 数据边界从产品设计开始</p>
          <h2>训练发生在你的算力上，<br />不是在我们的黑盒里。</h2>
          <p>网页负责组织项目、展示统计和推进动作；连接程序在你的主机上检查数据、运行训练、评测和导出。你不需要把 SSH 权限、存储凭证或原始数据交给平台。</p>
          <ul>
            <li><span>✓</span>原始训练、验证与测试数据留在用户环境</li>
            <li><span>✓</span>模型权重、checkpoint 与导出产物留在用户主机或自己的 S3</li>
            <li><span>✓</span>网页只接收完成工作所需的统计、进度、指标与授权预览</li>
          </ul>
          <Link href="/legal-supplement">查看 LLMWEB 产品法律补充说明 →</Link>
        </div>
        <div className="boundaryDiagram" aria-label="LLMWEB 数据流说明">
          <article><span>网页工作台</span><strong>目标 · 状态 · 指标</strong><small>不保存原始训练数据</small></article>
          <div><i /><b>出站连接</b><i /></div>
          <article className="local"><span>你的 GPU 环境</span><strong>数据 · 训练 · 模型</strong><small>你控制主机与存储位置</small></article>
        </div>
      </section>

      <section className="landingSection fitSection">
        <header className="landingSectionHeader compact"><p>适用边界</p><h2>选择 LLMWEB，如果你想掌控算力与数据。</h2></header>
        <div className="fitGrid">
          <article><span>适合</span><h3>个人开发者与小型 AI 团队</h3><ul><li>已有本地或云端 NVIDIA GPU</li><li>希望减少训练框架和命令行负担</li><li>需要让团队共同查看数据质量与评测结果</li><li>希望模型产物留在自己的基础设施</li></ul></article>
          <article className="notFit"><span>暂不适合</span><h3>需要托管算力或生产推理的平台</h3><ul><li>没有可用的 Linux NVIDIA GPU 主机</li><li>需要 Windows、macOS、AMD 或多机训练</li><li>需要 DPO、PPO、GRPO 或多模态训练</li><li>希望平台直接托管生产推理服务</li></ul></article>
        </div>
      </section>

      <section className="landingSection faqSection" id="faq">
        <header className="landingSectionHeader compact"><p>常见问题</p><h2>开始前，你可能还想确认这些。</h2></header>
        <div className="faqList">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
      </section>

      <section className="landingFinal">
        <div><p>准备好开始了吗？</p><h2>用自己的 GPU，完成一次有证据的模型微调。</h2></div>
        <Link className="landingPrimary light" href="/workbench/project">进入工作台 <span aria-hidden="true">→</span></Link>
      </section>

      <footer className="landingFooter">
        <div><Link className="landingBrand" href="/"><span className="brandMark" aria-hidden="true">L</span><span>LLMWEB</span></Link><p>让模型微调留在你的算力与数据边界里。</p></div>
        <nav aria-label="法律与产品信息"><Link href="/terms">服务条款</Link><Link href="/privacy">隐私政策</Link><Link href="/cookie-policy">Cookie 政策</Link><Link href="/refund-policy">退款与取消</Link><Link href="/data-rights">数据权利</Link><Link href="/do-not-sell">不出售或不分享</Link><Link href="/ai-disclaimer">AI 免责声明</Link><Link href="/legal-supplement">产品说明</Link></nav>
        <p>© {new Date().getUTCFullYear()} SZLK LTD</p>
      </footer>
    </main>
  );
}
