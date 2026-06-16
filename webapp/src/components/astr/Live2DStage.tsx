"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

// 自托管：Cubism Core 与模型都在 public/ 下，免运行时 CDN 依赖、免 CORS。
const CORE_SRC = "/live2d/core/live2dcubismcore.min.js";
const MODEL_URL = "/live2d/haru/haru_greeter_t03.model3.json";

/** 注入并等待 Cubism Core 脚本就绪（Live2DCubismCore 全局）。 */
function loadCubismCore(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { Live2DCubismCore?: unknown };
    if (w.Live2DCubismCore) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CORE_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("core error")));
      return;
    }
    const s = document.createElement("script");
    s.src = CORE_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("core load failed"));
    document.head.appendChild(s);
  });
}

/** 情绪背光层（Live2D 与 fallback 共用）。 */
function EmotionBacklight() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        background: "radial-gradient(circle at 50% 42%, var(--astr-emotion-glow), transparent 68%)",
        opacity: 0.2,
        transition: "background var(--dur-slow) var(--ease-inout)",
      }}
    />
  );
}

/** 加载失败时的呼吸占位（WebGL 不可用 / 模型缺失都不至于白屏）。 */
function FallbackOrb({ emotionLabel }: { emotionLabel?: string }) {
  return (
    <div className="relative flex h-full min-h-[220px] items-center justify-center overflow-hidden rounded-2xl">
      <EmotionBacklight />
      <motion.div
        className="relative flex h-40 w-40 items-center justify-center rounded-full border border-hairline bg-surface-2 text-center text-ink-3"
        animate={{ scale: [1, 1.02, 1], opacity: [0.9, 1, 0.9] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        style={{ boxShadow: "var(--glow-her)" }}
      >
        <span className="px-3 text-xs leading-relaxed">
          秋秋{emotionLabel ? ` · ${emotionLabel}` : ""}
        </span>
      </motion.div>
    </div>
  );
}

/** Live2D 舞台（04 §5）：自托管 Haru 模型 + 呼吸/idle 动作 + 情绪背光。加载失败优雅降级到呼吸占位。 */
export function Live2DStage({ emotionLabel }: { emotionLabel?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        await loadCubismCore();
        const PIXI = await import("pixi.js");
        (window as unknown as { PIXI?: unknown }).PIXI = PIXI; // pixi-live2d-display 需能找到 pixi
        const { Live2DModel } = await import("pixi-live2d-display-lipsyncpatch/cubism4");
        // pixi-live2d-display 自带一套 @pixi/* 类型，与本项目 pixi v7 类型树不同源，
        // 运行时兼容但 TS 视为不同类型——在两处跨树边界做窄转换。
        type TickerArg = Parameters<typeof Live2DModel.registerTicker>[0];
        Live2DModel.registerTicker(PIXI.Ticker as unknown as TickerArg);

        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const app = new PIXI.Application({
          view: canvas,
          resizeTo: canvas.parentElement ?? undefined,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
        });

        const model = await Live2DModel.from(MODEL_URL, { autoInteract: false });
        if (cancelled) {
          model.destroy();
          app.destroy(true);
          return;
        }
        app.stage.addChild(model as unknown as Parameters<typeof app.stage.addChild>[0]);
        model.anchor.set(0.5, 1);

        const fit = () => {
          const { width, height } = app.screen;
          const scale = Math.min(width / model.width, height / model.height) * 1.6;
          model.scale.set(scale);
          model.position.set(width / 2, height);
        };
        fit();
        const ro = new ResizeObserver(fit);
        if (canvas.parentElement) ro.observe(canvas.parentElement);

        cleanup = () => {
          ro.disconnect();
          model.destroy();
          app.destroy(true);
        };
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  if (failed) return <FallbackOrb emotionLabel={emotionLabel} />;

  return (
    <div className="relative h-full min-h-[220px] overflow-hidden rounded-2xl">
      <EmotionBacklight />
      <canvas ref={canvasRef} className="relative h-full w-full" />
    </div>
  );
}
