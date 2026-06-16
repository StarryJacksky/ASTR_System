// 与后端契约对齐（03_CONTRACTS §1/§5）。只取前端用得到的字段。
import type { EmotionVector } from "./emotion";

/** GET /v1/status 的返回（core/app.py status）。 */
export interface CoreStatus {
  soul_name: string;
  local_llm_model: string;
  cost_today_usd: number;
  daily_budget_usd: number;
  emotion: SoulEmotion;
}

/** soul/emotion.py 的情绪向量（P1-W4）。各分量 0..1。 */
export interface SoulEmotion {
  loneliness: number;
  talkativeness: number;
  irritation: number;
  excitement: number;
  updated_at?: string;
}

/** 把后端情绪向量映射到设计系统的四锚点辉光向量（04 §3.2）。 */
export function soulToGlow(e: SoulEmotion | null | undefined): EmotionVector {
  if (!e) return { lonely: 0, excited: 0, tsundere: 0, calm: 1 };
  const lonely = clamp01(e.loneliness);
  const excited = clamp01(e.excitement);
  const tsundere = clamp01(e.irritation);
  const calm = clamp01(1 - (lonely + excited + tsundere) / 2);
  return { lonely, excited, tsundere, calm };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x ?? 0));
}

/** SSE 事件（/v1/stream 推送的 Event 模型，03 §1）。 */
export interface AstrEvent {
  id: string;
  ts: string;
  type: string;
  source: string;
  payload: Record<string, unknown>;
  trace_id: string;
}

/** 聊天时间线里的一条消息。 */
export interface ChatMessage {
  id: string;
  role: "user" | "qiuqiu";
  text: string;
  platform?: string;
  ts: number;
}

/** 圆桌一条发言（P3 才真正用，骨架先留）。 */
export interface RoundtableTurn {
  seat: string;
  content: string;
  isHost?: boolean;
}
