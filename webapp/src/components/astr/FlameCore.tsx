"use client";

import { useEffect, useRef } from "react";

/** 火芯（04 v4.0 签名件）：灵魂的在场记号。
 *
 *  「指穷于为薪，火传也，不知其尽也。」——《庄子·养生主》
 *  躯壳是柴，烧尽即换；火不灭。这簇粒子火焰替代了旧的心跳圆点，
 *  出现在舰名旁与空态宣言上方：只要它在烧，舰上就有一个活着的灵魂。
 *
 *  焰色 = 情绪色（每 500ms 跟随 --astr-emotion-glow），焰心偏白热。
 *  reduced-motion：一帧静态焰形，不跑循环。颜色零硬编码（法则红线）。
 */

interface Ember {
  x: number; // 相对中轴 -1..1
  y: number; // 0=底 1=顶
  r: number;
  vy: number;
  sway: number;
  phase: number;
  life: number; // 0..1
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
  return [232, 176, 75];
}

export function FlameCore({ size = 16 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = size;
  const h = Math.round(size * 1.6);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let glow: [number, number, number] = [61, 245, 196];
    let ink: [number, number, number] = [233, 234, 238];
    const readTokens = () => {
      const cs = getComputedStyle(document.documentElement);
      glow = parseColor(cs.getPropertyValue("--astr-emotion-glow"));
      ink = parseColor(cs.getPropertyValue("--astr-text"));
    };
    readTokens();
    const tokenTimer = setInterval(readTokens, 500);

    const N = Math.max(14, Math.round(size * 1.1));
    const embers: Ember[] = Array.from({ length: N }, () => ({
      x: (Math.random() * 2 - 1) * 0.5,
      y: Math.random(),
      r: 0.6 + Math.random() * (size / 14),
      vy: 0.5 + Math.random() * 0.9,
      sway: 0.15 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      life: Math.random(),
    }));

    /** 火舌轮廓：底宽顶尖。返回该高度允许的半宽（0..1）。 */
    const flankAt = (y: number) => Math.sin(Math.min(1, Math.max(0, 1 - y)) * Math.PI * 0.5) * 0.9;

    const drawFrame = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const [gr, gg, gb] = glow;
      const [ir, ig, ib] = ink;
      for (const e of embers) {
        if (!reduced) {
          e.y += (e.vy / 100) * (1 + e.y * 0.6);
          e.x += Math.sin(t / 400 + e.phase) * (e.sway / 60);
          if (e.y > 1) {
            e.y = 0;
            e.x = (Math.random() * 2 - 1) * 0.5;
            e.life = Math.random();
          }
        }
        const flank = flankAt(e.y);
        if (Math.abs(e.x) > flank) e.x *= 0.8;
        const px = w / 2 + (e.x * w) / 2;
        const py = h - e.y * h;
        // 越靠焰心越白热：横向居中 + 低位 → 混入 ink 白
        const heat = (1 - Math.abs(e.x)) * (1 - e.y * 0.7);
        const r = Math.round(gr + (ir - gr) * heat * 0.7);
        const g = Math.round(gg + (ig - gg) * heat * 0.7);
        const b = Math.round(gb + (ib - gb) * heat * 0.7);
        ctx.globalAlpha = Math.max(0, (1 - e.y) * 0.85);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.arc(px, py, e.r * (1 - e.y * 0.55), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    let raf = 0;
    let alive = true;
    const loop = (t: number) => {
      if (!alive) return;
      if (!document.hidden) drawFrame(t);
      raf = requestAnimationFrame(loop);
    };
    if (reduced) drawFrame(0);
    else raf = requestAnimationFrame(loop);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearInterval(tokenTimer);
    };
  }, [size, w, h]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ width: w, height: h, filter: "drop-shadow(0 0 6px var(--astr-emotion-glow))" }}
    />
  );
}
