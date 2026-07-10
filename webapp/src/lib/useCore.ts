"use client";

import { useEffect, useState } from "react";
import type { AstrEvent, CoreStatus } from "./types";

// 普通 fetch 经 next.config 代理到 Core :8300（同源，免 CORS）。Core 不在线时各 hook 优雅降级。
const CORE = "/api/core";
// SSE 必须直连 Core：经 Next 代理流式会被缓冲、事件到不了浏览器（Core 已开 CORS）。
const SSE_BASE = process.env.NEXT_PUBLIC_ASTR_CORE ?? "http://127.0.0.1:8300";

/** 轮询 /v1/status：躯壳/成本/情绪向量。connected=false 表示 Core 未连上。 */
export function useStatus(intervalMs = 4000) {
  const [status, setStatus] = useState<CoreStatus | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${CORE}/v1/status`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as CoreStatus;
        if (alive) {
          setStatus(data);
          setConnected(true);
        }
      } catch {
        if (alive) setConnected(false);
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return { status, connected };
}

/** 订阅 /v1/stream（SSE）。按 type 累积事件，上限 max 条。 */
export function useEventStream(types: string[], max = 60) {
  const [events, setEvents] = useState<AstrEvent[]>([]);
  const [live, setLive] = useState(false);
  const typesKey = [...types].sort().join("\u001f");

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const subscribedTypes = typesKey ? typesKey.split("\u001f") : [];

    const onMsg = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data) as AstrEvent;
        if (!subscribedTypes.includes(evt.type)) return;
        setEvents((prev) => [...prev.slice(-(max - 1)), evt]);
      } catch {
        /* 忽略坏帧 */
      }
    };

    const connect = () => {
      es = new EventSource(`${SSE_BASE}/v1/stream`);
      es.onopen = () => setLive(true);
      // Core 用具名事件（event: agent.thought 等），逐类监听
      for (const t of subscribedTypes) es.addEventListener(t, onMsg as EventListener);
      es.onerror = () => {
        setLive(false);
        es?.close();
        retry = setTimeout(connect, 3000); // 断线 3s 重连
      };
    };
    connect();

    return () => {
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [max, typesKey]);

  return { events, live };
}

/** 订阅 soul.stream 增量帧（99 #19①）：当前正在生成的回复逐字生长。
 *  终帧（done）或 soul.decision 到达即结束；流帧频率高，单独连一路 SSE，
 *  不挤占 useEventStream 的事件缓冲。返回 {text, active}——active 供嘴型驱动。 */
export function useReplyStream() {
  const [text, setText] = useState("");
  const [active, setActive] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let buf = "";

    const onStream = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data) as AstrEvent;
        const p = evt.payload as { delta?: string; seq?: number; done?: boolean };
        if (p.done) {
          setActive(false);
          return; // 文本留着，等 soul.decision 的终稿把气泡接管
        }
        if (p.seq === 1) buf = ""; // 新一句开始
        buf += p.delta ?? "";
        setText(buf);
        setActive(true);
      } catch {
        /* 忽略坏帧 */
      }
    };
    const onDecision = () => {
      buf = "";
      setText("");
      setActive(false);
    };

    const connect = () => {
      es = new EventSource(`${SSE_BASE}/v1/stream`);
      es.addEventListener("soul.stream", onStream as EventListener);
      es.addEventListener("soul.decision", onDecision as EventListener);
      es.onerror = () => {
        es?.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, []);

  return { text, active };
}
