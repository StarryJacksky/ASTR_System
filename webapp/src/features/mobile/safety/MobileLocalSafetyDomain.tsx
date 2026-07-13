"use client";

import type { ReactNode } from "react";

import { useMobileAuthority } from "../authority/MobileAuthorityProvider";
import styles from "./MobileLocalSafetyDomain.module.css";
import type { MobileSafetyControllerOwner } from "./use-mobile-safety-controller";
import { TrustedMobileLocalSafetyDomain } from "./TrustedMobileLocalSafetyDomain";

export interface MobileLocalSafetyDomainProps {
  readonly owner?: MobileSafetyControllerOwner;
}

export function MobileLocalSafetyDomain({
  owner,
}: MobileLocalSafetyDomainProps): ReactNode {
  const authority = useMobileAuthority();
  const trusted = authority === "trusted-local";

  return (
    <section
      className={styles.domain}
      data-mobile-domain="safety"
      data-mobile-safety-phase={authority}
    >
      <header className={styles.domainHeader}>
        <p className={styles.eyebrow}>SAFETY / 本机证据</p>
        <h1>设备与安全</h1>
      </header>

      {trusted ? (
        <TrustedMobileLocalSafetyDomain owner={owner} />
      ) : (
        <div className={styles.gate}>
          <p>
            {authority === "checking"
              ? "正在核验本机来源"
              : "当前来源或 Core 目标不是本机可信入口，未读取服务器安全状态"}
          </p>
        </div>
      )}
    </section>
  );
}
