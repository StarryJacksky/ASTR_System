import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement, StrictMode, useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PresenceVisualOwnerSnapshot,
  PresenceVisualRuntimeOwner,
} from "./presence-visual-owner";
import { createPresenceVisualRuntimeOwner } from "./presence-visual-owner";
import type {
  PresenceVisualSemanticEvent,
  PresenceVisualSemanticSnapshot,
  PresenceVisualSemanticSource,
} from "./presence-visual-runtime";
import { PresenceVisualHost } from "./PresenceVisualHost";

const dynamicHarness = vi.hoisted(() => ({
  requests: 0,
  options: null as { ssr?: boolean; loading?: () => unknown } | null,
}));

vi.mock("next/dynamic", () => ({
  default: (
    _loader: () => Promise<unknown>,
    options: { ssr?: boolean; loading?: () => unknown },
  ) => {
    dynamicHarness.options = options;
    const MockDynamicPresenceVisualMount = () => {
      useEffect(() => {
        dynamicHarness.requests += 1;
      }, []);
      return createElement("span", {
        "data-testid": "dynamic-presence-visual-mount",
      });
    };
    return MockDynamicPresenceVisualMount;
  },
}));

const EMPTY_SCENE = vi.fn(() => ({ destroy: vi.fn() }));

beforeEach(() => {
  dynamicHarness.requests = 0;
  EMPTY_SCENE.mockClear();
  vi.mocked(window.matchMedia).mockImplementation((query) =>
    createMediaQueryList(query, false),
  );
});

describe("Presence visual Host", () => {
  it("renders the complete static surface during SSR without requesting the client module", () => {
    const semantic = createSemanticSource();
    const owner = createControlledOwner();

    const html = renderToString(
      <PresenceVisualHost
        owner={owner.owner}
        sceneLoader={EMPTY_SCENE}
        semanticSource={semantic.source}
        viewportWidth={1280}
        webglAvailability="available"
      />,
    );

    expect(html).toContain('data-visual-status="ssr"');
    expect(html).toContain('data-presence-visual-surface="true"');
    expect(html).toContain('aria-hidden="true"');
    expect(dynamicHarness.requests).toBe(0);
    expect(dynamicHarness.options?.ssr).toBe(false);
    expect(dynamicHarness.options?.loading?.()).toBeNull();
  });

  it("hydrates the fail-closed SSR surface without mismatch or duplicate dynamic ownership", async () => {
    const semantic = createSemanticSource();
    const owner = createControlledOwner();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = (
      <StrictMode>
        <PresenceVisualHost
          owner={owner.owner}
          semanticSource={semantic.source}
          viewportWidth={1280}
        />
      </StrictMode>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);

    let root: ReturnType<typeof hydrateRoot> | null = null;
    await act(async () => {
      root = hydrateRoot(container, tree);
      await Promise.resolve();
    });

    expect(container.querySelectorAll("[data-presence-visual-host]")).toHaveLength(1);
    expect(dynamicHarness.requests).toBe(0);
    expect(consoleError.mock.calls.flat().join("\n")).not.toMatch(
      /hydration|did not match|maximum update depth|getSnapshot should be cached/i,
    );

    await act(async () => root?.unmount());
    container.remove();
  });

  it.each([
    ["no scene", undefined, {}, 1280, "available", "notConfigured"],
    ["compact", EMPTY_SCENE, {}, 768, "available", "compact"],
    ["reduced", EMPTY_SCENE, { motion: "reduced" }, 1280, "available", "reduced"],
    ["paused", EMPTY_SCENE, { motion: "paused" }, 1280, "available", "paused"],
    ["hidden", EMPTY_SCENE, { visibility: "hidden" }, 1280, "available", "hidden"],
    ["offscreen", EMPTY_SCENE, { visibility: "offscreen" }, 1280, "available", "offscreen"],
    [
      "context lost",
      EMPTY_SCENE,
      { visualRuntime: "contextLost" },
      1280,
      "available",
      "contextLost",
    ],
    ["WebGL unavailable", EMPTY_SCENE, {}, 1280, "unavailable", "unavailable"],
    ["invalid viewport", EMPTY_SCENE, {}, Number.NaN, "available", "unavailable"],
  ] as const)(
    "keeps the cold %s path static and never requests the dynamic module",
    async (_name, sceneLoader, semanticPatch, viewportWidth, webglAvailability, status) => {
      const semantic = createSemanticSource(semanticPatch);
      const owner = createControlledOwner();

      const view = render(
        <PresenceVisualHost
          owner={owner.owner}
          sceneLoader={sceneLoader}
          semanticSource={semantic.source}
          viewportWidth={viewportWidth}
          webglAvailability={webglAvailability}
        />,
      );

      await waitFor(() =>
        expect(view.container.querySelector("[data-presence-visual-host]"))
          .toHaveAttribute("data-visual-status", status),
      );
      expect(dynamicHarness.requests).toBe(0);
      expect(screen.queryByTestId("dynamic-presence-visual-mount")).not.toBeInTheDocument();
    },
  );

  it("describes an unconfigured scene as static instead of indefinitely loading", async () => {
    const semantic = createSemanticSource({ visualRuntime: "loading" });
    const owner = createControlledOwner();

    const view = render(
      <PresenceVisualHost
        owner={owner.owner}
        semanticSource={semantic.source}
        viewportWidth={1280}
      />,
    );

    await waitFor(() =>
      expect(view.container.querySelector("[data-presence-visual-host]"))
        .toHaveAttribute("data-visual-status", "notConfigured"),
    );
    expect(dynamicHarness.requests).toBe(0);
  });

  it("requests the named dynamic mount only for an eligible desktop scene", async () => {
    const semantic = createSemanticSource({ visualRuntime: "loading" });
    const owner = createControlledOwner();

    const view = render(
      <PresenceVisualHost
        owner={owner.owner}
        sceneLoader={EMPTY_SCENE}
        semanticSource={semantic.source}
        viewportWidth={1280}
      />,
    );

    await waitFor(() => expect(dynamicHarness.requests).toBe(1));
    expect(screen.getByTestId("dynamic-presence-visual-mount")).toBeInTheDocument();
    expect(view.container.querySelector("[data-presence-visual-host]"))
      .toHaveAttribute("data-visual-status", "loading");
  });

  it("uses the owned runtime capability result when no external WebGL fact is supplied", async () => {
    const semantic = createSemanticSource({ visualRuntime: "loading" });
    const owner = createControlledOwner({
      hasStartedRuntime: true,
      phase: "static",
      retryRequired: false,
      webglAvailability: "unavailable",
    });

    const view = render(
      <PresenceVisualHost
        owner={owner.owner}
        sceneLoader={EMPTY_SCENE}
        semanticSource={semantic.source}
        viewportWidth={1280}
      />,
    );

    await waitFor(() =>
      expect(view.container.querySelector("[data-presence-visual-host]"))
        .toHaveAttribute("data-visual-status", "unavailable"),
    );
    expect(view.container.querySelector("[data-presence-visual-host]"))
      .toHaveAttribute("data-webgl-availability", "unavailable");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("fails closed from the initial reduced-motion media truth before the semantic bridge catches up", async () => {
    vi.mocked(window.matchMedia).mockImplementation((query) =>
      createMediaQueryList(query, true),
    );
    const semantic = createSemanticSource({
      motion: "full",
      visualRuntime: "loading",
    });
    const owner = createControlledOwner();

    const view = render(
      <PresenceVisualHost
        owner={owner.owner}
        sceneLoader={EMPTY_SCENE}
        semanticSource={semantic.source}
        viewportWidth={1280}
      />,
    );

    await waitFor(() =>
      expect(view.container.querySelector("[data-presence-visual-host]"))
        .toHaveAttribute("data-visual-status", "reduced"),
    );
    expect(dynamicHarness.requests).toBe(0);
  });

  it("keeps an already-started runtime mount sticky while hidden", async () => {
    const semantic = createSemanticSource({ visibility: "hidden" });
    const owner = createControlledOwner({ hasStartedRuntime: true, phase: "static" });

    render(
      <PresenceVisualHost
        owner={owner.owner}
        sceneLoader={EMPTY_SCENE}
        semanticSource={semantic.source}
        viewportWidth={1280}
      />,
    );

    await waitFor(() => expect(dynamicHarness.requests).toBe(1));
    expect(screen.getByTestId("dynamic-presence-visual-mount")).toBeInTheDocument();
  });

  it("retains one shared owner group through Strict Mode and duplicate Hosts", async () => {
    const scheduled: Array<() => void> = [];
    const semantic = createSemanticSource({ visualRuntime: "ready" });
    const owner = createPresenceVisualRuntimeOwner({
      scheduleMicrotask: (callback) => scheduled.push(callback),
    });

    const view = render(
      <StrictMode>
        <PresenceVisualHost
          owner={owner}
          semanticSource={semantic.source}
          viewportWidth={390}
        />
        <PresenceVisualHost
          owner={owner}
          semanticSource={semantic.source}
          viewportWidth={390}
        />
      </StrictMode>,
    );

    expect(semantic.events).toEqual([{ type: "VISUAL_RETRY" }]);
    while (scheduled.length > 0) scheduled.shift()?.();
    await expect(owner.retry()).resolves.toBe(false);
    expect(owner.getSnapshot()).toMatchObject({
      hasStartedRuntime: true,
      phase: "loading",
    });

    view.unmount();
    while (scheduled.length > 0) scheduled.shift()?.();
    expect(owner.getSnapshot()).toBe(owner.getServerSnapshot());
  });

  it("keeps the visual target inert and exposes retry as a 44px native sibling", async () => {
    const user = userEvent.setup();
    const semantic = createSemanticSource({ visualRuntime: "contextLost" });
    const owner = createControlledOwner({
      hasStartedRuntime: true,
      phase: "static",
      retryRequired: true,
    });

    const view = render(
      <PresenceVisualHost
        owner={owner.owner}
        sceneLoader={EMPTY_SCENE}
        semanticSource={semantic.source}
        viewportWidth={1280}
      />,
    );

    const surface = view.container.querySelector("[data-presence-visual-surface]");
    const retry = await screen.findByRole("button", { name: "重试视觉" });
    expect(surface).toHaveAttribute("aria-hidden", "true");
    expect(surface).toHaveAttribute("tabindex", "-1");
    expect(surface?.contains(retry)).toBe(false);
    expect(view.container.querySelector("[aria-live]")).toBeNull();

    await user.click(retry);
    expect(owner.retry).toHaveBeenCalledTimes(1);

    const css = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/SoulPresence.module.css"),
      "utf8",
    );
    const tokens = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
    const slotRule = css.match(/\.visualSlot\s*\{([^}]*)\}/)?.[1];
    const hostRule = css.match(
      /\.visualSlot\s+:global\(\[data-presence-visual-host\]\)\s*\{([^}]*)\}/,
    )?.[1];
    expect(slotRule).not.toContain("pointer-events: none");
    expect(hostRule).not.toContain("pointer-events: none");
    expect(css).toMatch(/data-presence-visual-surface[\s\S]*pointer-events:\s*none/);
    expect(css).toMatch(
      /data-presence-visual-retry[\s\S]*min-block-size:\s*var\(--touch-target\)/,
    );
    expect(css).toMatch(
      /data-presence-visual-retry[\s\S]*min-inline-size:\s*var\(--touch-target\)/,
    );
    expect(tokens).toMatch(/--touch-target:\s*44px/);
  });

  it("announces each newly available retry once through the injected global announcer", async () => {
    const semantic = createSemanticSource({ visualRuntime: "contextLost" });
    const owner = createControlledOwner({
      hasStartedRuntime: true,
      phase: "static",
    });
    const announce = vi.fn();

    const view = render(
      <PresenceVisualHost
        announce={announce}
        owner={owner.owner}
        sceneLoader={EMPTY_SCENE}
        semanticSource={semantic.source}
        viewportWidth={1280}
      />,
    );

    act(() => owner.publish({ retryRequired: true }));
    await waitFor(() => expect(announce).toHaveBeenCalledTimes(1));
    expect(announce).toHaveBeenCalledWith(
      expect.stringMatching(/可.*重试视觉|重试视觉.*可/),
    );
    expect(view.container.querySelector("[aria-live]")).toBeNull();

    act(() => owner.publish({ retryRequired: true }));
    expect(announce).toHaveBeenCalledTimes(1);

    act(() => owner.publish({ retryRequired: false }));
    act(() => owner.publish({ retryRequired: true }));
    await waitFor(() => expect(announce).toHaveBeenCalledTimes(2));
  });

  it("composes one retry episode across Strict Mode and mixed duplicate Hosts", async () => {
    const semantic = createSemanticSource({ visualRuntime: "contextLost" });
    const owner = createControlledOwner({
      hasStartedRuntime: true,
      phase: "static",
    });
    const announce = vi.fn();
    const host = (key: string, viewportWidth: number) => (
      <PresenceVisualHost
        announce={announce}
        key={key}
        owner={owner.owner}
        sceneLoader={EMPTY_SCENE}
        semanticSource={semantic.source}
        viewportWidth={viewportWidth}
      />
    );

    const view = render(
      <StrictMode>
        {host("eligible-a", 1280)}
        {host("compact", 390)}
      </StrictMode>,
    );
    await waitFor(() =>
      expect(view.container.querySelectorAll('[data-visual-status="contextLost"]'))
        .toHaveLength(2),
    );

    act(() => owner.publish({ retryRequired: true }));
    await waitFor(() => expect(announce).toHaveBeenCalledTimes(1));

    view.rerender(
      <StrictMode>
        {host("compact", 390)}
        {host("eligible-b", 1280)}
      </StrictMode>,
    );
    await waitFor(() =>
      expect(view.container.querySelectorAll('[data-visual-status="retryRequired"]'))
        .toHaveLength(2),
    );
    expect(announce).toHaveBeenCalledTimes(1);

    act(() => owner.publish({ retryRequired: false }));
    act(() => owner.publish({ retryRequired: true }));
    await waitFor(() => expect(announce).toHaveBeenCalledTimes(2));
  });

  it("keeps dynamic boundaries out of the Host and all renderer ownership in core runtime", () => {
    const hostSource = readFileSync(
      resolve(process.cwd(), "src/features/presence/visual/PresenceVisualHost.tsx"),
      "utf8",
    );
    const loaderSource = readFileSync(
      resolve(process.cwd(), "src/features/presence/visual/pixi-runtime-loader.ts"),
      "utf8",
    );
    const coreSource = readFileSync(
      resolve(process.cwd(), "src/features/presence/visual/presence-visual-runtime.ts"),
      "utf8",
    );

    expect(hostSource).toMatch(
      /dynamic\([\s\S]*import\("\.\/pixi-runtime-loader"\)[\s\S]*\.PresenceVisualMount[\s\S]*ssr:\s*false/,
    );
    expect(hostSource).not.toMatch(
      /requestAnimationFrame|getContext|new\s+\w*Application|Ticker\.shared|ResizeObserver/,
    );
    expect(loaderSource).toMatch(/import\("pixi\.js"\)/);
    expect(loaderSource).not.toMatch(
      /requestAnimationFrame|getContext|new\s+\w*Application|Ticker\.shared/,
    );
    expect(coreSource).toMatch(/new\s+applicationModule\.Application/);
  });
});

function createSemanticSource(
  patch: Partial<PresenceVisualSemanticSnapshot> = {},
) {
  let snapshot: PresenceVisualSemanticSnapshot = Object.freeze({
    visibility: "visible",
    motion: "full",
    visualRuntime: "ready",
    ...patch,
  });
  const listeners = new Set<() => void>();
  const events: PresenceVisualSemanticEvent[] = [];
  const source: PresenceVisualSemanticSource = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (event) => {
      events.push(event);
      snapshot = Object.freeze({
        ...snapshot,
        visualRuntime:
          event.type === "WEBGL_READY"
            ? "ready"
            : event.type === "WEBGL_LOST"
              ? "contextLost"
              : "loading",
      });
      for (const listener of [...listeners]) listener();
    },
  };
  return { source, events };
}

function createControlledOwner(
  patch: Partial<PresenceVisualOwnerSnapshot> = {},
) {
  let snapshot: PresenceVisualOwnerSnapshot = Object.freeze({
    hasStartedRuntime: false,
    activeRuntimeCount: 0,
    phase: "idle",
    retryRequired: false,
    webglAvailability: "unknown",
    ...patch,
  });
  const listeners = new Set<() => void>();
  const retry = vi.fn(async () => true);
  const owner: PresenceVisualRuntimeOwner = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => Object.freeze({
      hasStartedRuntime: false,
      activeRuntimeCount: 0,
      phase: "idle",
      retryRequired: false,
      webglAvailability: "unknown",
    }),
    retainHost: vi.fn(() => vi.fn()),
    acquireRuntime: vi.fn(() => vi.fn()),
    retry,
  };
  return {
    owner,
    retry,
    publish(next: Partial<PresenceVisualOwnerSnapshot>) {
      snapshot = Object.freeze({ ...snapshot, ...next });
      for (const listener of [...listeners]) listener();
    },
  };
}

function createMediaQueryList(query: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}
