import "server-only";
import type { Locale } from "./i18n";

export type LegalDocumentType =
  | "terms_of_service"
  | "privacy_policy"
  | "cookie_policy"
  | "refund_cancellation_policy"
  | "data_rights_notice"
  | "do_not_sell_share_notice"
  | "ai_entertainment_disclaimer";

export type LegalSection = { id: string; title: string; body_markdown: string };

type SharedLegalDocument = {
  type: LegalDocumentType;
  title: string;
  version: string;
  effective_at: string;
  publication_status: string;
  composition: Array<{ scope: "ecosystem_common"; sections: LegalSection[] }>;
};

type ProductLegalSupplement = {
  type: "product_legal_supplement";
  title: string;
  version: string;
  effective_at: string;
  publication_status: string;
  product: { id: string; name: string; domain: string; category: string };
  composition: Array<{ scope: "product_specific"; sections: LegalSection[] }>;
};

const legalBaseUrl = process.env.SZLKLAWS_BASE_URL || "https://laws.szlk.ai";
const productId = "llmweb";

async function fetchLegal<T>(path: string, key: "document" | "supplement", locale: Locale): Promise<T> {
  const response = await fetch(`${legalBaseUrl}${path}`, { cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(locale === "en" ? `The legal document is temporarily unavailable (${response.status}).` : `法律文件暂时无法读取（${response.status}）。`);
  const payload = await response.json() as { success: boolean; document?: T; supplement?: T; error?: { message?: string } };
  const value = payload[key];
  if (!payload.success || !value) throw new Error(payload.error?.message || (locale === "en" ? "The legal document is temporarily unavailable." : "法律文件暂时无法读取。"));
  return value;
}

export function getSharedLegalDocument(type: LegalDocumentType, locale: Locale) {
  const query = new URLSearchParams({ product: productId, type, locale });
  return fetchLegal<SharedLegalDocument>(`/api/legal/document?${query}`, "document", locale);
}

export function getProductLegalSupplement(locale: Locale) {
  const query = new URLSearchParams({ product: productId, locale });
  return fetchLegal<ProductLegalSupplement>(`/api/legal/product-supplement?${query}`, "supplement", locale);
}
