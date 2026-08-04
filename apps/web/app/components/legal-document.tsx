import Link from "next/link";
import type { LegalSection } from "../lib/legal-documents";

const internalSectionIds = new Set(["product_display_boundary", "professional_review"]);

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
}

function SectionBody({ body }: { body: string }) {
  return body.split(/\n{2,}/).map((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line))) {
      return <ul key={index}>{lines.map((line) => <li key={line}>{line.replace(/^[-*]\s+/, "")}</li>)}</ul>;
    }
    if (lines.length > 0 && lines.every((line) => /^\d+[.)]\s+/.test(line))) {
      return <ol key={index}>{lines.map((line) => <li key={line}>{line.replace(/^\d+[.)]\s+/, "")}</li>)}</ol>;
    }
    return <p key={index}>{lines.join("\n")}</p>;
  });
}

export function LegalDocument({ title, effectiveAt, version, sections }: { title: string; effectiveAt: string; version: string; sections: LegalSection[] }) {
  const visibleSections = sections.filter((section) => !internalSectionIds.has(section.id));
  return (
    <main className="legalPage">
      <header className="legalNav"><Link className="landingBrand" href="/"><span className="brandMark" aria-hidden="true">L</span><span>LLMWEB</span></Link><Link href="/">返回首页</Link></header>
      <article className="legalDocument">
        <header><p>LLMWEB 法律文件</p><h1>{title}</h1><div><span>生效日期：{formatDate(effectiveAt)}</span><span>版本：{version}</span></div></header>
        <div className="legalNotice">以下内容为当前生效的中文版本。重要服务或数据处理方式发生变化时，本页面会随受管版本更新。</div>
        {visibleSections.map((section) => <section key={section.id}><h2>{section.title}</h2><SectionBody body={section.body_markdown} /></section>)}
      </article>
      <footer className="legalFooter"><Link href="/terms">服务条款</Link><Link href="/privacy">隐私政策</Link><Link href="/cookie-policy">Cookie 政策</Link><Link href="/refund-policy">退款与取消</Link><Link href="/data-rights">数据权利</Link><Link href="/do-not-sell">不出售或不分享</Link><Link href="/ai-disclaimer">AI 免责声明</Link><Link href="/legal-supplement">产品说明</Link></footer>
    </main>
  );
}
