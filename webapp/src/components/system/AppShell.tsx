import type { ReactNode } from "react";

import { StateAnnouncer } from "./StateAnnouncer";
import { VisualMotionToggle } from "./VisualMotionToggle";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="astr-skip-link" href="#main-content">
        跳到主要内容
      </a>
      <StateAnnouncer />
      <div aria-hidden className="astr-ambient" />
      <div aria-hidden className="astr-grain" />
      {children}
      <VisualMotionToggle />
    </>
  );
}
