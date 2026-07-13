import type { ReactNode } from "react";

import { assessMobileServerAuthority } from "@/features/mobile/authority/loopback-authority";
import { MobileAuthorityProvider } from "@/features/mobile/authority/MobileAuthorityProvider";
import { MobileShell } from "@/features/mobile/shell/MobileShell";

export default function MobileLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const serverAuthorityTrusted = assessMobileServerAuthority({
    coreUrl: process.env.ASTR_CORE_URL,
    publicCoreUrl: process.env.NEXT_PUBLIC_ASTR_CORE,
  });

  return (
    <MobileAuthorityProvider serverAuthorityTrusted={serverAuthorityTrusted}>
      <MobileShell>{children}</MobileShell>
    </MobileAuthorityProvider>
  );
}
