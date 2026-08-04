import type { Metadata } from "next";
import { Noto_Sans_SC } from "next/font/google";
import { getSiteUrl } from "./lib/site";
import "./globals.css";

const notoSansSC = Noto_Sans_SC({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-noto-sans-sc",
  weight: ["400", "600", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: { default: "LLMWEB｜自带 GPU 的大语言模型微调工作台", template: "%s｜LLMWEB" },
  description: "连接自己的 GPU，在网页中完成数据准备、模型微调、同测试集评测与模型导出；原始训练数据默认留在你的环境。",
  applicationName: "LLMWEB",
  keywords: ["大语言模型微调", "LoRA", "QLoRA", "SFT", "模型评测", "自带 GPU"],
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "LLMWEB",
    title: "LLMWEB｜自带 GPU 的大语言模型微调工作台",
    description: "用自己的 GPU，在网页中完成数据准备、模型微调、效果评测和导出。",
  },
  twitter: { card: "summary", title: "LLMWEB｜自带 GPU 的大语言模型微调工作台", description: "让原始训练数据留在自己的环境，完成可核验的模型微调流程。" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={notoSansSC.variable} lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
