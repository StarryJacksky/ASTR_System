import type { ReactNode } from "react";

import { ControlShell } from "@/features/control/components/ControlShell";

export default function ControlLayout({ children }: { readonly children: ReactNode }) {
  return <ControlShell>{children}</ControlShell>;
}
