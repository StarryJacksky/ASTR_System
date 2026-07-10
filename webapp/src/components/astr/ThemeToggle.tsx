"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/** 暗/亮切换。图标由 data-theme CSS 选择，服务端和客户端保持同一结构。 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  return (
    <button
      type="button"
      aria-label="切换昼夜主题"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="grid h-8 w-8 place-items-center rounded-lg border border-hairline text-ink-2 transition-colors hover:bg-surface-2"
    >
      <span data-theme={resolvedTheme} className="data-[theme=light]:hidden">
        <Moon size={16} />
      </span>
      <span data-theme={resolvedTheme} className="hidden data-[theme=light]:block">
        <Sun size={16} />
      </span>
    </button>
  );
}
