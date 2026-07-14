// ASTR Tailwind 主题映射（把 tokens.css 的 CSS 变量接成 Tailwind 工具类）
// 落点：合并进 webapp/tailwind.config.ts 的 theme.extend（或整体作为 extend 值）。
// 规范：04_DESIGN_SYSTEM.md §2。单一真相源永远是 tokens.css；这里只引用变量，不重定义数值。
// 这样写 `bg-surface text-text-2 rounded-lg shadow-2 duration-base ease-out` 就直接命中 token。

import type { Config } from "tailwindcss";

export const astrThemeExtend: Config["theme"] = {
  extend: {
    colors: {
      bg: "var(--astr-bg)",
      surface: "var(--astr-surface)",
      "surface-2": "var(--astr-surface-2)",
      hairline: "var(--astr-hairline)",
      "hairline-strong": "var(--astr-hairline-strong)",
      text: "var(--astr-text)",
      "text-2": "var(--astr-text-2)",
      "text-3": "var(--astr-text-3)",
      accent: "var(--astr-accent)",
      "accent-2": "var(--astr-accent-2)",
      success: "var(--astr-success)",
      warning: "var(--astr-warning)",
      danger: "var(--astr-danger)",
      "emotion-glow": "var(--astr-emotion-glow)",
    },
    fontFamily: {
      sans: "var(--font-sans)",
      mono: "var(--font-mono)",
    },
    fontSize: {
      xs: "var(--text-xs)",
      sm: "var(--text-sm)",
      base: "var(--text-base)",
      lg: "var(--text-lg)",
      xl: "var(--text-xl)",
      "2xl": "var(--text-2xl)",
      "3xl": "var(--text-3xl)",
    },
    spacing: {
      1: "var(--space-1)",
      2: "var(--space-2)",
      3: "var(--space-3)",
      4: "var(--space-4)",
      6: "var(--space-6)",
      8: "var(--space-8)",
      12: "var(--space-12)",
      16: "var(--space-16)",
      24: "var(--space-24)",
    },
    borderRadius: {
      sm: "var(--radius-sm)",
      md: "var(--radius-md)",
      lg: "var(--radius-lg)",
      xl: "var(--radius-xl)",
      full: "var(--radius-full)",
    },
    boxShadow: {
      1: "var(--shadow-1)",
      2: "var(--shadow-2)",
      3: "var(--shadow-3)",
      her: "var(--glow-her)",
    },
    transitionDuration: {
      fast: "120ms",
      base: "200ms",
      slow: "320ms",
    },
    transitionTimingFunction: {
      out: "cubic-bezier(0.16, 1, 0.3, 1)",
      inout: "cubic-bezier(0.65, 0, 0.35, 1)",
    },
    zIndex: {
      base: "0",
      panel: "10",
      live2d: "20",
      overlay: "100",
      toast: "200",
      modal: "300",
    },
    keyframes: {
      breath: {
        "0%, 100%": { opacity: "0.85", transform: "scale(1)" },
        "50%": { opacity: "1", transform: "scale(1.02)" },
      },
    },
    animation: {
      breath: "breath var(--dur-breath) ease-in-out infinite",
    },
  },
};

// 用法（webapp/tailwind.config.ts）：
//   import { astrThemeExtend } from "./src/styles/tailwind.tokens";
//   export default { content: [...], theme: astrThemeExtend } satisfies Config;
