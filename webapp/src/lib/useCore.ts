"use client";

import { useEffect, useRef, useState } from "react";
import type { AstrEvent, CoreStatus } from "./types";

// 经 next.config 代理到 Core :8300（同源，免 CORS）。Core 不在线时各 hook 优雅降级。
const CORE = "/api/core";

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
  const typesRef = useRef(types);
  typesRef.current = types;

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const onMsg = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data) as AstrEvent;
        if (!typesRef.current.includes(evt.type)) return;
        setEvents((prev) => [...prev.slice(-(max - 1)), evt]);
      } catch {
        /* 忽略坏帧 */
      }
    };

    const connect = () => {
      es = new EventSource(`${CORE}/v1/stream`);
      es.onopen = () => setLive(true);
      // Core 用具名事件（event: agent.thought 等），逐类监听
      for (const t of typesRef.current) es.addEventListener(t, onMsg as EventListener);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [max]);

  return { events, live };
}
