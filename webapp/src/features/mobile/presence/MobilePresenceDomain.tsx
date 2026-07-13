"use client";

import type { ReactNode } from "react";

import type { PresenceControllerOwner } from "@/features/presence/controller/use-presence-controller";

import { useMobileAuthority } from "../authority/MobileAuthorityProvider";
import styles from "./MobilePresenceDomain.module.css";
import { TrustedMobilePresenceDomain } from "./TrustedMobilePresenceDomain";

export interface MobilePresenceDomainProps {
  readonly owner?: PresenceControllerOwner;
}

export function MobilePresenceDomain({
  owner,
}: MobilePresenceDomainProps): ReactNode {
  const authority = useMobileAuthority();

  if (authority === "trusted-local") {
    return <TrustedMobilePresenceDomain owner={owner} />;
  }

  const checking = authority === "checking";
  return (
    <section className={styles.gate} data-mobile-presence-phase={authority}>
      <p className={styles.eyebrow}>PRESENCE / 主权中继</p>
      <h1>{checking ? "正在核验本机 Presence" : "未连接 Core"}</h1>
      <p>
        {checking
          ? "正在组合服务端目标与浏览器回环来源证据；核验完成前不会启动 Core、SSE 或语音。"
          : "当前来源或 Core 目标不是本机可信入口，未连接 Core，也未开放对话写入。"}
      </p>
    </section>
  );
}
