# ASTR Control Readiness Atlas implementation plan

> Date: 2026-07-14
> Baseline: `c8a1c8b`
> Scope: frontend-only navigation and truthful readiness dossiers for the existing 18 Control routes
> Out of scope: new Core endpoints, backend changes, fake module data, Studio, Knowledge, Dispatch, or enabling any of the 17 planned modules

## Goal

Turn the existing Control IA from one complete Effector workspace plus 17 visually identical planned covers into 18 recognisable, quickly traversable dossiers without implying that missing backend capabilities exist.

The tranche adds:

- module-specific questions and authority requirements to the single Control registry;
- local Atlas filtering by index, title, and subtitle;
- keyboard traversal and native-link activation inside the filtered Atlas;
- Escape close and focus restoration when the Atlas is opened from the header disclosure;
- same-domain previous/next dossier navigation and related-dossier links;
- responsive, day/night visual evidence for index, planned-system, planned-Soul, and Effector states;
- repayment of the Control surface's existing gradient/global-ambient debt so its static star field is structurally drawn and motionless.

## Non-negotiable boundaries

- Keep exactly 18 registered module IDs and routes: 10 system, 8 Soul.
- Keep exactly one `available` module: Effector. The other 17 remain `planned`.
- Planned dossiers expose no product button, form, chart, count, fake log, fake status, mock record, or business request.
- Registry copy may state what a module must answer and what authority is missing; it must not state that any runtime fact exists.
- Effector keeps the existing six contracts and remains the only interactive Admin workspace.
- Atlas filtering is client-local and never calls Core.
- Control is 0 Canvas, 0 WebGL, 0 route-owned RAF, 0 continuous animation, no green, no gradients, and no glass/backdrop filter after this tranche.
- Give Control an explicit route-surface marker, suppress the global ambient/grain layers on that surface, and remove the existing Control-owned gradient/mask declarations rather than merely avoiding new ones.
- Preserve the current sovereign spine, native disclosure, theme geometry, skip links, semantic landmarks, and cross-space Presence/Mobile links.
- Do not modify `src/astr/**`, backend tests, Python dependencies, rewrites, or mock Core endpoints.

## Task 1 — Enrich the canonical module registry

**Files**

- Modify: `webapp/src/features/control/model/control-modules.ts`
- Modify: `webapp/src/features/control/model/control-modules.test.ts`

**RED**

Extend the registry tests first. For every module require:

- two or three non-empty, module-specific `questions`;
- one or more non-empty `authorityRequirements` entries;
- one or two valid `relatedModuleIds` that exist, are not self-references, and contain no duplicates;
- runtime-frozen module objects and nested arrays (`Object.isFrozen`), not only TypeScript `readonly` declarations;
- an independent per-ID expectation table that proves every planned module has distinct topic/authority anchors and that no two complete question arrays are identical;
- questions end as questions, while planned declarative copy contains no positive runtime claim such as `已启用`, `已连接`, `运行中`, `成功`, `完成`, or `当前值`.

Retain the exact ID/href/domain/status assertions and the exact six Effector contracts.

Run:

```powershell
npm test -- --run src/features/control/model/control-modules.test.ts
```

Expected RED: the new readiness fields do not exist.

**GREEN**

Add the three readonly fields to `ControlModule` and author explicit content for all 18 entries. Freeze every module object and its `contracts`, `questions`, `authorityRequirements`, and `relatedModuleIds` arrays at runtime. The content must be functional and evidence-oriented, not decorative lore. Examples of allowed phrasing are “当前 Run 依据哪条规则选择 Provider 与模型？” and “需要按 Run 绑定的路由投影”； examples of forbidden phrasing are sample costs, sample people, fake health values, or invented records.

Run the focused test again and require PASS.

## Task 2 — Make planned routes distinct, truthful readiness dossiers

**Files**

- Modify: `webapp/src/features/control/components/ModuleDossier.tsx`
- Modify: `webapp/src/features/control/components/ModuleDossier.test.tsx`
- Modify: `webapp/src/features/control/components/ControlShell.module.css`

**RED**

Add component tests that require a planned dossier to render:

- its existing title, subtitle, status, summary, and prerequisite;
- a “此档案必须回答” section containing its exact module questions;
- a “尚未接入的权威证据” requirements ledger containing its exact authority requirements and explicitly stating that the planned route has no web contract yet;
- a “相关档案” navigation containing only the registered related modules;
- a “同域档案” navigation with correct previous/next links;
- no buttons, forms, inputs, selects, textareas, editable content, or button/radio/switch/combobox roles inside `main`.

Add first/last domain boundary cases with non-wrapping semantics: A01 has no previous, A10 has no next, S01 has no previous, and S08 has no next. Assert exact link counts and hrefs so previous/next never crosses system/Soul domains. Keep the existing isolated Effector-contract test.

Expected RED: the readiness and navigation regions do not exist.

**GREEN**

Render the readiness material on the 17 planned `ModuleDossier` routes as one asymmetric dossier flow, not a card grid. Use ruled evidence rows, a clipped chapter marker, and deliberate whitespace. Keep stable rectangular text and navigation hit areas of at least `var(--touch-target)`. Same-domain order comes only from `CONTROL_MODULES.filter(domain)`, does not wrap, and may point to Effector. Effector remains its existing functional workspace and traverses the complete IA through the shared header Atlas; do not force the planned readiness body into `EffectorWorkspace`. Do not add decorative motion.

Run:

```powershell
npm test -- --run src/features/control/components/ModuleDossier.test.tsx
```

Expected: PASS.

## Task 3 — Add local Atlas search and keyboard traversal

**Files**

- Modify: `webapp/src/features/control/components/ControlAtlas.tsx`
- Modify: `webapp/src/features/control/components/ControlAtlas.test.tsx`
- Modify: `webapp/src/features/control/components/ControlShell.tsx`
- Modify: `webapp/src/features/control/components/ControlShell.test.tsx`
- Modify: `webapp/src/features/control/components/ControlShell.module.css`

**RED**

Add tests requiring:

- one native `type=search` input labelled “检索 18 个模块”;
- case-insensitive filtering by module index, title, and subtitle;
- matching links retain their real href, status, domain, and `aria-current`;
- a visible `role="status"` no-result message with exact copy “未找到匹配档案 · 18 条真实路由保持不变”, without introducing an empty product state or a second application-wide announcer;
- ArrowDown/ArrowUp move focus through only visible results with wraparound;
- Enter remains native link activation after focus movement;
- Escape clears a query on the root Atlas;
- Escape in the disclosure Atlas closes the native `details` and restores focus to its `summary`;
- opening the disclosure focuses the search input only after a real closed-to-open `toggle`, without mount-time autofocus or focus theft on the root route;
- activating a disclosure result does not prevent the native link default, closes the panel without pulling focus back to the old summary, clears the query, reveals the destination dossier, and the next opening restores all 18 links;
- pathname change defensively closes and resets a disclosure that survived layout persistence;
- search `ArrowDown` focuses the first visible result, search `ArrowUp` the last, and result Up/Down wraps only within the filtered sequence; zero results keep focus in search;
- Enter is never intercepted; root Escape clears and refocuses search, while disclosure Escape always clears, closes, and restores summary focus;
- `isComposing`, keyCode 229, or Alt/Ctrl/Meta-modified events never navigate, clear, or close;
- the root Atlas is the `page` variant and owns the page `h1`; the disclosure Atlas is the `disclosure` variant with a subordinate heading, unique label/input IDs, and no duplicate `h1`.

Expected RED: no search or keyboard contract exists.

**GREEN**

Make `ControlAtlas` a small client component. Keep the complete registry as its only data source. Filtering must be synchronous and local. Use actual link focus rather than an invented command palette or hidden duplicate navigation. Accept a required `variant: "page" | "disclosure"` plus explicit disclosure-mode focus/close props so the two placements share one implementation without sharing focus policy. `onToggle` is the native open/closed fact source. When the disclosure is open, make the covered `main` inert so Tab and assistive technology cannot enter the obscured page; remove inert on close. Clear disclosure state on Escape, native-link activation, and pathname change.

`ControlShell` may coordinate the native disclosure, inert page state, reset, and focus only; it must not own filtering or duplicate module data. Rewrite the legacy tests that expected summary focus immediately after opening: the new intentional contract is one search focus transfer per closed-to-open transition.

Run:

```powershell
npm test -- --run src/features/control/components/ControlAtlas.test.tsx src/features/control/components/ControlShell.test.tsx
```

Expected: PASS.

## Task 4 — Browser, responsive, accessibility, and visual evidence

**Files**

- Modify: `webapp/e2e/control.spec.ts`
- Modify: `webapp/e2e/control-a11y.spec.ts`
- Modify: matching `webapp/e2e/control.spec.ts-snapshots/*.png`
- Modify: `webapp/docs/control-verification.md`
- Modify: `webapp/src/app/globals.css`
- Modify: `webapp/scripts/check-control-boundaries.mjs`
- Modify: `webapp/scripts/check-control-boundaries.test.mjs`

**RED**

Add browser assertions for:

- search by `A03`, `星门`, and title; each exposes only the intended real link;
- keyboard Arrow navigation plus Enter reaches the selected route;
- Escape closes the disclosure and returns focus;
- every planned route has at least two module-specific questions, at least one authority-requirement row, zero product controls, and zero Core/business requests;
- a single request-ledger classifier counts same-origin `/api/core/**` and direct requests to the configured/mock Core origin, but excludes Next documents, RSC, chunks, fonts, and static assets; install it before `goto`, wait for a named hydration witness plus one macrotask, and require zero for all 17 planned routes, Atlas input/Arrow/Escape, and planned-to-planned navigation;
- from each of the 18 origin routes, opening the disclosure exposes the exact 18 unique registered hrefs; define the pointer/touch two-interaction path as activating the summary then a direct native link, while keyboard access uses one continuous, wraparound filtered result sequence; use one representative pointer route and one keyboard-filtered route to prove navigation, panel closure, and query reset rather than running a 324-route Cartesian matrix;
- 320/390/768/1440 CSS-pixel layouts have no horizontal overflow;
- at 320/390/768/1440, explicitly exercise the index, `model-router`, `memory`, and disclosure-open filtered state;
- 200% and 400% equivalents open the disclosure, search `A03`, focus the result, then Escape, while search, result, and summary remain inside the horizontal viewport;
- axe reports zero critical or serious violations for the index, one system planned dossier, one Soul planned dossier, Effector, disclosure-open filtered, and disclosure no-result states;
- while the disclosure is open, the covered `main` is inert and Tab cannot enter either the root Atlas or destination controls behind it;
- Control owns no Canvas/WebGL, no application RAF, no `gradient(` or CSS `animation:` declarations; the rendered Control surface reports the global ambient/grain hidden, `animation-name: none`, and no running infinite animation.

Refresh only the Control baselines whose intentional pixels change. The required matrix is:

- index: `control-1440x1000-{dark,light}.png` and `control-390x844-{dark,light}.png`;
- system planned dossier: `control-model-router-{1440x1000,390x844}-{dark,light}.png`;
- Soul planned dossier: `control-memory-{1440x1000,390x844}-{dark,light}.png`;
- Effector: `control-effector-{1440x1000,390x844}-{dark,light}.png`, in addition to its existing functional browser coverage;
- disclosure open and filtered by `A03`: `control-atlas-filtered-{1440x1000,390x844}-{dark,light}.png`.

The visual matrix therefore contains exactly 20 intentional Control screenshots. Generate only with:

```powershell
npm run test:e2e -- e2e/control.spec.ts --update-snapshots
npm run test:e2e:no-build -- e2e/control.spec.ts
```

The first command intentionally creates a fresh source-stamped production build before updating pixels; the second is the required no-update proof. Inspect every changed baseline individually between the two commands.

## Task 5 — Full verification and scope audit

Run in order from `webapp`:

```powershell
npm run test:run
npm run test:coverage
npm run lint
npm run typecheck
npm run test:e2e -- --list
npm run test:e2e:no-build -- e2e/control.spec.ts e2e/control-a11y.spec.ts
npm run check:presence-boundaries
npm run check:control-boundaries
npm run check:mobile-boundaries
```

Then from repository root:

```powershell
git diff --check
git status --short
git diff --name-only -- src tests integrations pyproject.toml requirements.txt uv.lock
```

Expected:

- all focused and full unit tests pass;
- coverage, lint, typecheck, production discovery, Control browser/a11y/visual, and all three boundary checkers pass;
- backend diff is empty;
- no unrelated file is staged.

`npm run test:e2e -- --list` is intentionally the stamped production-build discovery step. Do not replace it with a direct no-build invocation before the source/build identity exists.

## Task 6 — Independent review and exact commit

Request two read-only reviews:

1. truth/authority review: planned copy, zero requests, exact 17/1 status split, no invented operations;
2. UX/a11y review: search keyboard model, focus restoration, responsive geometry, and visual baseline scope.

Fix all Critical and Important findings with RED tests before staging. Record the pre-task `git status --short`. Stage only the files named by this plan plus the exact 20 changed Control snapshots and this plan document. Compare `git diff --cached --name-only` against an explicit allowlist and run `git diff --check --cached` before committing. Commit with:

```text
feat: deepen the Control readiness atlas
```

The completion statement must say that the Admin IA and navigation are deeper while 17 modules remain planned. It must not claim those modules, Studio, Knowledge, or Dispatch are implemented.
