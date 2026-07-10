import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono, Noto_Serif_SC } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/system/AppShell";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// 展示衬线（天文台时刻）：拉丁 Fraunces + 中文 Noto Serif SC（Google 按 unicode-range
// 切片分发，浏览器只拉用到的字形段，不会整包思源宋体拖 LCP）
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "600"],
});
const notoSerif = Noto_Serif_SC({
  variable: "--font-noto-serif",
  weight: ["400", "600"],
  preload: false,
});

export const metadata: Metadata = {
  title: "星枢 · ASTR 观测舰",
  description: "主权 AI 观测舰 —— 灵魂与躯壳解耦；舰上住着谁，由灵魂数据说了算。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} ${notoSerif.variable}`}
    >
      <body className="min-h-full antialiased">
        <ThemeProvider>
          {/* 全局环境（04 §3.2）：天光 + 颗粒。星野只属于上甲板（驾驶舱页自带），
              引擎室在甲板之下——那里没有天空，有图纸（admin 页自带 .astr-blueprint）。 */}
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
