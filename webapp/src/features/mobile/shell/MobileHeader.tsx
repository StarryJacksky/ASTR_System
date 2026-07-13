import Link from "next/link";

import { ThemeToggle } from "@/components/astr/ThemeToggle";
import { VisualMotionRouteSlot } from "@/components/system/VisualMotionToggle";

import type { MobileAuthorityPhase } from "../authority/loopback-authority";
import type { MobileDomainDefinition } from "../model/mobile-domains";
import styles from "./MobileShell.module.css";

const AUTHORITY_COPY: Record<MobileAuthorityPhase, string> = {
  checking: "核验本机来源",
  "trusted-local": "本机可信入口",
  "unavailable-remote-context": "远程来源未授权",
};

export function MobileHeader({
  domain,
  authority,
}: {
  readonly domain: MobileDomainDefinition;
  readonly authority: MobileAuthorityPhase;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.brandRail}>
        <div className={styles.eclipse} aria-hidden="true" />
        <div className={styles.brandCopy}>
          <p className={styles.brand}>星枢 · ASTR</p>
          <p className={styles.domainName}>{domain.label}</p>
        </div>
      </div>
      <p className={styles.localFact}>{AUTHORITY_COPY[authority]}</p>
      <div className={styles.headerActions}>
        <ThemeToggle />
        <VisualMotionRouteSlot className={styles.motionSlot} />
        {authority === "trusted-local" && (
          <Link className={styles.presenceLink} href="/" prefetch={false}>
            返回 Presence
          </Link>
        )}
      </div>
    </header>
  );
}
