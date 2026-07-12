import type { ReactNode } from "react";

import { SemanticRuntimeBridge } from "./SemanticRuntimeBridge";
import { StateAnnouncer } from "./StateAnnouncer";
import { VisualMotionControlProvider } from "./VisualMotionToggle";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="astr-skip-link" href="#main-content">
        跳到主要内容
      </a>
      <SemanticRuntimeBridge />
      <StateAnnouncer />
      <div aria-hidden className="astr-ambient" />
      <div aria-hidden className="astr-grain" />
      <VisualMotionControlProvider>{children}</VisualMotionControlProvider>
    </>
  );
}
