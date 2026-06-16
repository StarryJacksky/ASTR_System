"use client";

import { motion } from "framer-motion";
import { enter } from "@/lib/motion";

/** 驾驶舱通用面板容器：surface 底 + hairline 边 + 圆角，标题栏可选。glow=她的元素才点亮。 */
export function Panel({
  title,
  right,
  children,
  className = "",
  glow = false,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <motion.section
      variants={enter}
      initial="hidden"
      animate="show"
      className={`flex min-h-0 flex-col rounded-2xl border border-hairline bg-surface ${className}`}
      style={glow ? { boxShadow: "var(--glow-her)" } : undefined}
    >
      {title && (
        <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h2 className="text-sm font-medium text-ink-2">{title}</h2>
          {right}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </motion.section>
  );
}
