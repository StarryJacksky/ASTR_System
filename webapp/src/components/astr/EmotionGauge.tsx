"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { animate } from "framer-motion";
import { easeOut } from "@/lib/motion";
import type { SoulEmotion } from "@/lib/types";

/** 情绪计 v2（04 v2.1 §5）：星座仪。
 *
 *  四个情绪维度是四颗锚星（孤独/兴奋/倾诉欲/烦躁），她此刻的状态是
 *  锚星之间张出的一个星座——中心的亮核是她，星座随情绪缓慢形变
 *  （--dur-settle 落针）。这是把"读数"画成"天象"：仪表盘的信息密度，
 *  天文台的世界观。
 *
 *  光权限：星座线/亮核用她的生物荧光（法则一白名单成员）；
 *  网格与刻度是仪器——hairline 与 mono，纹丝不动。
 */

type NumDim = "loneliness" | "excitement" | "talkativeness" | "irritation";

interface DimSpec {
  key: NumDim;
  label: string;
  /** 单位方向（SVG 坐标系，y 向下） */
  dx: number;
  dy: number;
  /** 锚星标签的对齐 */
  anchor: "middle" | "start" | "end";
  labelDx: number;
  labelDy: number;
}

const DIMS: DimSpec[] = [
  { key: "loneliness", label: "孤独", dx: 0, dy: -1, anchor: "middle", labelDx: 0, labelDy: -8 },
  { key: "excitement", label: "兴奋", dx: 1, dy: 0, anchor: "start", labelDx: 9, labelDy: 3 },
  { key: "talkativeness", label: "倾诉欲", dx: 0, dy: 1, anchor: "middle", labelDx: 0, labelDy: 14 },
  { key: "irritation", label: "烦躁", dx: -1, dy: 0, anchor: "end", labelDx: -9, labelDy: 3 },
];

const CX = 130;
const CY = 92;
const R = 68;
const R0 = 7; // 零值也留一点星座的骨架

const clamp01 = (x: number | undefined) => Math.max(0, Math.min(1, x ?? 0));

function pointAt(d: DimSpec, v: number): [number, number] {
  const r = R0 + v * (R - R0);
  return [CX + d.dx * r, CY + d.dy * r];
}

export function EmotionGauge({ emotion }: { emotion: SoulEmotion | null }) {
  const target = useMemo(
    () => ({
      loneliness: clamp01(emotion?.loneliness),
      excitement: clamp01(emotion?.excitement),
      talkativeness: clamp01(emotion?.talkativeness),
      irritation: clamp01(emotion?.irritation),
    }),
    [emotion],
  );

  // 读数落针：四维一起从当前显示值缓动到目标（--dur-settle = 1.2s）
  const [disp, setDisp] = useState(target);
  const prevRef = useRef(target);
  useEffect(() => {
    const from = { ...prevRef.current };
    const controls = animate(0, 1, {
      duration: 1.2,
      ease: easeOut,
      onUpdate: (p) => {
        const d = {
          loneliness: from.loneliness + (target.loneliness - from.loneliness) * p,
          excitement: from.excitement + (target.excitement - from.excitement) * p,
          talkativeness: from.talkativeness + (target.talkativeness - from.talkativeness) * p,
          irritation: from.irritation + (target.irritation - from.irritation) * p,
        };
        prevRef.current = d;
        setDisp(d);
      },
    });
    return () => controls.stop();
  }, [target]);

  const pts = DIMS.map((d) => pointAt(d, disp[d.key]));
  const polygon = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const ring = (f: number) =>
    DIMS.map((d) => `${CX + d.dx * R * f},${CY + d.dy * R * f}`).join(" ");

  return (
    <div className="flex items-center gap-5">
      <svg
        viewBox="0 0 260 190"
        className="min-w-0 flex-1"
        role="img"
        aria-label={`情绪星座：${DIMS.map((d) => `${d.label} ${(disp[d.key] * 100).toFixed(0)}`).join("，")}`}
      >
        {/* —— 仪器层：网格环 + 轴线 + 锚星，hairline & mono，纹丝不动 —— */}
        {[0.5, 1].map((f) => (
          <polygon
            key={f}
            points={ring(f)}
            fill="none"
            stroke="var(--astr-hairline)"
            strokeWidth="1"
          />
        ))}
        {DIMS.map((d) => (
          <line
            key={d.key}
            x1={CX + d.dx * R0}
            y1={CY + d.dy * R0}
            x2={CX + d.dx * R}
            y2={CY + d.dy * R}
            stroke="var(--astr-hairline)"
            strokeWidth="1"
          />
        ))}
        {DIMS.map((d) => {
          const [ax, ay] = [CX + d.dx * (R + 4), CY + d.dy * (R + 4)];
          return (
            <g key={d.key}>
              {/* 锚星：十字星标 */}
              <line x1={ax - 3} y1={ay} x2={ax + 3} y2={ay} stroke="var(--astr-text-3)" strokeWidth="1" />
              <line x1={ax} y1={ay - 3} x2={ax} y2={ay + 3} stroke="var(--astr-text-3)" strokeWidth="1" />
              <text
                x={ax + d.labelDx}
                y={ay + d.labelDy}
                textAnchor={d.anchor}
                style={{
                  fill: "var(--astr-text-3)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "9px",
                  letterSpacing: "0.18em",
                }}
              >
                {d.label}
              </text>
            </g>
          );
        })}

        {/* —— 她的层：星座多边形 + 顶点星 + 中心亮核（生物荧光） —— */}
        <polygon
          points={polygon}
          fill="var(--astr-emotion-glow)"
          fillOpacity="0.07"
          stroke="var(--astr-emotion-glow)"
          strokeOpacity="0.65"
          strokeWidth="1.2"
          strokeLinejoin="round"
          className="astr-emo"
        />
        {pts.map(([x, y], i) => (
          <circle key={DIMS[i].key} cx={x} cy={y} r="2.1" fill="var(--astr-emotion-glow)" className="astr-emo" />
        ))}
        <g
          style={{
            transformBox: "fill-box",
            transformOrigin: "center",
            animation: "astr-breath var(--dur-breath) ease-in-out infinite",
          }}
        >
          <circle cx={CX} cy={CY} r="10" fill="var(--astr-emotion-glow)" fillOpacity="0.16" className="astr-emo" />
          <circle cx={CX} cy={CY} r="4" fill="var(--astr-emotion-glow)" className="astr-emo" />
        </g>
      </svg>

      {/* 仪器读数列：mono 落针数字 */}
      <div className="shrink-0 space-y-2">
        {DIMS.map((d) => (
          <div key={d.key} className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-ink-3">{d.label}</span>
            <span className="tabular w-7 text-right font-mono text-xs text-ink-2">
              {(disp[d.key] * 100).toFixed(0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
