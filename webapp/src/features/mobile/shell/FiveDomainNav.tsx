import Link from "next/link";

import { MOBILE_DOMAINS } from "../model/mobile-domains";
import styles from "./MobileShell.module.css";

export function FiveDomainNav({ pathname }: { readonly pathname: string }) {
  return (
    <nav className={styles.domainNav} aria-label="Mobile 五域">
      {MOBILE_DOMAINS.map((domain) => {
        const current = pathname === domain.href;
        return (
          <Link
            className={styles.domainLink}
            data-current={current ? "true" : "false"}
            href={domain.href}
            key={domain.id}
            prefetch={false}
            {...(current ? { "aria-current": "page" as const } : {})}
          >
            <span className={styles.domainIndex} aria-hidden="true">{domain.index}</span>
            <span className={styles.domainLabel}>{domain.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
