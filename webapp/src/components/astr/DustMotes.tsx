"use client";

import { useEffect, useRef } from "react";

/** 光柱浮尘（04 v2.1 宇宙层）：只存在于她的顶光锥里的悬浮微尘。
 *
 *  天文台里那束光之所以"真"，是因为尘埃在光里缓慢上浮——这是她的
 *  空间的质感，属于"她的元素"（法则一光权限内）。锥外不画一粒。
 *
 *  纪律：颜色取运行时 token；reduced-motion 不渲染（纯氛围，可整体降级）；
 *  document.hidden 挂起；DPR 上限 2。
 */

interface Mote {
  /** 相对坐标 0..1（x 相对锥轴对称展开，y 从顶部往下） */
  x: number;
  y: number;
  r: number;
  /** 上浮速度（相对高度/秒） */
  vy: number;
  drift: number;
  phase: number;
}

function parseColor(raw: string): [number, number, number] {
  const s = raw.trim();
  const hex = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [200, 205, 215];
}

const COUNT = 48;

export function DustMotes() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let w = 0;
    let h = 0;
    let raf = 0;
    let alive = true;
    let last = 0;
    let glowRGB: [number, number, number] = [61, 245, 196];

    const readToken = () => {
      glowRGB = parseColor(
        getComputedStyle(document.documentElement).getPropertyValue("--astr-emotion-glow"),
      );
    };
    readToken();
    const tokenTimer = setInterval(readToken, 500);

    const motes: Mote[] = Array.from({ length: COUNT }, () => ({
      x: Math.random() * 2 - 1,
      y: Math.random(),
      r: 0.5 + Math.random() * 1.1,
      vy: 0.008 + Math.random() * 0.02,
      drift: (Math.random() - 0.5) * 0.012,
      phase: Math.random() * Math.PI * 2,
    }));

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /** 光锥：顶点在 (0.5w, -0.05h)，向下张开到底部约 0.9w 宽。返回该高度的半宽（px）。 */
    const coneHalf = (y: number) => w * (0.07 + 0.38 * (y / Math.max(1, h)));

    const draw = (t: number) => {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
      last = t;
      ctx.clearRect(0, 0, w, h);
      const [r, g, b] = glowRGB;
      const light = document.documentElement.getAttribute("data-theme") === "light";
      for (const m of motes) {
        m.y -= m.vy * dt * 8; // 尘埃在光里缓慢上浮
        m.x += m.drift * dt;
        if (m.y < -0.02 || Math.abs(m.x) > 1.05) {
          m.y = 0.85 + Math.random() * 0.15;
          m.x = Math.random() * 2 - 1;
        }
        const py = m.y * h;
        const half = coneHalf(py);
        const px = w / 2 + m.x * half;
        // 锥心亮、锥缘灭：横向高斯衰减 × 高度衰减（越靠顶光越亮）
        const lateral = Math.exp(-((m.x * 2.2) ** 2));
        const vertical = 1 - m.y * 0.75;
        const twinkle = 0.6 + 0.4 * Math.sin(t / 900 + m.phase);
        const a = 0.5 * lateral * vertical * twinkle * (light ? 0.35 : 1);
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.arc(px, py, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      if (!alive) return;
      if (!document.hidden) draw(t);
      raf = requestAnimationFrame(loop);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    raf = requestAnimationFrame(loop);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearInterval(tokenTimer);
      ro.disconnect();
    };
  }, []);

  // canvas 是替换元素：必须显式 h-full w-full，inset-0 撑不开它
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
