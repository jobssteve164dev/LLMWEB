import type { Metadata } from "next";
import { Noto_Sans_SC } from "next/font/google";
import "./globals.css";

const notoSansSC = Noto_Sans_SC({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-noto-sans-sc",
  weight: ["400", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "LLMWEB",
  description: "连接自己的 GPU，完成数据准备、模型训练、效果评测与导出。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={notoSansSC.variable} lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
