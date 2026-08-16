import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalDocument } from "../components/legal-document";
import { getProductLegalSupplement, getSharedLegalDocument, type LegalDocumentType } from "../lib/legal-documents";
import { getRequestLocale } from "../lib/i18n-server";

const routes: Record<string, { type?: LegalDocumentType; zh: [string, string]; en: [string, string] }> = {
  terms: { type: "terms_of_service", zh: ["服务条款", "使用 LLMWEB 时适用的服务条款。"], en: ["Terms of Service", "Terms that apply when using LLMWEB."] },
  privacy: { type: "privacy_policy", zh: ["隐私政策", "LLMWEB 及 SZLK 生态如何处理个人信息。"], en: ["Privacy Policy", "How LLMWEB and the SZLK ecosystem handle personal information."] },
  "cookie-policy": { type: "cookie_policy", zh: ["Cookie 与追踪政策", "Cookie、本地存储与类似技术的使用说明。"], en: ["Cookie and Tracking Policy", "How cookies, local storage, and similar technologies are used."] },
  "refund-policy": { type: "refund_cancellation_policy", zh: ["退款与取消政策", "购买、取消、退款与法定救济说明。"], en: ["Refund and Cancellation Policy", "Purchases, cancellations, refunds, and statutory remedies."] },
  "data-rights": { type: "data_rights_notice", zh: ["数据权利说明", "个人数据访问、更正、删除和其他权利说明。"], en: ["Data Rights Notice", "Access, correction, deletion, and other personal-data rights."] },
  "do-not-sell": { type: "do_not_sell_share_notice", zh: ["不出售或不分享声明", "有关个人信息出售、分享和选择退出的说明。"], en: ["Do Not Sell or Share Notice", "Information about selling, sharing, and opt-out rights."] },
  "ai-disclaimer": { type: "ai_entertainment_disclaimer", zh: ["AI 与娱乐用途免责声明", "AI 输出、限制和用户复核责任说明。"], en: ["AI Disclaimer", "AI outputs, limitations, and user review responsibilities."] },
  "legal-supplement": { zh: ["LLMWEB 产品法律补充说明", "LLMWEB 特有的服务范围、数据边界和使用风险说明。"], en: ["LLMWEB Product Legal Supplement", "LLMWEB-specific service scope, data boundaries, and usage risks."] },
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ legalDocument: string }> }): Promise<Metadata> {
  const { legalDocument } = await params;
  const route = routes[legalDocument];
  if (!route) return {};
  const locale = await getRequestLocale();
  const [title, description] = locale === "en" ? route.en : route.zh;
  return { title, description, alternates: { canonical: `/${legalDocument}` } };
}

export default async function LegalPage({ params }: { params: Promise<{ legalDocument: string }> }) {
  const { legalDocument } = await params;
  const route = routes[legalDocument];
  if (!route) notFound();
  const locale = await getRequestLocale();
  const document = route.type ? await getSharedLegalDocument(route.type, locale) : await getProductLegalSupplement(locale);
  return <LegalDocument locale={locale} title={document.title} effectiveAt={document.effective_at} version={document.version} sections={document.composition.flatMap((part) => part.sections)} />;
}
