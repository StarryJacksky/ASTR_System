# ASTR Studio unavailable observatory implementation plan

> Date: 2026-07-14
> Baseline: `825d558`
> Scope: frontend-only `/studio` unavailable shell, truthful projection taxonomy, and four-space discoverability from the sovereign desktop surfaces
> Out of scope: Studio 3A authority/auth/endpoints, backend changes, projection clients, mock data, Run execution, Knowledge, Secure Dispatch, or enabling Mobile AI Workbench

## Goal

Establish the fourth ASTR space without pretending that the Studio contract already exists. The route must feel like a deliberate, premium instrument whose evidence channel is visibly dormant, not like a missing-page placeholder and not like a partially functional IDE.

The selected direction is **Contract Horizon / 合同视界**:

- a stable top fact rail names the missing authority, identity scope, read contract, and zero-request policy;
- an asymmetric central workplane gives the unavailable truth enough negative space to read immediately;
- one static horizontal datum stops at an uncloseable contract gap; the six authorised taxonomy labels — Workspace, Run, Tool, Trace, Source, Artifact — are registered nearby as isolated categories while every one remains explicitly `unavailable`;
- three ruled implementation-gate conditions explain what must exist before real Studio work can begin;
- the visual language uses solid material, instrument ticks, evidence paths, cut corners, blue/violet/black or cold ceramic day material, and no Presence S-orbit or Control archive shell.

The datum is a calibration horizon, not a waveguide. It has no arrow, connected node, direction, sequence, progress, timeline, trace, data visualisation, or animation. The six labels are a category directory, not a process or connection state. Presence's existing S-wave remains untouched as the primary relay-line motif.

## Non-negotiable truth and authority boundaries

- The current specification status remains “contract design approved; implementation gate not opened.”
- `/studio` may return HTTP 200 only as a static unavailable shell.
- Render the exact primary truth `Studio 投影未启用`.
- Render the exact reason `缺少已授权 authority、认证 scopes 与只读 endpoints。`
- Render the exact evidence limit `没有可验证的 Run、模型路由、成本或产物数据。`
- State that current Core exposes no `/v1/studio/*` read contract and that this page does not issue Studio resource requests.
- Show exactly the six authorised projection taxonomy labels: Workspace, Run, Tool, Trace, Source, Artifact. These labels are future contract categories, not records or capability evidence.
- Issue zero Studio/Core business requests. Do not probe capabilities, status, SSE, Control, local files, SQLite, Redis, or any other candidate source.
- Add no Studio data/client/controller hooks, request owner, mock client, fixture/demo production fallback, API rewrite, environment variable, or backend endpoint.
- Add no Run, Prompt, Approve, Tool, Download, Retry, upload, editor, form, input, textarea, select, contenteditable, or disabled pretend-action anywhere in the Studio route surface. The only interactive allowlist is the three native cross-space links plus the existing ThemeToggle and VisualMotionRouteSlot global controls.
- Add no fake task, file tree, model, provider, route, source, citation, trace, tool result, artifact, count, timestamp, progress, `$0`, empty collection, success, completion, connection, or authorisation claim.
- Do not write `暂无`, `无权读取`, `已授权`, `运行中`, `成功`, `已完成`, or an implied launch date. `unavailable` is not `empty`, `forbidden`, `error`, or `stale`.
- Do not reinterpret `/v1/status` as per-run model/cost or `/v1/stream` as Trace.
- Studio is 0 Canvas, 0 WebGL, 0 route-owned RAF, 0 continuous animation, no green, no gradients, no glass/backdrop filter, no generic card wall, and no second renderer.
- Day and night use identical geometry. Motion pause and reduced-motion remain functional even though Studio owns no motion.
- Mobile stays authority-contained and unchanged: do not add a direct Studio/Control bypass to its header or five-domain navigation in this tranche. Its existing trusted-local return to Presence remains the only cross-space exit, and its AI Workbench keeps the exact `Studio 投影未启用` gate.
- Do not modify `src/astr/**`, backend tests, Python dependencies, Core mock endpoints, or existing business contracts.

## Task 1 — Lock the static projection taxonomy

**Files**

- Create: `webapp/src/features/studio/model/studio-projections.ts`
- Create: `webapp/src/features/studio/model/studio-projections.test.ts`

**RED**

Write an independent expectation table requiring:

- exactly six entries in this order: Workspace, Run, Tool, Trace, Source, Artifact;
- unique stable IDs and English labels;
- a short Chinese purpose label for each category, phrased as a future evidence type rather than a current fact;
- every entry has the exact static state `unavailable`;
- the exported array, every entry, and every nested value are runtime-frozen;
- no count, timestamp, fake identifier, example record, model/provider, cost, URI, filename, or positive runtime state appears in the registry;
- forbidden copy does not include `暂无`, `无权读取`, `已授权`, `运行中`, `成功`, `已完成`, or dollar amounts.

Run:

```powershell
npm test -- --run src/features/studio/model/studio-projections.test.ts
```

Expected RED: the taxonomy module does not exist.

**GREEN**

Implement a small readonly, frozen registry. It must contain contract taxonomy only and must not be called a client, response, fixture, dataset, snapshot, or capability result.

Run the focused test again and require PASS.

## Task 2 — Build the server-safe unavailable workplane

**Files**

- Create: `webapp/src/features/studio/components/StudioUnavailableWorkplane.tsx`
- Create: `webapp/src/features/studio/components/StudioUnavailableWorkplane.test.tsx`
- Create: `webapp/src/features/studio/components/StudioSurface.module.css`
- Create: `webapp/src/features/studio/components/StudioShell.tsx`
- Create: `webapp/src/features/studio/components/StudioShell.test.tsx`
- Create: `webapp/src/app/studio/layout.tsx`
- Create: `webapp/src/app/studio/page.tsx`
- Create: `webapp/src/app/studio/page.test.tsx`
- Modify: `webapp/src/app/globals.css`

**RED — semantics and truth**

Add component/page tests requiring:

- one route surface marker `data-route-surface="studio"` and one `main#main-content`;
- one and only one h1 with exact text `Studio 投影未启用`;
- the exact reason and evidence-limit sentences from this plan;
- a labelled fact rail containing authority, auth scopes, read-contract, and request-policy facts without fake verification time;
- a labelled projection register containing the exact six registry entries in registry order, each rendered as `投影未启用` and explicitly described as `分类目录，非流程或连接状态`;
- a labelled implementation-gate region containing exactly three prerequisites: stable authority/ownership, authenticated principal/scopes, and security-reviewed thin read endpoints;
- explicit copy that current Core has no `/v1/studio/*` read contract and this page does not issue Studio resource requests;
- across the entire Studio route surface, exactly three native cross-space links and exactly the two existing global-control buttons are allowed; no other link/button/action role exists, and no form, input, textarea, select, contenteditable, live region, progressbar, canvas, SVG animation, or fake status count exists;
- no client directive, effect, date/time read, random value, fetch/client/controller/data import, environment read, or business event handler in the workplane source;
- static decorations are `aria-hidden`; facts remain available as real text and list semantics;
- page metadata title `Studio 投影未启用 · 星枢 ASTR` and a description that does not claim an enabled workspace.

Expected RED: `/studio` and Studio components do not exist.

**GREEN — component structure**

Build `StudioShell` as a server component with:

- a compact brand/instrument header;
- a four-space navigation labelled `星枢四空间`, with Studio marked current and native links to Presence, Control, and Mobile;
- the existing ThemeToggle and VisualMotionRouteSlot as shared global controls only;
- the workplane as the only main content.

Build `StudioUnavailableWorkplane` as static semantic HTML. Use the frozen taxonomy and no runtime owner. Add a Studio-specific global ambient/grain suppression rule so global gradients/animation do not remain active behind this route.

Run:

```powershell
npm test -- --run src/features/studio src/app/studio
```

Expected: PASS.

## Task 3 — Compose the Contract Horizon visual language

**Files**

- Modify: `webapp/src/features/studio/components/StudioSurface.module.css`
- Modify: `webapp/src/features/studio/components/StudioUnavailableWorkplane.test.tsx`
- Modify: `webapp/src/features/studio/components/StudioShell.test.tsx`

**RED**

Add source/CSS tests requiring:

- solid token-based surfaces only, with no raw colour literal and no `gradient`, `backdrop-filter`, `filter: blur`, `@keyframes`, `animation`, `transition` on the dormant datum, `box-shadow` glow, or green-family token/word;
- no Presence `S`, orbit, jewel, Live2D, character, or Control spine/archive vocabulary/class/import;
- no generic `card`, `tile`, `glass`, `bento`, dashboard grid, or repeated rounded-panel class; internal fact/truth/register/gate regions must stay transparent and may not each own a four-sided border;
- exactly one clipped/cut-corner outer instrument frame, one horizontal datum, and one central contract gap; the six text-backed registration marks are visually detached from the datum and have no connecting node or arrow;
- no coordinate number, crosshair, radar/ring, scan line, arrow, decorative star field, ungrounded tick, repeated corner bracket, or more than the six text-backed registration marks;
- `min-inline-size: 0`, `overflow-wrap: anywhere`, and safe horizontal overflow rules for long Chinese/English contract copy;
- every interactive header target is at least `var(--touch-target)`;
- desktop asymmetric geometry: fact rail across the top, narrow taxonomy scale, broad central truth void, and lower/right gate rail;
- mobile geometry: one reading column while the single contract datum remains horizontal; six categories become a plain single-column register and never turn into Mobile's vertical relay mast;
- explicit 320px and short-height handling, four safe-area insets, `100dvh`, and no fixed content height that clips text;
- light theme changes material/contrast only, not track sizes, order, or geometry.

**GREEN**

Author the CSS as a single instrument composition rather than a collection of cards. The signature view should read as a dark-matter workplane measured against one datum that cannot cross the contract gap. Projection labels remain isolated text registrations, not connected apertures or floating boxes. Keep the central unavailable copy dominant; render the three prerequisites as optical calibration conditions with open separators, not a Control-like ledger.

Use only CSS/HTML/SVG-static geometry that is justified by the layout; prefer borders, pseudo-elements, clip-path, and token colours. If inline SVG is used for a non-semantic rule, it must be `aria-hidden`, contain no script/animation, and duplicate no text.

Run the focused component tests and require PASS.

## Task 4 — Complete desktop discoverability for the four-space IA

**Files**

- Modify: `webapp/src/features/presence/components/PresenceHeader.tsx`
- Modify: `webapp/src/features/presence/components/PresenceHeader.test.tsx`
- Modify if geometry requires: `webapp/src/features/presence/components/PresenceHeader.module.css`
- Modify: `webapp/src/features/control/components/ControlShell.tsx`
- Modify: `webapp/src/features/control/components/ControlShell.test.tsx`
- Modify: `webapp/src/features/control/components/ControlShell.module.css`
- Modify: `webapp/e2e/presence-a11y.spec.ts`

**RED**

Require:

- Presence global controls contain one native `Studio` link to `/studio`, alongside the existing Control and non-prefetched Mobile links;
- Control cross-space navigation contains exactly Presence, Studio, and Mobile native links, with Studio at `/studio`;
- Studio navigation exposes the complete four-space IA and marks Studio with `aria-current="page"` without linking to itself;
- every cross-space Next Link touched on Presence, Studio, and Control sets `prefetch={false}` so an idle surface does not load another space's RSC or chunks; Mobile's existing return link remains non-prefetched;
- Presence and Control Studio targets meet the touch target;
- Control compact navigation uses three equal columns without horizontal overflow at 320px;
- Presence's existing keyboard-order assertions account for the new real Studio stop without weakening the rest of the order;
- Mobile source, authority tests, five-domain navigation, snapshots, and its existing trusted-local/remote link policy remain pixel- and behaviour-stable.

Expected RED: Presence and Control have no Studio link.

**GREEN**

Add only the missing desktop cross-space links and the minimum responsive rule needed for Control's three compact links. Do not create a universal generic navigation skin; each space keeps its own voice. Do not alter Presence's S-wave layout, chat/life proportions, Control module routes, Mobile header, Mobile domain model, or five-domain nav.

Run:

```powershell
npm test -- --run src/features/presence/components/PresenceHeader.test.tsx src/features/control/components/ControlShell.test.tsx src/features/studio/components/StudioShell.test.tsx src/features/mobile/shell/MobileShell.test.tsx
```

Expected: PASS.

## Task 5 — Add a fail-closed Studio source/build boundary

**Files**

- Create: `webapp/scripts/check-studio-boundaries.mjs`
- Create: `webapp/scripts/check-studio-boundaries.test.mjs`
- Modify: `webapp/package.json`

**RED**

Write scanner tests using temporary fixtures for:

- Studio-owned `.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts/.css` traversal from app and feature entrypoints;
- local relative and `@/` import resolution, quoted/unquoted CSS imports, and fail-closed behaviour for resolved but unscannable files;
- forbidden direct/dynamic/computed imports and require calls;
- fetch, XMLHttpRequest, EventSource, WebSocket, sendBeacon, environment reads, and Studio client/data/controller/mock/fixture/demo fallbacks;
- endpoint literal context: allow exactly one immutable, exact `/v1/studio/*` fragment only inside the required human-readable Workplane sentence; reject it in constants, href/action attributes, request APIs, client/controller modules, concatenation, templates, or any executable context, with positive and negative AST fixtures;
- requestAnimationFrame variants, Canvas/OffscreenCanvas, `getContext`, WebGL/WebGPU, Pixi/Three/Live2D/framer-motion, CSS gradient/backdrop/animation, and renderer-containing production chunks;
- action/form/editor primitives across every Studio-owned source while allowlisting only the three exact native cross-space links and exact shared ThemeToggle/VisualMotionRouteSlot controls used by the shell;
- exact six taxonomy IDs/order/states and exactly one route surface.
- production evidence mutations for missing/stale source stamp, BUILD_ID mismatch, missing `/studio/page` app-path entry, missing client manifest, zero resolved Studio chunks, and referenced chunk files that do not exist.

Expected RED: no Studio boundary checker exists.

**GREEN**

Implement the checker, add `check:studio-boundaries`, and emit a concise JSON report containing source-file count, production chunk evidence status, exact taxonomy state, and violations. The checker must fail closed on unknown local dependencies or computed loading; it must not silently skip a newly added extension.

Run:

```powershell
npm run test:run -- scripts/check-studio-boundaries.test.mjs
npm run check:studio-boundaries
```

The source-only test can pass before a production build. The production checker must explicitly report whether build evidence is checked or absent; final acceptance requires checked evidence from a fresh build.

## Task 6 — Browser, accessibility, zoom, request, runtime, and visual evidence

**Files**

- Create: `webapp/e2e/studio.spec.ts`
- Create: `webapp/e2e/studio-a11y.spec.ts`
- Create: `webapp/e2e/studio-visual.spec.ts`
- Create: `webapp/e2e/studio-visual.spec.ts-snapshots/studio-{1440x1000,390x844,320x720}-{dark,light}-win32.png`
- Modify: `webapp/playwright.config.ts`
- Modify: affected `webapp/e2e/presence.spec.ts-snapshots/*.png`
- Modify: affected `webapp/e2e/control.spec.ts-snapshots/*.png`

**RED**

Add browser assertions for:

- `/studio` returns 200, has the exact metadata title, one h1, four-space navigation, six isolated unavailable registrations, three prerequisites, and exact boundary copy;
- a request ledger installed before `goto` records zero Studio/Core business requests through hydration and one macrotask; classify same-origin and configured/mock Core paths while excluding documents, RSC, chunks, fonts, and static assets;
- an idle-route prefetch ledger proves Presence, Studio, and Control do not request another space's document, RSC payload, or page chunk before a user activates a cross-space link;
- runtime probes installed before navigation observe zero successful Canvas/WebGL/WebGPU context creation and zero active or continuous RAF after settling;
- the whole Studio surface contains only the exact three navigation links and two global-control buttons, zero product actions/editors/forms, and no fake data vocabulary;
- the global ambient and grain are hidden, have no background, and own no running animation on Studio;
- 320, 390, 768, and 1440 CSS-pixel widths have no horizontal overflow and all header controls stay reachable;
- 200% equivalent (640×450) and 400% equivalent (320×225) preserve h1, boundary copy, six labels, navigation reachability, and a scrollable document without clipped focused controls;
- keyboard traversal reaches all three native cross-space links and both shared global controls in a stable order;
- axe reports zero critical or serious violations for dark/light desktop, mobile, and 400%-equivalent states;
- day/night geometry parity stays within one CSS pixel for shell, header, main, fact rail, central truth, datum, projection register, and gate conditions.

Create exactly six Studio baselines:

- `studio-1440x1000-{dark,light}.png`
- `studio-390x844-{dark,light}.png`
- `studio-320x720-{dark,light}.png`

Adding Studio to existing Presence and Control navigation intentionally changes their visible navigation baselines. Refresh and inspect the affected 10 Presence and 20 Control images individually; accept only explainable navigation pixels plus the planned responsive accommodation. Mobile pixels must remain unchanged.

Generate only with a source-stamped build:

```powershell
npm run test:e2e -- e2e/studio.spec.ts e2e/studio-a11y.spec.ts e2e/studio-visual.spec.ts e2e/presence.spec.ts e2e/control.spec.ts --update-snapshots
npm run test:e2e:no-build -- e2e/studio.spec.ts e2e/studio-a11y.spec.ts e2e/studio-visual.spec.ts e2e/presence.spec.ts e2e/presence-a11y.spec.ts e2e/control.spec.ts e2e/mobile-authority.spec.ts e2e/mobile-visual.spec.ts
```

The second command is the no-update proof. Visually inspect every changed baseline between the two commands.

## Task 7 — Verification record, full regression, review, and commit

**Files**

- Create: `webapp/docs/studio-verification.md`
- Modify: `webapp/README.md`

Document:

- the static unavailable authority decision;
- exact UI copy and taxonomy;
- zero-request and zero-renderer evidence;
- responsive/a11y/visual matrices;
- explicit non-completion of Studio 3A, real 3B, Mobile AI Workbench, Knowledge, and Dispatch;
- the condition that future work needs separate authority, auth, endpoint, and safety approval.

Update the README surface map from three to four routes while stating precisely that `/studio` is a truthful unavailable shell, not an enabled projection workspace. Link the new verification record without weakening the existing Presence/Control/Mobile boundary statements.

Run from `webapp`:

```powershell
npm run test:run
npm run test:coverage
npm run lint
npm run typecheck
npm run build
npm run test:e2e -- --list
npm run test:e2e:no-build -- --grep-invert "real hidden Mobile page retains zero application RAF without synthetic visibility"
npm run test:e2e:no-build -- e2e/mobile-performance.spec.ts -g "real hidden"
npm run check:presence-budgets
npm run check:presence-boundaries
npm run check:control-boundaries
npm run check:studio-boundaries
npm run check:mobile-boundaries
```

The focused real-hidden command is an evidence run, not an expected green command. Capture its output and continue to the budget/boundary sequence even if the unchanged Windows Chromium lifecycle limitation produces the documented hard failure. Never skip, synthesize, or relabel that gate.

Then from repository root:

```powershell
git diff --check
git status --short
git diff --name-only 825d558 -- src tests integrations pyproject.toml requirements.txt uv.lock
```

Expected:

- focused and full unit tests pass;
- coverage, lint, typecheck, production build/discovery, Studio browser/a11y/visual suites, and all four boundary checkers pass;
- the complete eligible Presence, Control, Studio, and Mobile browser matrix is green after excluding only the existing separately executed real-hidden lifecycle hard gate;
- the real-hidden Mobile test is executed and recorded independently; if Chromium still cannot expose a real hidden page, report that known environment gate as blocked rather than calling the complete configured suite green;
- exactly six Studio snapshots exist and only intentional navigation pixels change in the 30 existing Presence/Control baselines; Mobile baselines remain unchanged;
- backend diff is empty.

Request three independent read-only reviews:

1. authority/truth: static unavailable semantics, forbidden claims, zero requests, and no backend drift;
2. visual/UX/a11y: Contract Horizon distinctness, datum-gap honesty, responsive geometry, theme parity, and keyboard/axe evidence;
3. boundary/test quality: scanner fail-closed behaviour, runtime probe timing, request classification, production chunk evidence, and snapshot scope.

Fix every Critical and Important finding with a RED regression test. Stage only the files named by this plan plus this plan document and the intentionally changed snapshots. Compare the cached file list to an explicit allowlist, run `git diff --check --cached`, and commit with:

```text
feat: establish the truthful Studio horizon
```

The completion statement may say that `/studio` exists and the sovereign desktop surfaces now expose the four-space IA. It must also say that Studio projections remain unimplemented/unavailable, Mobile authority/navigation was not expanded, and no backend, Run execution, Knowledge, or Dispatch capability was added.
