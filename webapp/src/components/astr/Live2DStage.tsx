"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLive2D } from "@/lib/live2dStore";

// 自托管：Cubism Core 与模型都在 public/ 下，免运行时 CDN 依赖、免 CORS。
const CORE_SRC = "/live2d/core/live2dcubismcore.min.js";
const MODEL_URL = "/live2d/haru/haru_greeter_t03.model3.json";

// pixi-live2d-display 与 pixi v7 类型树不同源，这里用结构化最小接口避免 any。
interface PixiModel {
  anchor: { set: (x: number, y: number) => void };
  scale: { set: (n: number) => void };
  x: number;
  y: number;
  destroy: () => void;
  expression: (index: number | string) => void;
  internalModel: { coreModel: { setParameterValueById: (id: string, v: number) => void } };
}
interface PixiApp {
  screen: { width: number; height: number };
  ticker: { add: (fn: () => void) => void };
  destroy: (removeView: boolean) => void;
}

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

function FallbackOrb({ emotionLabel }: { emotionLabel?: string }) {
  return (
    <div className="relative flex h-72 items-center justify-center overflow-hidden rounded-2xl">
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

/** Live2D 舞台（04 §5）：自托管 Haru 模型 + 情绪背光。取景（缩放/偏移）由 useLive2D 实时驱动，
 *  设置面板可拖动调整并存 localStorage。加载失败优雅降级到呼吸占位。 */
export function Live2DStage({
  emotionLabel,
  expressionIndex,
  speakSignal,
  speakMs,
}: {
  emotionLabel?: string;
  expressionIndex?: number; // 情绪 → 表情切换（Haru F01–F08）
  speakSignal?: number; // 每次她开口变一次（触发嘴动）
  speakMs?: number; // 这次说话的估计时长
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<PixiModel | null>(null);
  const appRef = useRef<PixiApp | null>(null);
  const speakingUntilRef = useRef(0);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const scale = useLive2D((s) => s.scale);
  const x = useLive2D((s) => s.x);
  const y = useLive2D((s) => s.y);

  // 把当前 store 变换套到模型上（居中锚点 + 缩放 + 比例偏移）。resize 时也调用。
  const applyTransform = () => {
    const m = modelRef.current;
    const a = appRef.current;
    if (!m || !a) return;
    const { scale: s, x: ox, y: oy } = useLive2D.getState();
    m.scale.set(s);
    m.x = a.screen.width * (0.5 + ox);
    m.y = a.screen.height * (0.5 + oy);
  };

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        await loadCubismCore();
        const PIXI = await import("pixi.js");
        (window as unknown as { PIXI?: unknown }).PIXI = PIXI;
        const { Live2DModel } = await import("pixi-live2d-display-lipsyncpatch/cubism4");
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
        model.anchor.set(0.5, 0.5);
        modelRef.current = model as unknown as PixiModel;
        appRef.current = app as unknown as PixiApp;
        applyTransform();
        setReady(true);

        // 嘴动：每帧（模型自身更新之后）覆盖 ParamMouthOpenY；说话窗口内一开一合，否则归零。
        app.ticker.add(() => {
          const m = modelRef.current;
          if (!m) return;
          const now = performance.now();
          const open =
            now < speakingUntilRef.current ? 0.45 + 0.45 * Math.abs(Math.sin(now / 55)) : 0;
          try {
            m.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", open);
          } catch {
            /* 该模型无此参数则忽略 */
          }
        });

        const ro = new ResizeObserver(() => applyTransform());
        if (canvas.parentElement) ro.observe(canvas.parentElement);
        cleanup = () => {
          ro.disconnect();
          modelRef.current = null;
          appRef.current = null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 滑块改变 → 实时套用到模型。
  useEffect(() => {
    applyTransform();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, x, y, ready]);

  // 情绪 → 表情切换。
  useEffect(() => {
    if (!ready || expressionIndex == null) return;
    try {
      modelRef.current?.expression(expressionIndex);
    } catch {
      /* 表情不可用忽略 */
    }
  }, [expressionIndex, ready]);

  // 她开口 → 开启一段嘴动窗口。
  useEffect(() => {
    if (!speakSignal) return;
    speakingUntilRef.current = performance.now() + (speakMs ?? 1500);
  }, [speakSignal, speakMs]);

  if (failed) return <FallbackOrb emotionLabel={emotionLabel} />;

  // 固定高度 + canvas 绝对定位（脱离文档流），杜绝 canvas↔父容器尺寸反馈环。
  return (
    <div className="relative h-72 overflow-hidden rounded-2xl">
      <EmotionBacklight />
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
