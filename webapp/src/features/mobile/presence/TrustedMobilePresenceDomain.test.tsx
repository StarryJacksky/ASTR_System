import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PRESENCE_CONTROLLER_SERVER_SNAPSHOT } from "@/features/presence/controller/create-presence-controller";

import { createPresenceOwnerFixture } from "./presence.test-support";
import { TrustedMobilePresenceDomain } from "./TrustedMobilePresenceDomain";

describe("TrustedMobilePresenceDomain", () => {
  it("mounts the existing conversation and Composer against the injected owner", () => {
    const fixture = createPresenceOwnerFixture(
      PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
    );
    const { unmount } = render(
      <TrustedMobilePresenceDomain owner={fixture.owner} />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "与 Soul 对话" }),
    ).toBeVisible();
    expect(screen.getByRole("region", { name: "对话记录" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "消息输入" })).toBeVisible();
    expect(fixture.activeSubscribers()).toBe(1);
    unmount();
    expect(fixture.activeSubscribers()).toBe(0);
  });
});
