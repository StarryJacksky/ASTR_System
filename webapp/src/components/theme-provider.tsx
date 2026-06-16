"use client";

import { ThemeProvider as NextThemes } from "next-themes";

/** 暗/亮主题（04 §3.1）。data-theme 挂 <html>，默认 dark，不跟随系统（她的房间默认是夜空）。 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes attribute="data-theme" defaultTheme="dark" enableSystem={false}>
      {children}
    </NextThemes>
  );
}
