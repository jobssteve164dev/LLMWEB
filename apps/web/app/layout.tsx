import type { Metadata } from "next";
import { Noto_Sans_SC } from "next/font/google";
import { LanguageProvider } from "./components/language-provider";
import { getRequestLocale } from "./lib/i18n-server";
import { getSiteUrl } from "./lib/site";
import "./globals.css";

const notoSansSC = Noto_Sans_SC({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-noto-sans-sc",
  weight: ["400", "600", "700", "800"],
});

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const english = locale === "en";
  const title = english ? "LLMWEB | Fine-tune language models on your own compute" : "LLMWEB｜自带 GPU 的大语言模型微调工作台";
  const description = english
    ? "Prepare data, fine-tune models, compare results on the same test set, and export artifacts from one web workbench while your raw training data stays in your environment."
    : "连接自己的 GPU，在网页中完成数据准备、模型微调、同测试集评测与模型导出；原始训练数据默认留在你的环境。";
  return {
    metadataBase: getSiteUrl(),
    title: { default: title, template: "%s | LLMWEB" },
    description,
    applicationName: "LLMWEB",
    keywords: english ? ["LLM fine-tuning", "LoRA", "QLoRA", "SFT", "model evaluation", "bring your own GPU"] : ["大语言模型微调", "LoRA", "QLoRA", "SFT", "模型评测", "自带 GPU"],
    openGraph: { type: "website", locale: english ? "en_US" : "zh_CN", siteName: "LLMWEB", title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
  return (
    <html className={notoSansSC.variable} lang={locale}>
      <body><LanguageProvider initialLocale={locale}>{children}</LanguageProvider></body>
    </html>
  );
}
