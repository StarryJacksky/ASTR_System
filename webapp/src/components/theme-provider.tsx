"use client";

import { MotionConfig } from "framer-motion";
import { ThemeProvider as NextThemes } from "next-themes";

/** 暗/亮主题（04 §3.1）。data-theme 挂 <html>，默认 dark，不跟随系统（她的房间默认是夜空）。
 *  MotionConfig 是 reduced-motion 的 JS 端保险（04 §6.2-3）：CSS media query 管不到
 *  Framer Motion 的 JS 动画，两端都压住才是真的可访问性。 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes attribute="data-theme" defaultTheme="dark" enableSystem={false}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextThemes>
  );
}
