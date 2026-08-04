import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalDocument } from "../components/legal-document";
import { getProductLegalSupplement, getSharedLegalDocument, type LegalDocumentType } from "../lib/legal-documents";

const routes: Record<string, { type?: LegalDocumentType; title: string; description: string }> = {
  terms: { type: "terms_of_service", title: "服务条款", description: "使用 LLMWEB 时适用的服务条款。" },
  privacy: { type: "privacy_policy", title: "隐私政策", description: "LLMWEB 及 SZLK 生态如何处理个人信息。" },
  "cookie-policy": { type: "cookie_policy", title: "Cookie 与追踪政策", description: "Cookie、本地存储与类似技术的使用说明。" },
  "refund-policy": { type: "refund_cancellation_policy", title: "退款与取消政策", description: "购买、取消、退款与法定救济说明。" },
  "data-rights": { type: "data_rights_notice", title: "数据权利说明", description: "个人数据访问、更正、删除和其他权利说明。" },
  "do-not-sell": { type: "do_not_sell_share_notice", title: "不出售或不分享声明", description: "有关个人信息出售、分享和选择退出的说明。" },
  "ai-disclaimer": { type: "ai_entertainment_disclaimer", title: "AI 与娱乐用途免责声明", description: "AI 输出、限制和用户复核责任说明。" },
  "legal-supplement": { title: "LLMWEB 产品法律补充说明", description: "LLMWEB 特有的服务范围、数据边界和使用风险说明。" },
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ legalDocument: string }> }): Promise<Metadata> {
  const { legalDocument } = await params;
  const route = routes[legalDocument];
  if (!route) return {};
  return { title: route.title, description: route.description, alternates: { canonical: `/${legalDocument}` } };
}

export default async function LegalPage({ params }: { params: Promise<{ legalDocument: string }> }) {
  const { legalDocument } = await params;
  const route = routes[legalDocument];
  if (!route) notFound();
  const document = route.type ? await getSharedLegalDocument(route.type) : await getProductLegalSupplement();
  return <LegalDocument title={document.title} effectiveAt={document.effective_at} version={document.version} sections={document.composition.flatMap((part) => part.sections)} />;
}
