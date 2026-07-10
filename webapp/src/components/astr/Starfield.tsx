"use client";

import { useEffect, useRef } from "react";

/** 星野（04 v2.1 宇宙层）：Canvas 三层视差星空 + 情绪星云。
 *
 *  三层运动学的最外层——天空以"地质时间"运动：星的漂移以分钟计、
 *  星云以呼吸计；鼠标视差给出真实景深（近星动得多，远星几乎不动）。
 *  仪器不动，天在转，她在呼吸——这就是这间天文台的宇宙论。
 *
 *  纪律：
 *  - 颜色全部取自运行时 token（--astr-text / --astr-emotion-glow），canvas 也不硬编码；
 *  - 亮色主题不画（白天看不见星星）；
 *  - prefers-reduced-motion → 只画一帧静态星空，不跑循环；
 *  - 页面不可见（document.hidden）→ 循环挂起，不烧后台帧。
 */

interface Star {
  x: number;
  y: number;
  /** 深度 0.3(远)–1(近)：决定大小/亮度/视差/漂移速度 */
  z: number;
  r: number;
  /** 闪烁相位与速率 */
  phase: number;
  speed: number;
}

/** 解析 token 颜色（支持 #rrggbb 与 rgb(r,g,b)）为 [r,g,b]。解析失败回退灰白。 */
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

export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let alive = true;
    let stars: Star[] = [];
    // 鼠标视差（-0.5..0.5），慢速 lerp——望远镜有质量，不是激光笔
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    // token 颜色缓存（每 500ms 刷新一次，跟随情绪光迁移）
    let starRGB: [number, number, number] = [200, 205, 215];
    let glowRGB: [number, number, number] = [61, 245, 196];

    const readTokens = () => {
      const cs = getComputedStyle(document.documentElement);
      starRGB = parseColor(cs.getPropertyValue("--astr-text"));
      glowRGB = parseColor(cs.getPropertyValue("--astr-emotion-glow"));
    };
    readTokens();
    const tokenTimer = setInterval(readTokens, 500);

    const seed = () => {
      const count = Math.min(360, Math.round((w * h) / 5200));
      stars = Array.from({ length: count }, () => {
        const z = 0.3 + Math.random() ** 1.6 * 0.7;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          z,
          r: 0.4 + z * 1.1,
          phase: Math.random() * Math.PI * 2,
          speed: 0.4 + Math.random() * 0.8,
        };
      });
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      if (reduced) draw(0); // 静帧模式下 resize 也要重画一次
    };

    // 流星（v2.2）：40–100s 一颗，划过上半天区 ~900ms。罕见才珍贵。
    let meteor: { x: number; y: number; vx: number; vy: number; born: number } | null = null;
    let nextMeteorAt = 9000 + Math.random() * 26000; // 开屏 9–35s 内先来一颗
    const meteorLife = 900;

    const drawMeteor = (t: number) => {
      if (!meteor && t > nextMeteorAt) {
        const ang = Math.PI * (0.12 + Math.random() * 0.2); // 缓角下坠
        const speed = 0.55 + Math.random() * 0.35; // px/ms
        meteor = {
          x: w * (0.1 + Math.random() * 0.7),
          y: h * (0.04 + Math.random() * 0.22),
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          born: t,
        };
      }
      if (!meteor) return;
      const age = t - meteor.born;
      if (age > meteorLife) {
        meteor = null;
        nextMeteorAt = t + 40_000 + Math.random() * 60_000;
        return;
      }
      const px = meteor.x + meteor.vx * age;
      const py = meteor.y + meteor.vy * age;
      const tail = 86;
      const tx = px - (meteor.vx / Math.hypot(meteor.vx, meteor.vy)) * tail;
      const ty = py - (meteor.vy / Math.hypot(meteor.vx, meteor.vy)) * tail;
      const [sr, sg, sb] = starRGB;
      const fade = Math.sin((Math.PI * age) / meteorLife); // 亮起再熄灭
      const grad = ctx.createLinearGradient(tx, ty, px, py);
      grad.addColorStop(0, `rgba(${sr},${sg},${sb},0)`);
      grad.addColorStop(1, `rgba(${sr},${sg},${sb},${(0.85 * fade).toFixed(3)})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(px, py);
      ctx.stroke();
    };

    const nebula = (t: number) => {
      // 两团情绪星云，呼吸期 ~14s / 漂移期 ~90s——地质时间
      const [r, g, b] = glowRGB;
      const spots: [number, number, number, number][] = [
        [w * (0.72 + 0.05 * Math.sin(t / 90_000)), h * 0.16, w * 0.42, 0.055],
        [w * (0.16 + 0.04 * Math.cos(t / 110_000)), h * 0.78, w * 0.36, 0.04],
      ];
      for (const [cx, cy, rad, base] of spots) {
        const a = base * (0.75 + 0.25 * Math.sin(t / 14_000));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grad.addColorStop(0, `rgba(${r},${g},${b},${a.toFixed(4)})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      // 白天没有星星（亮色主题 = 观测台的白天）
      if (document.documentElement.getAttribute("data-theme") === "light") return;
      nebula(t);
      const [sr, sg, sb] = starRGB;
      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;
      for (const s of stars) {
        // 漂移（近星快）+ 视差（近星偏移大）
        if (!reduced) {
          s.x += s.z * 0.0065;
          if (s.x > w + 2) s.x = -2;
        }
        const px = s.x + mouse.x * 22 * s.z;
        const py = s.y + mouse.y * 14 * s.z;
        const tw = reduced ? 0.75 : 0.45 + 0.55 * Math.abs(Math.sin(t / 1000 * s.speed + s.phase));
        ctx.globalAlpha = tw * (0.22 + 0.6 * s.z);
        ctx.fillStyle = `rgb(${sr},${sg},${sb})`;
        ctx.beginPath();
        ctx.arc(px, py, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduced) drawMeteor(t);
    };

    const loop = (t: number) => {
      if (!alive) return;
      if (!document.hidden) draw(t);
      raf = requestAnimationFrame(loop);
    };

    const onMouse = (e: MouseEvent) => {
      mouse.tx = e.clientX / Math.max(1, w) - 0.5;
      mouse.ty = e.clientY / Math.max(1, h) - 0.5;
    };

    resize();
    // ResizeObserver 而非 window resize：兼治"CSS 类晚于挂载生效"的竞态
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    if (!reduced) {
      window.addEventListener("mousemove", onMouse, { passive: true });
      raf = requestAnimationFrame(loop);
    } else {
      draw(0);
    }

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearInterval(tokenTimer);
      ro.disconnect();
      window.removeEventListener("mousemove", onMouse);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="astr-starfield" />;
}
