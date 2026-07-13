"use client";

import type { ReactNode } from "react";

import { Composer } from "@/features/presence/components/Composer";
import {
  ConversationRegion,
  getFinalAnnouncementLedgerForScope,
} from "@/features/presence/components/ConversationRegion";
import {
  presenceControllerOwner,
  usePresenceController,
  type PresenceControllerOwner,
} from "@/features/presence/controller/use-presence-controller";

export interface TrustedMobilePresenceDomainProps {
  readonly owner?: PresenceControllerOwner;
}

export function TrustedMobilePresenceDomain({
  owner = presenceControllerOwner,
}: TrustedMobilePresenceDomainProps): ReactNode {
  const { snapshot, actions } = usePresenceController(owner);
  const assistantLabel = nonblank(snapshot.status?.displayName) ?? "Soul";

  return (
    <section>
      <h1>与 {assistantLabel} 对话</h1>
      <ConversationRegion
        announcementLedger={getFinalAnnouncementLedgerForScope(owner)}
        assistantLabel={assistantLabel}
        conversation={snapshot.conversation}
      />
      <Composer
        actions={actions}
        snapshot={{
          conversation: snapshot.conversation,
          diagnostics: snapshot.diagnostics,
          draft: snapshot.draft,
          semantic: snapshot.semantic,
        }}
      />
    </section>
  );
}

function nonblank(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
