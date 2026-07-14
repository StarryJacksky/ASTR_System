# Studio verification

`/studio` is a truthful unavailable surface, not an enabled Studio workspace. The current Core has no authorised `/v1/studio/*` read contract, stable Workspace/Run authority, authenticated Studio scopes, or security-reviewed thin projection endpoints. This tranche changes only the frontend and does not open the Workstream 3A implementation gate.

## Truth contract

The route renders these exact primary statements:

- `Studio 投影未启用`
- `缺少已授权 authority、认证 scopes 与只读 endpoints。`
- `没有可验证的 Run、模型路由、成本或产物数据。`
- `当前 Core 未提供 /v1/studio/* 读取合同；本页面不会发起 Studio 资源请求。`

Workspace, Run, Tool, Trace, Source, and Artifact are displayed only as a frozen contract taxonomy. Every category is `unavailable`; the list is explicitly identified as a category directory rather than a process or connection state.

The whole Studio route surface allows only three non-prefetched native exits (Presence, Control, Mobile) and the existing theme/motion controls. It has no Run, Prompt, Approve, Tool, Download, Retry, editor, form, upload, disabled pretend-action, live progress, mock record, count, timestamp, model, provider, route, cost, source, trace, file, or artifact.

## Authority and request boundary

Studio owns no client, data adapter, controller, effect, environment read, business endpoint, SSE, WebSocket, or request primitive. The single `/v1/studio/*` source literal is allowed only as the exact visible boundary sentence above. The source scanner rejects that fragment in constants, links, form actions, templates, concatenation, request arguments, or any other executable context.

The browser request ledger is installed before navigation and classifies direct mock/configured Core traffic plus same-origin `/v1/**` and `/api/core/**`. It also detects cross-space Next prefetch headers. Acceptance requires zero Studio/Core business requests and zero cross-space prefetches through hydration and a later macrotask.

## Visual and runtime boundary

Contract Horizon is a static optical workplane:

- one cut-corner outer instrument frame;
- one horizontal datum and one uncloseable contract gap;
- six isolated, text-backed registrations that do not touch the datum;
- transparent internal regions with open separators rather than a card/dashboard wall;
- no arrow, coordinate, radar, ring, crosshair, scan line, decorative star field, ungrounded tick, gradient, glass, blur, glow, CSS animation, Canvas, WebGL/WebGPU, Pixi, Live2D, Three, framer-motion, or route-owned RAF.

Presence retains the existing S-wave relay motif. Studio does not copy that orbit, Control's archive/spine, or Mobile's vertical relay mast. Day/night themes change material colours only; the measured geometry is required to remain within one CSS pixel.

## Automated matrix

Unit and source gates cover:

- exact six-entry frozen taxonomy and forbidden runtime-shaped fields;
- one SSR-safe route, one h1, exact copy, semantic fact/register/gate regions, and the whole-surface interaction allowlist;
- CSS material/HUD budgets, 320px/short-height reflow rules, safe areas, and the single cut-corner/datum/gap budget;
- recursive local dependencies across TS/JS/CJS/CTS/CSS, fail-closed computed or opaque imports, request/render/material primitives, endpoint context, action markup, and Studio client/mock fallbacks;
- fresh stamped production identity, `/studio/page` server/app-path evidence, client-reference manifest, nonzero resolved chunks, existing chunk files, and heavy/runtime byte rejection.

Browser acceptance covers:

| Matrix | Required evidence |
| --- | --- |
| Route truth | HTTP 200, exact metadata and copy, six unavailable registrations, three implementation gates |
| Requests | zero Studio/Core business requests; zero cross-space prefetch |
| Runtime | zero Canvas; zero successful WebGL/WebGPU context; zero active RAF; ambient/grain hidden |
| Responsive | 320, 390, 768, 1440 CSS px; 200% and 400% equivalents; no horizontal overflow |
| Accessibility | dark/light desktop and mobile plus 400%; zero axe critical/serious; complete skip and keyboard path |
| Visual | 1440×1000, 390×844, and 320×720 in dark/light; exactly six Studio baselines; ≤1px theme geometry delta |

Presence and Control visual baselines change only because each now exposes the real, non-prefetched Studio route. Mobile source, authority, navigation, and pixels remain unchanged.

## Recorded evidence — 2026-07-14

The final source and freshly stamped production build produced this evidence:

- Vitest: 101 files and 1,713 tests passed; the Studio boundary scanner's adversarial fixture suite passed 226/226.
- Coverage: 92.35% statements, 91.99% branches, 94.04% functions, and 93.32% lines overall; the Studio-specific 100% lines/statements/functions and 95% branch thresholds passed.
- Playwright Studio matrix: 17/17 passed, including Presence/Control idle-prefetch evidence, dark/light, 320/390/768/1440 CSS px, 200%/400% equivalents, axe, exact keyboard closure, SSR without JavaScript, request accounting, Canvas/WebGPU ownership probes, and six visual baselines.
- Presence + Control + Studio visual/function proof: 55/55 passed without snapshot updates.
- Full eligible browser matrix: 196 passed, two explicit opt-in cases skipped, and zero failed across the 198-test run.
- Fresh production checks passed for Presence assets, Presence boundaries, Control boundaries, Studio boundaries, and Mobile boundaries. Studio scanned six source files and three resolved production chunks with zero violations.
- Presence delivery budgets passed on the static fallback. Dynamic certification remains incomplete by contract: 19 Live2D assets verify, two audio assets are missing, and one model manifest differs from the lock.
- ESLint and TypeScript passed; the optimized build generated 30 static/SSG pages including `/studio`.

The separately required real-hidden Mobile lifecycle run remains environment-blocked. Chromium reached the real window-minimisation path, but its cleanup rejected a direct resize while the window was still minimised (`Browser.setWindowBounds`: restore to normal first). This is recorded as one failed hard-evidence run, not relabelled as a product pass or skip. The eligible matrix excludes only this named environment-dependent case.

## Verification commands

Run from `webapp` after the source is final:

```powershell
npm run test:run
npm run test:coverage
npm run lint
npm run typecheck
npm run build
npm run test:e2e -- --list
npm run test:e2e:no-build -- --grep-invert "real hidden Mobile page retains zero application RAF without synthetic visibility"
npm run check:presence-budgets
npm run check:presence-boundaries
npm run check:control-boundaries
npm run check:studio-boundaries
npm run check:mobile-boundaries
```

The Mobile real-hidden lifecycle test remains a separate hard evidence run. If the Windows Chromium environment still never exposes a real hidden page, record that known blocker without synthesising the lifecycle or relabelling it as a pass/skip.

## Explicitly incomplete

This tranche does not implement or authorise:

- Studio 3A authority, ownership, persistence, authentication, scopes, or read endpoints;
- a projection-dependent real 3B Workspace/Run workplane;
- model routing, per-run cost, Tool, Trace, Source, or Artifact data;
- Mobile AI Workbench, Knowledge, Secure Dispatch, remote-computer operation, approval, ACK, or artifact download;
- any backend route, test, dependency, rewrite, mock endpoint, or private-data bridge.

Future Studio implementation requires separate approval for stable authority/ownership, authenticated principal/scopes, legacy-data handling, security review, and thin read-only projection endpoints. Until then, `unavailable` must not be replaced by `empty`, `forbidden`, `error`, fake data, or disabled product theatre.
