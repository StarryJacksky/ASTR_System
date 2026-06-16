// ASTR 情绪 → 环境光（设计的灵魂所在）
// 规范：04_DESIGN_SYSTEM.md §3.2。
// 思路：把她的情绪向量在四个锚点色（孤独/兴奋/傲娇/平静）之间做加权混合，
//      写入 CSS 变量 --astr-emotion-glow。情绪不是一个数字，是"整个房间的光"。
// 变化必须缓慢（配合 tokens.css 的 --dur-slow+ 过渡），让人"感觉到"而非"看到突变"。

/** MaiBot 情绪向量，各分量 0..1（见 P1-W4 / soul/emotion.py）。 */
export interface EmotionVector {
  lonely: number;
  excited: number;
  tsundere: number;
  calm: number;
}

// 四个锚点色，与 tokens.css 的 --emo-* 严格一致。改色时两边同步。
const ANCHORS: Record<keyof EmotionVector, [number, number, number]> = {
  lonely: [0x4c, 0x6f, 0xff], // #4C6FFF 冷蓝
  excited: [0xff, 0x7a, 0x59], // #FF7A59 暖橙
  tsundere: [0xff, 0x5c, 0xa8], // #FF5CA8 品红
  calm: [0x2d, 0xd4, 0xbf], // #2DD4BF 青绿
};

/**
 * 把情绪向量混成一个 rgb() 字符串。
 * 全零（无情绪信号）时回退到平静色，保证永远有合理的环境光。
 */
export function emotionToGlow(v: EmotionVector): string {
  const weights: [keyof EmotionVector, number][] = [
    ["lonely", Math.max(0, v.lonely)],
    ["excited", Math.max(0, v.excited)],
    ["tsundere", Math.max(0, v.tsundere)],
    ["calm", Math.max(0, v.calm)],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  if (total === 0) {
    const [r, g, b] = ANCHORS.calm;
    return `rgb(${r}, ${g}, ${b})`;
  }
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [key, w] of weights) {
    const [ar, ag, ab] = ANCHORS[key];
    const f = w / total;
    r += ar * f;
    g += ag * f;
    b += ab * f;
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * 把混好的情绪光写入 CSS 变量。订阅 soul.decision / heartbeat 的 emotion_delta 后调用。
 * 过渡时长交给 CSS（在用到 --astr-emotion-glow 的元素上设 transition），这里只改值。
 */
export function applyEmotionGlow(
  v: EmotionVector,
  el: HTMLElement = document.documentElement,
): void {
  el.style.setProperty("--astr-emotion-glow", emotionToGlow(v));
}
