"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLive2D } from "@/lib/live2dStore";
import { DustMotes } from "@/components/astr/DustMotes";

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
  // 一束天光（三合一定稿）：从舞台顶垂落的情绪光，她=天文台里被照亮的存在
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(48% 80% at 50% 0%, color-mix(in srgb, var(--astr-emotion-glow) 34%, transparent), transparent 86%)",
        transition: "background var(--dur-emotion) var(--ease-inout)",
        animation: "astr-breath var(--dur-breath) ease-in-out infinite",
      }}
    />
  );
}

function AstrolabeRings() {
  // 星盘（v2.2 宇宙层）：她背后的天文仪刻度环，以地质时间反向缓转；
  // 轨道上一颗情绪色卫星巡行。仪器刻线 + 她的光，两层各守其色。
  const ticks = Array.from({ length: 60 }, (_, i) => (i * 360) / 60);
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 400"
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-50"
    >
      {/* 外环 + 刻度：240s/圈 */}
      <g style={{ transformOrigin: "200px 195px", animation: "astr-spin 240s linear infinite" }}>
        <circle cx="200" cy="195" r="152" fill="none" stroke="var(--astr-hairline)" strokeWidth="1" />
        {ticks.map((deg) => (
          <line
            key={deg}
            x1="200"
            y1="43"
            x2="200"
            y2={deg % 90 === 0 ? 51 : 47}
            stroke="var(--astr-hairline-strong)"
            strokeWidth="1"
            transform={`rotate(${deg} 200 195)`}
          />
        ))}
      </g>
      {/* 内环：反向 90s/圈 */}
      <g
        style={{
          transformOrigin: "200px 195px",
          animation: "astr-spin 90s linear infinite reverse",
        }}
      >
        <circle
          cx="200"
          cy="195"
          r="118"
          fill="none"
          stroke="var(--astr-hairline)"
          strokeWidth="1"
          strokeDasharray="2 7"
        />
      </g>
      {/* 她的卫星：48s/圈 巡行在情绪色轨道上 */}
      <g style={{ transformOrigin: "200px 195px", animation: "astr-spin 48s linear infinite" }}>
        <circle cx="200" cy="60" r="2.4" fill="var(--astr-emotion-glow)" className="astr-emo" />
        <circle
          cx="200"
          cy="60"
          r="6"
          fill="var(--astr-emotion-glow)"
          fillOpacity="0.18"
          className="astr-emo"
        />
      </g>
    </svg>
  );
}

function StageFade() {
  // 舞台底部融进观测柱底色（--astr-bg），她与房间无缝——不是"盒子里的立绘"
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
      style={{ background: "linear-gradient(to top, var(--astr-bg), transparent)" }}
    />
  );
}

function FallbackOrb({ emotionLabel }: { emotionLabel?: string }) {
  return (
    <div className="relative flex h-full min-h-[240px] items-center justify-center">
      <EmotionBacklight />
      <motion.div
        className="relative flex h-40 w-40 items-center justify-center rounded-full border border-hairline bg-surface-2 text-center text-ink-3"
        animate={{ scale: [1, 1.02, 1], opacity: [0.9, 1, 0.9] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        style={{ boxShadow: "var(--glow-her-2)" }}
      >
        <span className="px-3 text-xs leading-relaxed">
          {emotionLabel ?? "…"}
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
        const model = await Live2DModel.from(MODEL_URL, {
          autoHitTest: false,
          autoFocus: false,
        });
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
  }, []);

  // 滑块改变 → 实时套用到模型。
  useEffect(() => {
    applyTransform();
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

  // 高度随龛（v5.0 篝火构图：中央龛由上庭定高）+ canvas 绝对定位（脱离文档流），
  // 杜绝 canvas↔父容器尺寸反馈环。无圆角无裁切（法则六）：灵魂不在盒子里，光可以漫出来。
  return (
    <div className="relative h-full min-h-[240px]">
      <EmotionBacklight />
      {/* 星盘：在她身后缓转的天文仪（v2.2 宇宙层） */}
      <AstrolabeRings />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {/* 光柱浮尘：悬在她与镜头之间——天文台那束光的质感（v2.1 宇宙层） */}
      <DustMotes />
      <StageFade />
    </div>
  );
}
