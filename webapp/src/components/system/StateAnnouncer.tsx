"use client";

import { useSemanticStore } from "@/lib/semantic-store";

export function StateAnnouncer() {
  const announcement = useSemanticStore((state) => state.announcement);
  const assertive = announcement?.politeness === "assertive";

  return (
    <div
      className="sr-only"
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {announcement?.message ?? ""}
    </div>
  );
}
