"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import { semanticStore } from "@/lib/semantic-store";
import { useMobileAuthority } from "../authority/MobileAuthorityProvider";
import { getMobileDomainByPath } from "../model/mobile-domains";
import { FiveDomainNav } from "./FiveDomainNav";
import { MobileHeader } from "./MobileHeader";
import styles from "./MobileShell.module.css";

export function MobileShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const authority = useMobileAuthority();
  const domain = getMobileDomainByPath(pathname);
  useMobileRouteAnnouncementOwnership(pathname, domain.label);

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

function useMobileRouteAnnouncementOwnership(
  pathname: string,
  domainLabel: string,
): void {
  const previousPathname = useRef(pathname);

  useEffect(() => {
    let ownedAnnouncer: HTMLElement | null = null;
    let originalAttributes: Readonly<{
      ariaHidden: string | null;
      ariaLive: string | null;
      role: string | null;
    }> | null = null;

    const restore = () => {
      if (ownedAnnouncer === null || originalAttributes === null) return;
      restoreAttribute(ownedAnnouncer, "aria-hidden", originalAttributes.ariaHidden);
      restoreAttribute(ownedAnnouncer, "aria-live", originalAttributes.ariaLive);
      restoreAttribute(ownedAnnouncer, "role", originalAttributes.role);
    };

    const claim = () => {
      const container = document.querySelector("next-route-announcer");
      const candidate =
        container?.shadowRoot?.getElementById("__next-route-announcer__") ??
        document.getElementById("__next-route-announcer__");
      if (!(candidate instanceof HTMLElement)) return;
      if (candidate !== ownedAnnouncer) {
        restore();
        ownedAnnouncer = candidate;
        originalAttributes = {
          ariaHidden: candidate.getAttribute("aria-hidden"),
          ariaLive: candidate.getAttribute("aria-live"),
          role: candidate.getAttribute("role"),
        };
      }
      candidate.removeAttribute("aria-live");
      candidate.removeAttribute("role");
      candidate.setAttribute("aria-hidden", "true");
      observer.observe(candidate, {
        attributeFilter: ["aria-live", "role"],
        attributes: true,
      });
    };

    const observer = new MutationObserver(claim);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    claim();

    return () => {
      observer.disconnect();
      restore();
    };
  }, []);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    semanticStore.getState().announce(`已进入 ${domainLabel}`);
  }, [domainLabel, pathname]);
}

function restoreAttribute(
  element: HTMLElement,
  name: "aria-hidden" | "aria-live" | "role",
  value: string | null,
): void {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}
