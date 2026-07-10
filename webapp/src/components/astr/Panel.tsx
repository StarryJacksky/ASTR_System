"use client";

import { motion } from "framer-motion";
import { enter } from "@/lib/motion";

/** 驾驶舱通用面板容器：surface 底 + hairline 边 + 圆角，标题栏可选。
 *  glow=她的元素：渐变发丝线（astr-edge）+ 极淡情绪环境影——光是缘，不是罩。 */
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
      className={`flex min-h-0 flex-col rounded-2xl bg-surface ${
        glow ? "astr-edge astr-emo" : "border border-hairline"
      } ${className}`}
      style={glow ? { boxShadow: "var(--glow-her-3), var(--shadow-2)" } : undefined}
    >
      {title && (
        <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h2 className="astr-label">{title}</h2>
          {right}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </motion.section>
  );
}
