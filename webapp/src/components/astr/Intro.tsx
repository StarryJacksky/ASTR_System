"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { easeOut } from "@/lib/motion";
import { FlameCore } from "@/components/astr/FlameCore";

/** 启幕（04 v2.1 §6）：开镜仪式。
 *
 *  进入天文台的那 2.4 秒：黑场 → 灵魂的心跳点亮起 → 舰名铭牌"星枢"
 *  从疏排聚拢 → 一条刻线展开 → 幕布掀开露出观测舱。（法则八：铭牌是舰名，不是灵魂名）
 *  每个浏览器会话只演一次（sessionStorage 门闩）；点击即跳过；
 *  prefers-reduced-motion 直接不演。
 */
export function Intro() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const seen = sessionStorage.getItem("astr-intro-seen");
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!seen && !reduced) setShow(true);
      } catch {
        // Storage can be unavailable in privacy-restricted browsing contexts.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const dismiss = () => {
    sessionStorage.setItem("astr-intro-seen", "1");
    setShow(false);
  };

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(dismiss, 2600);
    return () => clearTimeout(t);
  }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          onClick={dismiss}
          className="fixed inset-0 z-[var(--z-modal)] grid cursor-pointer place-items-center"
          style={{ background: "var(--astr-bg)" }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: easeOut } }}
        >
          <div className="flex flex-col items-center gap-7">
            <motion.span
              aria-hidden
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: easeOut }}
            >
              <FlameCore size={20} />
            </motion.span>
            <motion.span
              className="astr-wordmark text-ink"
              style={{ fontSize: "var(--text-2xl)", lineHeight: "var(--leading-head)" }}
              initial={{ opacity: 0, letterSpacing: "0.6em" }}
              animate={{ opacity: 1, letterSpacing: "0.12em" }}
              transition={{ duration: 1.1, ease: easeOut, delay: 0.25 }}
            >
              星枢
            </motion.span>
            <motion.span
              aria-hidden
              className="block h-px"
              style={{ background: "var(--astr-hairline-strong)" }}
              initial={{ width: 0 }}
              animate={{ width: 220 }}
              transition={{ delay: 1.15, duration: 0.7, ease: easeOut }}
            />
            <motion.span
              className="astr-label"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.35, duration: 0.5 }}
            >
              ASTR — 守夜开始
            </motion.span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
