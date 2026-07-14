import type { ReactNode } from "react";

import { StudioShell } from "@/features/studio/components/StudioShell";

export default function StudioLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <StudioShell>{children}</StudioShell>;
}
