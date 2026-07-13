import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileAuthorityProvider, useMobileAuthority } from "./MobileAuthorityProvider";
import { isAllowedLoopbackHostname } from "./loopback-authority";

function Probe() {
  return <output data-authority-phase>{useMobileAuthority()}</output>;
}

const mounted: Array<{ readonly host: HTMLDivElement; readonly root: Root }> = [];

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop();
    if (!item) continue;
    await act(async () => item.root.unmount());
    item.host.remove();
  }
});

async function hydrate(serverAuthorityTrusted: boolean) {
  const tree = (
    <MobileAuthorityProvider serverAuthorityTrusted={serverAuthorityTrusted}>
      <Probe />
    </MobileAuthorityProvider>
  );
  const host = document.createElement("div");
  host.innerHTML = renderToString(tree);
  document.body.append(host);
  let root!: Root;
  await act(async () => {
    root = hydrateRoot(host, tree);
    await Promise.resolve();
  });
  mounted.push({ host, root });
  return host;
}

describe("MobileAuthorityProvider", () => {
  it("server-renders trusted evidence as checking without exposing a target", () => {
    const html = renderToString(
      <MobileAuthorityProvider serverAuthorityTrusted>
        <Probe />
      </MobileAuthorityProvider>,
    );
    expect(html).toContain("checking");
    expect(html).not.toContain("127.0.0.1:8300");
    expect(html).not.toContain("NEXT_PUBLIC_ASTR_CORE");
  });

  it("server-renders rejected evidence as unavailable", () => {
    const html = renderToString(
      <MobileAuthorityProvider serverAuthorityTrusted={false}>
        <Probe />
      </MobileAuthorityProvider>,
    );
    expect(html).toContain("unavailable-remote-context");
    expect(html).not.toContain("checking");
  });

  it("hydrates to trusted-local only for trusted server and browser evidence", async () => {
    expect(isAllowedLoopbackHostname(window.location.hostname)).toBe(true);
    const host = await hydrate(true);
    expect(host.textContent).toBe("trusted-local");
  });

  it("keeps rejected server evidence unavailable after hydration", async () => {
    const host = await hydrate(false);
    expect(host.textContent).toBe("unavailable-remote-context");
  });

  it("re-evaluates the immutable browser origin on pageshow without data access", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const host = await hydrate(true);
    expect(add).toHaveBeenCalledWith("pageshow", expect.any(Function));
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    expect(host.textContent).toBe("trusted-local");
  });

  it("fails clearly when consumed outside its provider", () => {
    expect(() => renderToString(<Probe />)).toThrow("MobileAuthorityProvider is required");
  });
});
