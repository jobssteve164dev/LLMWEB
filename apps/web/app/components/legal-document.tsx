import Link from "next/link";
import { LanguageSwitcher } from "./language-provider";
import { localeTag, type Locale } from "../lib/i18n";
import type { LegalSection } from "../lib/legal-documents";

const internalSectionIds = new Set(["product_display_boundary", "professional_review"]);

function formatDate(value: string, locale: Locale) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(localeTag(locale), { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
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

export function LegalDocument({ locale, title, effectiveAt, version, sections }: { locale: Locale; title: string; effectiveAt: string; version: string; sections: LegalSection[] }) {
  const english = locale === "en";
  const visibleSections = sections.filter((section) => !internalSectionIds.has(section.id));
  return (
    <main className="legalPage">
      <header className="legalNav"><Link className="landingBrand" href="/"><span className="brandMark" aria-hidden="true">L</span><span>LLMWEB</span></Link><div className="legalNavActions"><LanguageSwitcher /><Link href="/">{english ? "Back to home" : "返回首页"}</Link></div></header>
      <article className="legalDocument">
        <header><p>{english ? "LLMWEB Legal" : "LLMWEB 法律文件"}</p><h1>{title}</h1><div><span>{english ? "Effective: " : "生效日期："}{formatDate(effectiveAt, locale)}</span><span>{english ? "Version: " : "版本："}{version}</span></div></header>
        <div className="legalNotice">{english ? "This is the currently effective English version. This page is updated with the governed version when material service or data-processing practices change." : "以下内容为当前生效的中文版本。重要服务或数据处理方式发生变化时，本页面会随受管版本更新。"}</div>
        {visibleSections.map((section) => <section key={section.id}><h2>{section.title}</h2><SectionBody body={section.body_markdown} /></section>)}
      </article>
      <footer className="legalFooter"><Link href="/terms">{english ? "Terms" : "服务条款"}</Link><Link href="/privacy">{english ? "Privacy" : "隐私政策"}</Link><Link href="/cookie-policy">{english ? "Cookie Policy" : "Cookie 政策"}</Link><Link href="/refund-policy">{english ? "Refunds & Cancellations" : "退款与取消"}</Link><Link href="/data-rights">{english ? "Data Rights" : "数据权利"}</Link><Link href="/do-not-sell">{english ? "Do Not Sell or Share" : "不出售或不分享"}</Link><Link href="/ai-disclaimer">{english ? "AI Disclaimer" : "AI 免责声明"}</Link><Link href="/legal-supplement">{english ? "Product Supplement" : "产品说明"}</Link></footer>
    </main>
  );
}
