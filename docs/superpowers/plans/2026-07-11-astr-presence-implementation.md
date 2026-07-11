# ASTR Workstream 1 Presence Implementation Plan

> **For Codex:** Execute this plan task-by-task with `superpowers:test-driven-development` and `superpowers:subagent-driven-development`. Each task requires a focused commit and read-only review before the next task. Do not pause for another execution choice unless a real authority or scope blocker appears.

**Goal:** Replace the current monolithic Presence page with a truthful, spacious, star-map conversation experience and a single lease-governed Pixi/Live2D visual runtime.

**Architecture:** Keep `app/page.tsx` as a synchronous Server Component and place browser behavior behind a focused `PresenceExperience` client boundary. A pure conversation reducer owns correlation/deduplication rules; an injectable Core client and one EventSource transport feed a single Presence controller and the existing parallel semantic store. DOM/SVG owns the fixed S orbit and every semantic fallback. Exactly one lazily loaded `PresenceVisualRuntime` owns Pixi, ticker, resize, context lifecycle, Live2D and the Soul Lens; all motion is arbitrated through one application-level Jewel runtime.

**Tech Stack:** Next.js 16.2 App Router, React 19.2, TypeScript 5, Zustand 5, Vitest 4, React Testing Library, Pixi.js 7.4, `pixi-live2d-display-lipsyncpatch`, Framer Motion only for finite DOM transitions, Playwright and axe for final browser acceptance.

**Binding Spec:** `docs/superpowers/specs/2026-07-11-astr-presence-design.md`

## Global Constraints

- Read `webapp/AGENTS.md` and the relevant local Next 16 guides under `webapp/node_modules/next/dist/docs/` before editing React/Next files.
- Do not modify Python/backend contracts in this Workstream.
- Do not expose remote Task, artifact, approval, device or provenance capabilities that the current Core does not provide.
- `soul.stream` is provisional; `soul.decision` is authoritative. `soul_name` is an internal handle; `display_name` is optional evidence.
- No green token or green-coded success. Keep every color behind constitutional tokens.
- No page/component may call `requestAnimationFrame`, `getContext`, construct a Pixi `Application`, or register a persistent ticker except `PresenceVisualRuntime` internals.
- Presence creates at most one WebGL context and one continuous app-owned frame chain. Mobile/reduced/context-lost paths are static.
- Do not break `/admin`; preserve one `main#main-content` per route and one global live region.
- Use `apply_patch` for edits, preserve unrelated user changes, and run `git diff --check` before every commit.

---

### Task 1: Pure Conversation Model and Truthful Projections

**Files:**

- Create: `webapp/src/features/presence/model/conversation.ts`
- Create: `webapp/src/features/presence/model/conversation.test.ts`
- Create: `webapp/src/features/presence/model/presence-types.ts`
- Modify: `webapp/src/lib/types.ts`

**Step 1: Write failing model tests**

Cover at minimum:

- local send starts with draft/message preserved and no receipt;
- ingest ACK binds exact `event_id` and `trace_id` and clears only the acknowledged draft revision;
- ingest failure keeps text, selection snapshot, local message and diagnostic;
- `soul.stream` delta and `soul.decision` arriving before ACK enter a bounded TTL pre-ACK buffer, then replay in arrival order only after the ACK trace matches;
- ACK failure/TTL expiry releases buffered frames: an authoritative decision is retained once through the external-decision rule, while unbound provisional deltas are discarded with a diagnostic; replay cannot duplicate an event id;
- only active trace deltas create/extend the provisional bubble;
- duplicate event id, duplicate seq, decreasing seq and empty delta do not append;
- decision before/after done replaces the provisional bubble in place;
- late stream never overwrites final;
- missing done still finalizes on decision;
- done without decision stays “waiting for final”, not success;
- non-active real decision is retained once without completing the active request;
- timeout preserves receipt and content; a same-trace late decision may take over once with a late-final marker;
- rapid double submit produces one active attempt/ingest;
- seen-event memory is bounded;
- selector produces the exact existing `ConversationProjection` without invented fields.

Run:

```bash
cd webapp
npm run test:run -- src/features/presence/model/conversation.test.ts
```

Expected: FAIL because the Presence model and pre-ACK correlation rules do not exist.

**Step 2: Implement the pure reducer**

Use serializable readonly records/arrays. Do not put timers, EventSource, DOM nodes, `Set`, Pixi objects or callbacks in the model. Bound dedupe history and the pre-ACK buffer to documented capacities; reducer events carry explicit timestamps so TTL behavior remains pure. Use an explicit active request/attempt and keep provisional text keyed by trace.

Keep `ConversationProjection` as the public current-backend projection. If richer internal message/delivery types are needed, define them in `presence-types.ts` and map to the public projection rather than silently changing the contract.

**Step 3: Verify and commit**

```bash
cd webapp
npm run test:run -- src/features/presence/model/conversation.test.ts
npm run lint
npm run typecheck
git diff --check
git add webapp/src/features/presence/model webapp/src/lib/types.ts
git commit -m "feat: model truthful Presence conversations"
```

---

### Task 2: Typed Core Client and Single SSE Transport

**Files:**

- Create: `webapp/src/features/presence/data/core-client.ts`
- Create: `webapp/src/features/presence/data/core-client.test.ts`
- Create: `webapp/src/features/presence/data/presence-stream.ts`
- Create: `webapp/src/features/presence/data/presence-stream.test.ts`
- Modify: `webapp/src/lib/types.ts`

**Step 1: Write failing transport tests**

Use injected `fetch`, EventSource factory and clock; do not patch production globals inside the implementation. Test:

- status, ingest, transcribe, effector status, e-stop and reset validate `response.ok` plus required response shape;
- ingest accepts only non-empty `event_id`/`trace_id`;
- malformed JSON/shape becomes a typed diagnostic, not a fabricated default;
- one `PresenceStream` instance creates exactly one EventSource;
- named handlers cover the current allowlist and route reply/life events without a second connection;
- transport start/open/error/reopen/close transitions are deterministic and both semantic regions reach connecting/open/retrying/closed without inventing independent sockets;
- malformed one-frame payload is reported and skipped without closing the other semantic consumer;
- close removes listeners and prevents any later callback;
- no replay/cursor claim or synthetic event id is introduced.

Run focused tests and confirm RED.

**Step 2: Implement minimal typed adapters**

Keep same-origin HTTP at `/api/core`; make SSE base explicit and injectable, defaulting to `NEXT_PUBLIC_ASTR_CORE ?? http://127.0.0.1:8300`. Preserve the wire event `id`, `type`, `trace_id`, `ts`, `source` and payload. Do not add custom reconnect timers if native EventSource reconnection suffices; if a custom timer is required, own and clear exactly one timer.

**Step 3: Verify and commit**

```bash
cd webapp
npm run test:run -- src/features/presence/data/core-client.test.ts src/features/presence/data/presence-stream.test.ts
npm run lint
npm run typecheck
git diff --check
git add webapp/src/features/presence/data webapp/src/lib/types.ts
git commit -m "feat: add truthful Presence Core transport"
```

---

### Task 3: Presence Controller, Status Polling, Correlation, and Safety Readback

**Files:**

- Create: `webapp/src/features/presence/controller/create-presence-controller.ts`
- Create: `webapp/src/features/presence/controller/create-presence-controller.test.ts`
- Create: `webapp/src/features/presence/controller/use-presence-controller.ts`
- Create: `webapp/src/features/presence/controller/use-presence-controller.test.tsx`
- Modify: `webapp/src/lib/semantic-state.ts`
- Modify: `webapp/src/lib/semantic-state.test.ts`
- Modify: `webapp/src/lib/semantic-store.ts`
- Delete after no references remain: `webapp/src/lib/useCore.ts`

**Step 1: Write failing controller tests**

Use fake timers and injected clients. Verify:

- one controller owns one status poller and one physical stream;
- Core, reply SSE and life SSE regions update orthogonally;
- explicit `REPLY_SSE_CONNECTING/CLOSED` and `LIFE_SSE_CONNECTING/CLOSED` events keep transport start/teardown inside the semantic reducer instead of direct store mutation;
- status success projects only real fields; two failures or 3 seconds are required for the ordinary offline banner, while raw request failures remain diagnostic;
- send dispatches local state, pre-ACK buffering, ACK correlation and the 10-second first-response timeout;
- first valid stream/decision cancels timeout;
- teardown closes transport and every timer, including while reconnecting/sending;
- controller startup immediately reads effector status; before evidence it exposes `checking`, then maps stopped true/false to latched/normal and a failed read to unknown without disabling e-stop;
- explicit `ESTOP_STATUS_CHECK`, `ESTOP_STATUS_CLEAR`, and `ESTOP_STATUS_LATCHED` semantic events map startup evidence to existing Safety states (`stopUnknown`, `normal`, `stoppedLatched`); `checking` remains the controller evidence label rather than a fabricated new device state;
- e-stop/reset dispatch requested/resetting first, then POST, then authoritative GET readback;
- POST/readback failure or an e-stop readback contrary to the requested target enters `stopUnknown`; reset readback still stopped remains latched; no optimistic local toggle;
- `canSend` remains independent of Safety;
- status, conversation, life and safety snapshots are observable without rerender loops;
- `getSnapshot` returns the same frozen object until a mutation, `subscribe` has stable identity, and `getServerSnapshot` is deterministic;
- `renderToString` then `hydrateRoot` in Strict Mode creates no hydration/infinite-update warning and never leaves two controllers, pollers or EventSources.

**Step 2: Implement a framework-neutral controller and thin hook**

The class/function controller owns side effects and exposes stable `subscribe/getSnapshot/getServerSnapshot/actions`. Cache an immutable snapshot and replace it only on semantic mutation. The React hook uses all three `useSyncExternalStore` arguments; it must not duplicate model state with effect-driven `setState`. Create/dispose the controller through a Strict-Mode-safe provider or ref-counted external owner, not during render. Send actions carry draft revision and selection snapshot into Task 1’s reducer.

The stream transport is one connection, but controller dispatches both semantic SSE regions because they remain separate truth regions. A transport error may set both retrying; a malformed life event must not erase reply state.

**Step 3: Verify and commit**

```bash
cd webapp
npm run test:run -- src/features/presence/controller
npm run test:run
npm run lint
npm run typecheck
git diff --check
git add webapp/src/features/presence/controller webapp/src/lib/semantic-state.ts webapp/src/lib/semantic-state.test.ts webapp/src/lib/semantic-store.ts webapp/src/lib/useCore.ts
git commit -m "feat: coordinate Presence runtime truth"
```

---

### Task 4: Accessible Composer and Explicit Voice Workflow

**Files:**

- Create: `webapp/src/features/presence/components/Composer.tsx`
- Create: `webapp/src/features/presence/components/Composer.test.tsx`
- Create: `webapp/src/features/presence/components/VoiceInput.tsx`
- Create: `webapp/src/features/presence/components/VoiceInput.test.tsx`
- Create: `webapp/src/features/presence/components/Composer.module.css`
- Modify: `webapp/src/lib/wav.ts` only if an injectable recorder boundary is required

**Step 1: Write failing interaction tests**

Use roles and accessible names. Cover:

- native textarea and stable focus ring;
- `isComposing` and legacy `keyCode===229` never send;
- Shift+Enter inserts newline;
- next Enter after compositionend sends once;
- whitespace-only and Core-unreachable guards;
- e-stop does not disable conversation;
- ACK failure preserves exact value plus selectionStart/selectionEnd and exposes retry/copy-diagnostic actions;
- ACK success clears only the matching draft revision; typing a new draft while request is in flight is preserved;
- mic permission denied, recorder failure, transcribe failure and empty result have distinct text;
- successful transcription fills/selects textarea but does not send automatically;
- busy/recording states have text equivalents and 44px controls;
- maximum recording duration stops safely; explicit cancel and route unmount stop every MediaStream track, close AudioContext, abort/ignore late transcribe completion and restore the draft.

**Step 2: Implement the focused client components**

Do not let voice transcription claim identity verification. Keep the web default silent. Composer receives a small snapshot/actions interface from the controller; it cannot fetch directly.

Use finite CSS transitions or Framer press feedback only. No RAF, canvas or token-by-token animation.

**Step 3: Verify and commit**

```bash
cd webapp
npm run test:run -- src/features/presence/components/Composer.test.tsx src/features/presence/components/VoiceInput.test.tsx
npm run lint
npm run typecheck
git diff --check
git add webapp/src/features/presence/components/Composer* webapp/src/features/presence/components/VoiceInput* webapp/src/lib/wav.ts
git commit -m "feat: build resilient Presence composer"
```

---

### Task 5: Conversation Scroll Sovereignty and Life Density Island

**Files:**

- Create: `webapp/src/features/presence/components/ConversationRegion.tsx`
- Create: `webapp/src/features/presence/components/ConversationRegion.test.tsx`
- Create: `webapp/src/features/presence/components/MessageTimeline.tsx`
- Create: `webapp/src/features/presence/components/LifeRegion.tsx`
- Create: `webapp/src/features/presence/components/LifeRegion.test.tsx`
- Create: `webapp/src/features/presence/model/life-events.ts`
- Create: `webapp/src/features/presence/model/life-events.test.ts`
- Delete after migration: `webapp/src/components/astr/MessageTimeline.tsx`
- Delete after migration: `webapp/src/components/astr/LifeArea.tsx`

**Step 1: Write failing behavior tests**

Cover semantic message list/author/text/time, a single provisional bubble, final in-place takeover, no timeline `aria-live`, and one global final announcement call.

Mock scroll metrics and verify:

- initial render and self-send follow latest;
- user within the bottom threshold keeps following;
- user scroll-up freezes position through 1000 deltas;
- “回到最新” plus unread count appears and restores follow;
- decision replacement does not force-follow an opted-out reader.

Life reducer tests map only real `agent.thought`, `moa.report`, `soul.decision` and activity into bounded summaries with source/time. Assert the UI says “处理片段/生活记录”, never “完整思维链”, and preserves empty/retry states honestly.

**Step 2: Implement without per-token effects**

Batch/derive provisional text from the model; do not schedule an animation or announcement per delta. Life expansion state is a UI intent, not inferred from event volume.

**Step 3: Verify and commit**

```bash
cd webapp
npm run test:run -- src/features/presence/components/ConversationRegion.test.tsx src/features/presence/components/LifeRegion.test.tsx src/features/presence/model/life-events.test.ts
npm run lint
npm run typecheck
git diff --check
git add webapp/src/features/presence webapp/src/components/astr/MessageTimeline.tsx webapp/src/components/astr/LifeArea.tsx
git commit -m "feat: add sovereign Presence timelines"
```

---

### Task 6: Organic Presence Shell, Fixed S Orbit, and Truthful Header

**Files:**

- Create: `webapp/src/features/presence/PresenceExperience.tsx`
- Create: `webapp/src/features/presence/PresenceExperience.test.tsx`
- Create: `webapp/src/features/presence/PresenceExperience.module.css`
- Create: `webapp/src/features/presence/components/PresenceHeader.tsx`
- Create: `webapp/src/features/presence/components/PresenceHeader.test.tsx`
- Create: `webapp/src/features/presence/components/OrbitNavigation.tsx`
- Create: `webapp/src/features/presence/components/OrbitNavigation.test.tsx`
- Create: `webapp/src/features/presence/components/OrbitNavigation.module.css`
- Create: `webapp/src/features/presence/components/SoulPresence.tsx`
- Create: `webapp/src/features/presence/components/StaticSoulLens.tsx`
- Modify: `webapp/src/app/page.tsx`
- Modify: `webapp/src/app/globals.css`
- Modify: `webapp/src/components/system/AppShell.tsx`
- Modify: `webapp/src/components/system/AppShell.test.tsx`
- Modify: `webapp/src/components/system/VisualMotionToggle.tsx` only if needed to support a route-control slot without duplicating state/control
- Reuse or modify truthfully: `webapp/src/components/astr/VoiceprintPanel.tsx`

**Step 1: Write failing shell/orbit tests**

Assert:

- `app/page.tsx` is synchronous/server by default and contains no `"use client"`;
- one `main#main-content`, one h1, continuous headings, the global main skip remains valid, and a second “跳到消息输入” link reaches a focusable composer target;
- orbit SVG is `aria-hidden`, not tabbable, and uses immutable predeclared desktop/compact path data;
- DOM endpoint controls expose `aria-current`; Task endpoint says unavailable and creates no fake Task node;
- explicit deep-chat toggle changes `data-presence-layout` from `balanced` to `deep` without removing Soul;
- life expands to an independent region and returns focus correctly;
- header surfaces Core/reply/life/safety separately, optional display name, secondary internal/model/cost disclosure;
- e-stop control remains enabled in unknown/offline states and uses controller actions;
- settings overlay Escape/focus-return behavior is correct;
- theme, Control link and the AppShell-owned visual pause appear in the Presence header composition with exactly one pause button and one live-region node on the full page;
- no green, no indispensable low-contrast text, 44px actions.

**Step 2: Implement the 58/42 and 72/28 composition**

Use CSS grid/subgrid/container queries where supported, `minmax(0, ...)`, `100dvh` and safe-area insets. The desktop S curve may cross whitespace and outer frames but never message text/input. At 768/390/320 widths switch to the compact predefined path and a single-column reading order. Mobile static Soul remains visible; do not implement the five-domain nav here.

Use non-rectangular treatment only for outer frame/eclipse notch/chapter endpoint. Composer, messages, settings content and long text remain stable rectangles.

**Step 3: Verify and commit**

```bash
cd webapp
npm run test:run -- src/features/presence/PresenceExperience.test.tsx src/features/presence/components/PresenceHeader.test.tsx src/features/presence/components/OrbitNavigation.test.tsx
npm run test:run
npm run lint
npm run typecheck
npm run build
git diff --check
git add webapp/src/app/page.tsx webapp/src/app/globals.css webapp/src/features/presence webapp/src/components/astr/VoiceprintPanel.tsx webapp/src/components/system/AppShell.tsx webapp/src/components/system/AppShell.test.tsx webapp/src/components/system/VisualMotionToggle.tsx
git commit -m "feat: compose the ASTR Presence field"
```

---

### Task 7: One Application-Level Jewel Runtime

**Files:**

- Create: `webapp/src/features/presence/visual/jewel-runtime.ts`
- Create: `webapp/src/features/presence/visual/jewel-runtime.test.ts`
- Create: `webapp/src/features/presence/visual/JewelRuntimeBridge.tsx`
- Create: `webapp/src/features/presence/visual/JewelRuntimeBridge.test.tsx`
- Create: `webapp/src/features/presence/visual/visibility-coordinator.ts`
- Create: `webapp/src/features/presence/visual/visibility-coordinator.test.ts`
- Create: `webapp/src/features/presence/visual/PresenceVisibilityBridge.tsx`
- Create: `webapp/src/features/presence/visual/PresenceVisibilityBridge.test.tsx`
- Modify: `webapp/src/lib/jewel-lease.ts`
- Modify: `webapp/src/lib/jewel-lease.test.ts`
- Modify: `webapp/src/lib/semantic-state.ts`
- Modify: `webapp/src/lib/semantic-state.test.ts`
- Modify: `webapp/src/components/system/SemanticRuntimeBridge.tsx`
- Modify: `webapp/src/components/system/SemanticRuntimeBridge.test.tsx`
- Modify: `webapp/src/features/presence/PresenceExperience.tsx`

**Step 1: Write failing arbitration/integration tests**

Test one singleton controller, semantic environment subscription, no lease before `visible/full/ready`, and immediate release on hidden/offscreen/reduced/paused/contextLost.

Test a full independent visibility-fact matrix through one coordinator: document hidden dominates viewport facts; document visible while viewport remains offscreen yields offscreen atomically; viewport onscreen while document hidden stays hidden; only both true yields visible. `PresenceVisibilityBridge` alone owns one IntersectionObserver with a named threshold constant, cleanup, and no visible-then-offscreen transient lease.

Add generation-safe handles: acquire A, replace with same owner/mode B, then complete A; B must remain active. Test higher-priority preemption, equal-priority newest intent, unmount cleanup, and `data-dynamic-jewel="active"` count ≤1.

Test the stream transfer sequence: only a real stage event whose trace matches the active request may acquire Lens; heartbeat/other-trace thought cannot. First valid delta completes/releases Lens before speech acquire; decision/error/pause releases speech and resets the visual endpoint. Empty delta or local timer cannot acquire streamStage.

**Step 2: Implement a thin runtime around the existing controller**

Preserve the Foundation class’s fail-closed behavior. A lease handle must carry an opaque generation/token and only its matching handle may release/complete. Publish cached immutable snapshots with stable `subscribe`, `getSnapshot` and `getServerSnapshot`; add the same render/hydrate/Strict Mode contract tests as the Presence controller. Do not put controller instances in Zustand state.

`SemanticRuntimeBridge` and `PresenceVisibilityBridge` feed independent facts into one coordinator, which atomically dispatches the derived union using priority `hidden > offscreen > visible`. Jewel bridge subscribes exactly once to the semantic singleton and tears down on unmount. No RAF.

**Step 3: Verify and commit**

```bash
cd webapp
npm run test:run -- src/features/presence/visual/jewel-runtime.test.ts src/features/presence/visual/JewelRuntimeBridge.test.tsx src/features/presence/visual/visibility-coordinator.test.ts src/features/presence/visual/PresenceVisibilityBridge.test.tsx src/lib/jewel-lease.test.ts src/components/system/SemanticRuntimeBridge.test.tsx
npm run lint
npm run typecheck
git diff --check
git add webapp/src/features/presence/visual webapp/src/features/presence/PresenceExperience.tsx webapp/src/lib/jewel-lease.ts webapp/src/lib/jewel-lease.test.ts webapp/src/lib/semantic-state.ts webapp/src/lib/semantic-state.test.ts webapp/src/components/system/SemanticRuntimeBridge.tsx webapp/src/components/system/SemanticRuntimeBridge.test.tsx
git commit -m "feat: govern the global Presence Jewel"
```

---

### Task 8: Single Pixi PresenceVisualRuntime and Lifecycle Instrumentation

**Files:**

- Create: `webapp/src/features/presence/visual/presence-visual-runtime.ts`
- Create: `webapp/src/features/presence/visual/presence-visual-runtime.test.ts`
- Create: `webapp/src/features/presence/visual/PresenceVisualHost.tsx`
- Create: `webapp/src/features/presence/visual/PresenceVisualHost.test.tsx`
- Create: `webapp/src/features/presence/visual/pixi-runtime-loader.ts`
- Create: `webapp/src/features/presence/visual/static-visual-state.ts`
- Modify: `webapp/src/lib/runtime-metrics.ts`
- Modify: `webapp/src/lib/runtime-metrics.test.ts`
- Modify: `webapp/src/features/presence/components/SoulPresence.tsx`

**Step 1: Write failing lifecycle tests with a fake Pixi factory**

Cover:

- desktop DPR 1/2/3 caps at 1.5; compact/mobile caps at 1.25;
- zero-size mount does not create a runaway resize/render loop;
- exactly one Application/context/ticker and no component-owned RAF;
- 30fps desktop / 24fps compact cadence uses the one ticker;
- hidden/offscreen/reduced/paused stops ticker and records `app-raf=0` within 250ms;
- create then fail at module/model/pass stages still reaches one idempotent destroy path;
- destroy may be called repeatedly and removes ResizeObserver/context listeners/ticker once;
- context lost prevents default, stops, releases lease, dispatches `WEBGL_LOST`, shows static fallback;
- complete scene initialization dispatches `WEBGL_READY` exactly once before any dynamic lease can succeed;
- one automatic restore attempt; second failure stays static with an accessible 44px “重试视觉” control until explicit `VISUAL_RETRY`, which returns runtime to loading before retrying;
- 20 mount/unmount cycles leave zero live contexts/listeners;
- runtime metric ring remains bounded and rejects invalid data.

**Step 2: Implement runtime ownership**

`PresenceVisualHost` is a small Client Component that dynamically imports a named visual module at module top level with `next/dynamic(..., { ssr: false })`. The DOM/static fallback renders before it. The loader imports Pixi only on eligible desktop/full-motion paths.

Only `presence-visual-runtime.ts` may construct the Application or manipulate its ticker/renderer. Use the Application ticker as the sole scheduler and never start `PIXI.Ticker.shared`; do not add a second raw RAF. Instrument actual backing size, context count and draw-call/texture estimates without telemetry or persistence. Dispatch `WEBGL_READY` only after the WebGL Lens/Live2D scene is fully usable, not merely after constructing the renderer; mobile/reduced/no-WebGL static paths remain non-animatable and advertise their separate DOM fallback state.

**Step 3: Verify and commit**

```bash
cd webapp
npm run test:run -- src/features/presence/visual/presence-visual-runtime.test.ts src/features/presence/visual/PresenceVisualHost.test.tsx src/lib/runtime-metrics.test.ts
npm run lint
npm run typecheck
npm run build
git diff --check
git add webapp/src/features/presence/visual webapp/src/features/presence/components/SoulPresence.tsx webapp/src/lib/runtime-metrics.ts webapp/src/lib/runtime-metrics.test.ts
git commit -m "feat: add the single Presence visual runtime"
```

---

### Task 9: Renderer-Free Live2DAdapter and Staticize Legacy Loops

**Files:**

- Create: `webapp/src/features/presence/visual/live2d-adapter.ts`
- Create: `webapp/src/features/presence/visual/live2d-adapter.test.ts`
- Create: `webapp/src/features/presence/visual/live2d-assets.ts`
- Create: `webapp/src/features/presence/visual/live2d-assets.test.ts`
- Create: `webapp/live2d-assets.lock.json`
- Create: `webapp/docs/live2d-assets.md`
- Modify: `webapp/scripts/fetch-live2d.mjs`
- Modify: `webapp/src/lib/live2dStore.ts`
- Modify: `webapp/src/components/astr/Live2DControls.tsx`
- Delete: `webapp/src/components/astr/Live2DStage.tsx`
- Delete or replace with static CSS/SVG: `webapp/src/components/astr/Starfield.tsx`
- Delete or replace with static CSS/SVG: `webapp/src/components/astr/DustMotes.tsx`
- Delete or replace with static CSS/SVG: `webapp/src/components/astr/FlameCore.tsx`
- Delete if no longer used: `webapp/src/components/astr/Intro.tsx`

**Step 1: Write failing adapter/asset tests**

Test Cubism script dedupe, core/model/moc/texture 404, unmount during each async stage, missing audio references, transform clamping for NaN/Infinity/out-of-range localStorage, representative-frame freeze, expression failure and mouth reset on lease loss.

Assert the adapter receives an existing stage/application ticker from Task 8, constructs the model with `autoUpdate:false`, never calls deprecated `registerTicker`, never touches `PIXI.Ticker.shared`, and advances `model.update(deltaMS)` only from the runtime ticker while holding a lease. It never creates Application/renderer/ticker/RAF/getContext. Assert mobile/static/reduced paths never import Live2D or request 2048 textures; monitor shared ticker listeners/RAF and require zero.

Pin every upstream download to an immutable commit/SDK version. Generate/verify `live2d-assets.lock.json` with SHA-256 for Cubism Core, model JSON, moc, textures and other referenced assets; record source and license/re-distribution status in `webapp/docs/live2d-assets.md`. A clean-checkout preflight with missing or mismatched assets must fail closed to StaticSoulLens. Tests must not pass merely because ignored local assets happen to exist.

Add a source-level test over Presence/legacy visual files that rejects `requestAnimationFrame`, `getContext`, `new PIXI.Application`, `new Application`, or independent ticker creation outside the allowlisted runtime file.

**Step 2: Implement and remove legacy continuous loops**

Attach/detach the model through the runtime’s stage. Do not register the library shared ticker. Runtime destroy owns the final shared teardown; adapter destroy is idempotent for its model/resources.

Replace ambient star/dust/flame loops with sparse static CSS/SVG geometry driven by no timers. Do not create decorative stars for empty data. Preserve settings controls only if their saved transform is validated and their effect is truthful.

**Step 3: Verify and commit**

```bash
cd webapp
npm run test:run -- src/features/presence/visual/live2d-adapter.test.ts src/features/presence/visual/live2d-assets.test.ts
npm run test:run
npm run lint
npm run typecheck
npm run build
git diff --check
git add webapp/src/features/presence/visual webapp/src/lib/live2dStore.ts webapp/src/components/astr webapp/scripts/fetch-live2d.mjs webapp/live2d-assets.lock.json webapp/docs/live2d-assets.md
git commit -m "refactor: unify Presence Live2D rendering"
```

---

### Task 10: SoulLensPass, Lease Transfer, and Full Presence Integration

**Files:**

- Create: `webapp/src/features/presence/visual/soul-lens-pass.ts`
- Create: `webapp/src/features/presence/visual/soul-lens-pass.test.ts`
- Create: `webapp/src/features/presence/visual/soul-lens-shader.ts`
- Create: `webapp/src/features/presence/visual/visual-scene.ts`
- Create: `webapp/src/features/presence/visual/visual-scene.test.ts`
- Modify: `webapp/src/features/presence/visual/presence-visual-runtime.ts`
- Modify: `webapp/src/features/presence/PresenceExperience.tsx`
- Modify: `webapp/src/features/presence/components/SoulPresence.tsx`
- Modify: `webapp/src/features/presence/PresenceExperience.module.css`
- Remove any now-dead imports/files under `webapp/src/components/astr/`

**Step 1: Write failing Lens/scene tests**

Assert the Lens uses one quad/two triangles and one pass, shares Task 8’s renderer, owns no context/ticker, and stays within 1–2 draw calls. Model changes update only the middle-shell uniform; the fixed identity center does not move. Missing provenance renders an explicit static “未提供” outer state rather than a fabricated percentage.

Test that uniforms update only while Lens owns a valid lease; preemption lands on the latest semantic endpoint. Verify Lens-to-speech ordering, no overlap between active Lens and Live2D motion, no animation on empty/local stages, and static SVG parity under mobile/reduced/contextLost.

**Step 2: Implement the single-pass Jewel and integrate the scene**

Use Pixi 7 Geometry/Shader/Mesh or equivalent already in the dependency tree; no Three.js/R3F/glTF/HDRI. Shader source plus wrapper gzip delta must remain under 25KB. Register the Lens and Live2D adapters on the one runtime stage and expose DOM attributes:

- `data-visual-runtime`
- `data-soul-lens-fallback`
- `data-dynamic-jewel`
- `data-orbit-state`
- `data-sse-state`

Keep Canvas/Live2D `aria-hidden`; update neighboring DOM state before visual completion.

**Step 3: Remove dead prototype paths and run integration verification**

```bash
cd webapp
npm run test:run -- src/features/presence/visual/soul-lens-pass.test.ts src/features/presence/visual/visual-scene.test.ts src/features/presence/PresenceExperience.test.tsx
npm run test:coverage
npm run lint
npm run typecheck
npm run build
git diff --check
git add webapp/src/features/presence webapp/src/components/astr
git commit -m "feat: integrate the ASTR Soul Lens"
```

---

### Task 11: Browser Acceptance, Accessibility, and Performance Gates

**Files:**

- Modify: `webapp/package.json`
- Modify: `webapp/package-lock.json`
- Create: `webapp/playwright.config.ts`
- Create: `webapp/e2e/presence.spec.ts`
- Create: `webapp/e2e/presence-a11y.spec.ts`
- Create: `webapp/e2e/presence-runtime.spec.ts`
- Create: `webapp/e2e/presence-performance.spec.ts`
- Create: `webapp/e2e/support/mock-core.mjs`
- Create: `webapp/e2e/support/performance-evidence.ts`
- Create: `webapp/e2e/support/budget-evaluator.ts`
- Create: `webapp/e2e/support/budget-evaluator.test.ts`
- Create: `webapp/scripts/check-presence-boundaries.mjs`
- Create: `webapp/scripts/check-presence-assets.mjs`
- Create: `webapp/scripts/presence-soak.mjs`
- Create: `webapp/e2e/evidence.schema.json`
- Create: `webapp/docs/presence-verification.md`
- Create: `webapp/src/test/presence-boundaries.test.ts`
- Modify: `webapp/README.md`

**Step 1: Add the acceptance dependencies and scripts**

Install only the needed dev packages, expected to include `@playwright/test` and `@axe-core/playwright`. Use the project’s npm version and keep production dependencies unchanged. Add `test:e2e`, `check:presence-boundaries`, `check:presence-assets`, `check:presence-budgets`, evidence, real-Core smoke and soak scripts. If browser binaries are absent, install Chromium through Playwright with explicit environment approval.

The mock Core must implement only the current real HTTP/SSE shapes. It may expose test controls but must never add product fields or remote Task capability. Configure Playwright with a `webServer` array for mock Core plus Next, and set the existing build/start-time `ASTR_CORE_URL`/`NEXT_PUBLIC_ASTR_CORE` variables explicitly. Mock tests prove deterministic UI only. Add an opt-in real-Core smoke profile for actual proxy/CORS/named-SSE integration.

**Step 2: Write failing browser and boundary tests**

Cover:

- route loads without hydration/console/page errors in dark and light themes;
- 1440, 1280, 768, 390 and 320 viewport screenshots; no horizontal overflow;
- balanced/deep layout, persistent Soul, life island, fixed orbit path and unavailable Task endpoint;
- send → ACK → provisional → decision, delta/decision before ACK, ACK failure retains one authoritative external decision but drops unbound deltas with diagnostic, early decision, missing done, missing decision timeout/late final, rapid double submit, duplicate/malformed frame and SSE reconnect gap text;
- draft/selection recovery, IME keyboard path, voice error/fill-only behavior;
- startup e-stop checking/readback true/readback false/readback failure, mutation ack/readback, contrary readback, unknown and latched states;
- axe critical/serious = 0 for cold/offline/ready/streaming/final/error/contextLost/safety states;
- keyboard order, dialog focus return, 200% and 400% zoom;
- reduced/pause/hidden/offscreen after 250ms reports zero app-owned RAF;
- context count ≤1, backing size obeys DPR cap, active Jewel count ≤1;
- Application ticker is the only active visual scheduler and `PIXI.Ticker.shared` has zero listeners/RAF;
- real runtime instrumentation records Live2D+Lens calls/triangles, texture/RT bytes, resource transfer bytes and Lens gzip size;
- PerformanceObserver/equivalent records LCP, INP, CLS, TBT derivation, visual JS cadence and 10-second-stream long tasks with raw samples;
- schema-driven budget evaluator fails the command when environment-independent Master §18.2/§18.3 limits are exceeded: context/RAF/DPR, 8k triangles, 110 desktop or 96 mobile calls, 64/32MiB texture+RT, 4/1.5MB optional visual transfer, 25KB Lens gzip, or any >50ms long task during the 10-second stream;
- mobile/reduced paths do not request Live2D 2048 textures;
- source boundary script rejects green hardcodes and forbidden visual APIs outside the runtime allowlist.

Run and confirm RED before fixing any integration issue discovered.

**Step 3: Fix only evidence-backed integration defects**

Do not relax axe, runtime, console, budget or screenshot assertions to make tests pass. Write every measurement to a schema-validated evidence artifact with date, browser/OS, CPU/GPU when available, viewport, DPR, throttle, raw samples and support state. The evaluator must fail environment-independent budget breaches; only genuinely fixed-hardware-dependent JS/GPU/CWV metrics may be `unsupported` or `not-run`. Record unsupported GPU timer/Spector, real-device or assistive-technology work as `unsupported` or `not-run`; never convert missing evidence into a pass.

Run the 30-minute soak script and fixed 5 cold/5 warm profiles only on a machine declared capable in `docs/presence-verification.md`; otherwise validate the harness on a short profile and leave the fixed-hardware item explicitly `not-run`. NVDA/VoiceOver/TalkBack, real soft keyboard and Microsoft/macOS/Japanese/Gboard IME are manual evidence rows, not Playwright assertions.

**Step 4: Run complete W1 acceptance**

Run sequentially:

```bash
cd webapp
npm run test:run
npm run test:coverage
npm run check:presence-boundaries
npm run check:presence-assets
npm run check:presence-budgets
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

Then run from the repo root:

```bash
git diff --check
git status --short
```

Expected automated gates in the current environment:

- all commands exit 0;
- no runtime console/hydration errors;
- one WebGL context maximum, one dynamic Jewel maximum, zero hidden/reduced/offscreen app RAF;
- browser screenshots match the approved blue/violet/black star-map direction in both material themes;
- automated measurements emit valid evidence with actual numbers, and every environment-independent Master budget is below its threshold or the command fails; environment-dependent rows are neither omitted nor mislabeled passed;
- when a real Core is available, the separate smoke profile passes; otherwise its evidence row is `not-run`, not inferred from mock Core.

**Step 5: Commit acceptance harness and W1 fixes**

Review `git status --short`, then stage only the Task 11 paths and any named integration fixes. Do not use a broad `git add webapp/src` that could capture unrelated work.

```bash
git add webapp/package.json webapp/package-lock.json webapp/playwright.config.ts webapp/e2e webapp/scripts/check-presence-boundaries.mjs webapp/scripts/check-presence-assets.mjs webapp/scripts/presence-soak.mjs webapp/src/test/presence-boundaries.test.ts webapp/docs/presence-verification.md webapp/README.md
git commit -m "test: enforce Presence experience budgets"
```

---

## Workstream Review and Handoff

After Task 11:

1. Generate a review package for the full W1 commit range.
2. Dispatch a fresh read-only reviewer against this plan, the Presence sub-spec and relevant Master Spec sections.
3. Fix every Critical/Important finding through one focused fix task, rerun the complete W1 acceptance, and re-review.
4. Record Minor findings in `.superpowers/sdd/progress.md` without claiming they are complete.
5. Mark Workstream 1 complete only after review is approved and the worktree is clean.
6. Proceed directly to Workstream 2 Control sub-spec/plan; do not begin backend Secure Task work.

## Self-Review Record

- Backend boundary: this plan consumes existing endpoints and explicitly forbids backend or remote Task invention.
- Truth hierarchy: ACK, provisional stream, decision and SSE gaps have distinct, deterministic UI states.
- Layout: chat is no longer constrained by the old upper/lower court; default 58/42 and explicit 72/28 preserve both conversation and person.
- Runtime: a single Pixi owner, no Live2D shared ticker, static DOM/SVG fallback, shared Jewel arbitration and hard DPR/RAF/context budgets are executable, not decorative prose.
- Evidence boundary: automatable metrics produce raw artifacts; fixed-hardware and manual AT/IME certification are explicit rows and are never inferred from mock/browser unit success.
- Accessibility: IME, scroll sovereignty, one live region, semantic fallback, zoom and keyboard behavior are test tasks.
- Mobile boundary: responsive Presence is delivered; the separate five-domain MobileShell remains Workstream 4.
