"use client";

import { useEffect, useState } from "react";

import { semanticStore, type Announcement } from "@/lib/semantic-store";

const POLITE_INTERVAL_MS = 1000;

export function StateAnnouncer() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(
    () => semanticStore.getState().announcement,
  );

  useEffect(() => {
    const renderedInitial = semanticStore.getState().announcement;
    let lastPoliteAt = renderedInitial?.politeness === "polite" ? Date.now() : null;
    let pendingPolite: Announcement | null = null;
    let timer: number | null = null;

    const cancelPendingPolite = () => {
      pendingPolite = null;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    const publishPolite = (next: Announcement) => {
      pendingPolite = null;
      timer = null;
      lastPoliteAt = Date.now();
      setAnnouncement(next);
    };

    const accept = (next: Announcement | null) => {
      if (next === null) {
        cancelPendingPolite();
        lastPoliteAt = null;
        setAnnouncement(null);
        return;
      }

      if (next.politeness === "assertive") {
        cancelPendingPolite();
        setAnnouncement(next);
        return;
      }

      const elapsed = lastPoliteAt === null ? POLITE_INTERVAL_MS : Date.now() - lastPoliteAt;
      if (elapsed >= POLITE_INTERVAL_MS) {
        if (timer !== null) window.clearTimeout(timer);
        publishPolite(next);
        return;
      }

      pendingPolite = next;
      if (timer === null) {
        timer = window.setTimeout(() => {
          const latest = pendingPolite;
          if (latest) publishPolite(latest);
        }, POLITE_INTERVAL_MS - elapsed);
      }
    };

    const unsubscribe = semanticStore.subscribe((state, previous) => {
      if (state.announcement !== previous.announcement) accept(state.announcement);
    });

    const current = semanticStore.getState().announcement;
    if (current !== renderedInitial) accept(current);

    return () => {
      unsubscribe();
      cancelPendingPolite();
    };
  }, []);

  const assertive = announcement?.politeness === "assertive";

  return (
    <div
      className="sr-only"
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {announcement && (
        <span key={announcement.id} data-announcement-id={announcement.id}>
          {announcement.message}
        </span>
      )}
    </div>
  );
}
