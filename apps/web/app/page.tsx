const steps = [
  { number: "01", title: "连接算力", description: "连接一台由你控制的 Linux NVIDIA GPU。" },
  { number: "02", title: "准备数据", description: "在你的环境中检查、处理并形成数据版本。" },
  { number: "03", title: "开始训练", description: "使用推荐方案完成首次微调实验。" },
  { number: "04", title: "比较效果", description: "用同一测试集判断模型是否真正提升。" },
];

export default function HomePage() {
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="LLMWEB 首页">
          <span className="brandMark" aria-hidden="true">L</span>
          <span>LLMWEB</span>
        </a>
        <span className="privacyNote">训练数据留在你的环境</span>
      </header>

      <section className="hero" id="top">
        <div className="heroCopy">
          <p className="eyebrow">自带 GPU 的模型训练工作台</p>
          <h1>连接算力，<br />把模型练成你需要的样子。</h1>
          <p className="lead">
            从数据检查、参数微调到效果评测和模型导出，在一个网页中完成。你的原始训练数据无需上传平台。
          </p>
          <div className="heroActions">
            <a className="primaryAction" href="#start">开始第一个项目</a>
            <a className="secondaryAction" href="#workflow">查看完整流程</a>
          </div>
        </div>

        <aside className="statusCard" aria-label="首版支持范围">
          <div className="statusHeader">
            <span className="statusDot" aria-hidden="true" />
            <span>首版能力</span>
          </div>
          <dl>
            <div><dt>算力</dt><dd>Linux · NVIDIA · Docker</dd></div>
            <div><dt>训练</dt><dd>SFT · LoRA · QLoRA</dd></div>
            <div><dt>数据</dt><dd>本地处理，不离开用户环境</dd></div>
            <div><dt>结果</dt><dd>基线对比 · 模型导出</dd></div>
          </dl>
        </aside>
      </section>

      <section className="workflow" id="workflow" aria-labelledby="workflow-title">
        <div className="sectionHeading">
          <p className="eyebrow">一条清晰路径</p>
          <h2 id="workflow-title">训练不是一次命令，而是一个完整结果。</h2>
        </div>
        <div className="stepGrid">
          {steps.map((step) => (
            <article className="stepCard" key={step.number}>
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="startPanel" id="start">
        <div>
          <p className="eyebrow">从可验证的第一步开始</p>
          <h2>先连接一台 GPU，再让数据和训练自然接上。</h2>
        </div>
        <button type="button" disabled aria-describedby="initialization-note">连接算力</button>
        <p id="initialization-note">项目骨架已初始化，算力配对将在首个功能版本开放。</p>
      </section>
    </main>
  );
}
