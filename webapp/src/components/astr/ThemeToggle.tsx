"use client";

import { SunMoon } from "lucide-react";
import { useTheme } from "next-themes";

/** Day/night changes material only; geometry and meaning remain identical. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme !== "light";

  return (
    <button
      type="button"
      aria-label="切换昼夜主题"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="grid place-items-center rounded-lg border border-hairline text-ink-2 transition-colors hover:bg-surface-2"
      style={{
        minInlineSize: "var(--touch-target)",
        minBlockSize: "var(--touch-target)",
      }}
    >
      <SunMoon size={17} aria-hidden="true" />
    </button>
  );
}
