"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useMobileAuthority } from "../authority/MobileAuthorityProvider";
import { getMobileDomainByPath } from "../model/mobile-domains";
import { FiveDomainNav } from "./FiveDomainNav";
import { MobileHeader } from "./MobileHeader";
import styles from "./MobileShell.module.css";

export function MobileShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const authority = useMobileAuthority();
  const domain = getMobileDomainByPath(pathname);

  return (
    <div className={styles.shell} data-route-surface="mobile">
      <MobileHeader authority={authority} domain={domain} />
      <svg
        className={styles.relayCurve}
        data-mobile-relay-curve=""
        aria-hidden="true"
        viewBox="0 0 96 1000"
        preserveAspectRatio="none"
      >
        <path d="M18 0 C82 130 10 255 58 382 C94 478 20 604 52 718 C79 818 37 903 72 1000" />
      </svg>
      <main className={styles.main} id="main-content">{children}</main>
      <FiveDomainNav pathname={pathname} />
    </div>
  );
}
