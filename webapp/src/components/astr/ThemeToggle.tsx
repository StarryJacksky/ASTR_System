"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/** 暗/亮切换。next-themes 需要挂载后再渲染图标，避免 hydration 不一致。 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = theme !== "light";
  return (
    <button
      type="button"
      aria-label="切换主题"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="grid h-8 w-8 place-items-center rounded-lg border border-hairline text-ink-2 transition-colors hover:bg-surface-2"
    >
      {mounted ? dark ? <Moon size={16} /> : <Sun size={16} /> : <span className="h-4 w-4" />}
    </button>
  );
}
