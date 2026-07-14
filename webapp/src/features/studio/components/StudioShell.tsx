import type { ReactNode } from "react";
import Link from "next/link";

import { ThemeToggle } from "@/components/astr/ThemeToggle";
import { VisualMotionRouteSlot } from "@/components/system/VisualMotionToggle";

import styles from "./StudioSurface.module.css";

export function StudioShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.shell} data-route-surface="studio">
      <header className={styles.header}>
        <div className={styles.identity}>
          <span aria-hidden className={styles.identityMark}>
            星
          </span>
          <span>
            <small>星枢 · ASTR</small>
            <strong>Studio</strong>
          </span>
        </div>

        <nav aria-label="星枢四空间" className={styles.spaceNavigation}>
          <Link className={styles.spaceLink} href="/" prefetch={false}>
            Presence
          </Link>
          <span aria-current="page" className={styles.currentSpace}>
            Studio
          </span>
          <Link className={styles.spaceLink} href="/admin" prefetch={false}>
            Control
          </Link>
          <Link
            className={styles.spaceLink}
            href="/mobile/presence"
            prefetch={false}
          >
            Mobile
          </Link>
        </nav>

        <div className={styles.headerTools}>
          <ThemeToggle />
          <VisualMotionRouteSlot className={styles.motionSlot} />
        </div>
      </header>
      {children}
    </div>
  );
}
