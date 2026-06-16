// ASTR 动效语言（全局共享 variants）
// 规范：04_DESIGN_SYSTEM.md §6。
// 铁律：禁止在组件里逐个重写时长/缓动——一律引用这里的 token，与 tokens.css 的 --dur-*/--ease-* 同源。

import type { Variants, Transition } from "framer-motion";

/** expo-out，对应 tokens.css 的 --ease-out。进场动效统一用它。 */
export const easeOut = [0.16, 1, 0.3, 1] as const;

/** 单元素进场：轻微上移 + 淡入，200ms（--dur-base）。 */
export const enter: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: easeOut } },
};

/** 列表/发言流容器：子项错峰 40ms 入场（04 §5 RoundtableFeed / MessageTimeline）。 */
export const staggerList: Variants = {
  show: { transition: { staggerChildren: 0.04 } },
};

/** 物理感跟随（Live2D 视线、拖拽、看板娘）——用 spring，不要用固定时长。 */
export const springSoft: Transition = { type: "spring", stiffness: 320, damping: 30 };

/** 微反馈（hover/press）≤ --dur-fast。 */
export const tapFeedback = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
  transition: { duration: 0.12, ease: easeOut },
} as const;
