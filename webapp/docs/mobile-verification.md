# Mobile verification

Mobile W4 is a truthful local shell, not a remote-control product. Its acceptance target is five stable routes, strict local authority, browser-local drafts, an existing-Core Presence projection, a GET-only Safety projection, and explicit unavailable states. Closing this shell tranche does not close the full Mobile workstream: W4 remains `partial`.

## Routes and capability truth

| Route | Current capability | Contract boundary |
| --- | --- | --- |
| `/mobile/presence` | Trusted-local Presence projection | Mounts the existing Presence owner only after both authority checks pass. |
| `/mobile/tasks` | Browser-local text drafts | Does not send, schedule, approve, or acknowledge a task. |
| `/mobile/workbench` | Unavailable capability gate | Studio projection, Run data, model routing, cost, artifacts, authority, auth scopes, and read endpoints are not implemented. |
| `/mobile/knowledge` | Unavailable capability gate | No authorized, verifiable Knowledge corpus or read endpoint is implemented. |
| `/mobile/safety` | Trusted-local, read-only Safety projection | Reads three existing Effector endpoints only; it cannot mutate policy or device state. |

`/mobile` redirects to `/mobile/presence`. These are five explicit App Router pages; there is no catch-all domain route, dynamic production domain loader, or production mock page. The shared domain registry contains navigation metadata only and must not import domain business implementations.

Studio, a Knowledge corpus, Secure Dispatch, remote-computer operation, remote-device presence, approval, and ACK are future capabilities. Mobile must not claim an online computer, invent authority or authentication, synthesize their data, or add speculative APIs to make those surfaces appear complete.

## Dual loopback authority

Presence and Safety are trusted only when two independent facts agree:

1. On the server, both `ASTR_CORE_URL` and `NEXT_PUBLIC_ASTR_CORE` must be credential-free HTTP(S) URLs whose hostname is exactly `localhost`, `127.0.0.1`, `[::1]`, or `::1`. Either remote, malformed, or credential-bearing target fails closed. Omitted values use the loopback default `http://127.0.0.1:8300`.
2. In the browser, `window.location.hostname` must independently match the same exact loopback hostname set. It is checked after hydration and again on `pageshow`.

The Server Component passes one non-sensitive boolean to the client authority provider. It never serializes `ASTR_CORE_URL`, either target URL, a hostname, or a port as authority data. `NEXT_PUBLIC_ASTR_CORE` remains the existing public Presence transport setting and may be embedded by Next; Mobile does not expose it again through UI or context.

Only the combined `trusted-local` state may mount Presence or Safety owners. `checking`, a failed server check, and a remote browser origin must render the unavailable gate, initiate zero Mobile business requests, and expose no cross-space `/` or `/admin` bypass link.

Core identity is part of the production artifact. Next embeds `NEXT_PUBLIC_*` values at build time, so changing `NEXT_PUBLIC_ASTR_CORE` requires a new build. For browser evidence, use `npm run test:e2e`, which builds with one isolated Core origin for both Core variables and writes `.next/astr-e2e-build.json`. `npm run test:e2e:no-build` is iteration-only and must refuse a stale Core identity or source fingerprint; do not use it to certify a changed target.

## Local Tasks storage

Tasks owns the single localStorage key:

```text
astr.mobile.task-drafts.v1
```

It stores bounded schema-versioned text drafts only after the user explicitly selects “保存到此浏览器”. The data is browser-local and unencrypted; credentials and secrets do not belong in it. Unsaved editor text is not a hidden queue and is not restored after the route unmounts. Tasks performs no network request, clipboard write, device discovery, dispatch, approval, or ACK operation. Until Secure Dispatch has authenticated device identity, authorization scopes, approval semantics, and an ACK contract, the editor remains draft-only.

## Safety read boundary

The Mobile Safety client may issue only these three cache-bypassing requests:

```text
GET /api/core/v1/effector/status
GET /api/core/v1/admin/effector/policy
GET /api/core/v1/admin/effector/audit
```

It exposes minimal status, policy, and audit projections and keeps their loading, ready, stale, empty, and error states independent. It does not import the mutation-capable Control client and has no `POST`, `PUT`, `PATCH`, or `DELETE` operation. Remote or checking authority must prevent the client from mounting at all.

## Source, route, and chunk boundaries

Production Mobile code must satisfy all of these rules:

- no fabricated product data, production mock transport, undocumented endpoint, W5 type, or speculative mutation;
- exactly the five domain routes above, with server route and build-manifest evidence for each;
- no cross-domain business imports in route-owned chunks; framework, shell, authority, navigation, shared metadata, and shared CSS may be shared;
- no Pixi, Live2D, Three, framer-motion, Canvas, WebGL, requestAnimationFrame loop, continuous animation, green token/literal, gradient, or backdrop-filter in the Mobile production surface;
- no heavy Presence visual runtime in Mobile Presence; its static Lens and semantic projection are intentional;
- no Safety mutation verb, mutation client, or route-owned mutation byte;
- tests, declarations, fixtures, and snapshots are excluded from production scanning and cannot serve as production evidence.

Mock Core evidence proves deterministic frontend behavior only. It is not proof of a real Core, a real device, a real assistive-technology session, a remote computer, or a production network. `check:mobile-boundaries` is the fail-closed source/build gate. It accepts only a fresh `.next/astr-e2e-build.json` whose build ID and source fingerprint match the current production output, then verifies the five server entries, route manifests, route-owned modules, and client chunks.

## Browser, device, and AT status

| Evidence | Status | Required interpretation |
| --- | --- | --- |
| Component/unit, coverage, lint, typecheck, six-route production build, and stamped source/chunk boundary | Complete for the assembled shell | Does not replace route-level browser evidence. |
| Trusted and remote-origin request/authority matrix | Automated evidence complete | Remote Presence/Safety gate before owner mount, expose no root/Admin bypass, make zero business requests, and leave all seven mock counters at zero. |
| Axe, app-owned live region, overflow, 200%/400% reflow, focus, and desktop soft-keyboard contraction proxy | Automated desktop evidence complete | The Mobile document owns exactly one live region: the app StateAnnouncer. While Mobile is mounted, Next's framework announcer is neutralized and Mobile route changes are republished through the app-owned announcer. Desktop simulation is not a real mobile keyboard or screen reader. |
| Five domains × dark/light × 390×844/430×932 visual baselines | Automated evidence complete | All 20 named screenshots passed without updates and were individually inspected with `view_image`. |
| LCP, CLS, TBT, Event Timing, and lab interaction proxy | Laboratory metrics complete; real-hidden gate blocked | The measured thresholds pass, but this Windows Chromium automation environment never exposes a real hidden page. Field INP also remains pending. |
| Pixel 6a, Android Chrome, real soft keyboard, and TalkBack | Pending real-device/manual AT run | Must remain explicitly pending; Playwright cannot certify these rows. |

The route-level matrix covers 320, 390, 430, and 768 CSS-pixel widths, dark/light themes, reduced motion, 200%/400% equivalents, and focused inputs above the fixed navigation. W4 is not fully accepted because the required real-hidden Chromium gate is still red. It also remains `partial` while the real-device/AT rows and future product contracts above are incomplete.

## Task 10 evidence snapshot — 2026-07-14

The authoritative production build exposed all six Mobile routes. Playwright discovery listed 160 tests in 13 configured files, including 71 tests across all five non-empty Mobile spec files. The Mobile boundary mutation suite passed 85/85. The stamped production checker scanned 36 source files, found exactly the five domains, checked client-chunk ownership as Presence 2, Tasks 1, Workbench 0, Knowledge 0, and Safety 1, and reported zero violations. Mock Core contract tests passed 26/26. The fresh repository unit run passed 1,439/1,439 across 95 files; coverage was 92.3% statements, 91.99% branches, 93.93% functions, and 93.28% lines; lint and typecheck both exited zero.

The eligible Mobile browser matrix has 70 passing tests after excluding only the separately hard-failing real-hidden gate:

- authority 4/4, including absolute `astr-remote.test` fail-closed checks;
- function 22/22, including four independent unsaved-draft remount contexts and three independent Safety error/stale/retry channels;
- accessibility and responsive geometry 29/29, with zero axe critical/serious findings in the exact 15-state matrix;
- visual 10/10, representing 20 dark/light viewport baselines, all individually inspected;
- performance formula, ambient, hydrated ambient, stable/reduced RAF, and laboratory metrics 5/5.

The complete configured browser regression run, excluding only the separately executed real-hidden gate, finished with 157 passed, two existing opt-in tests skipped by design, and zero failures across Control, Mobile, and Presence. Playwright artifacts and HTML reports are isolated under a sanitized per-invocation run ID; concurrent configuration probes resolved to distinct output directories, preventing one invocation from deleting another invocation's trace files.

Remote Presence and Safety leave `status`, `ingest`, `transcribe`, `stream`, `effector-status`, `effector-policy`, and `effector-audit` at zero. Trusted Presence performs exactly one status read, one Effector status read, and one EventSource open. Trusted Safety performs exactly its three documented GETs. Tasks, Workbench, and Knowledge perform no product operation.

The latest raw laboratory attachment used a fixed 5-second post-LCP window:

| Metric | Measured | Gate |
| --- | ---: | ---: |
| LCP | 136 ms | ≤ 2,500 ms |
| CLS | 0 | ≤ 0.1 |
| TBT | 0 ms | ≤ 200 ms |
| observed Event Timing | 16 ms | ≤ 200 ms |
| click-to-next-paint laboratory proxy | 26.2 ms | ≤ 200 ms |

All four required PerformanceObserver types were available. The evidence window ran from 136 ms through 5,136 ms and was sampled at 5,260.4 ms. This is laboratory evidence, not field INP.

The real-hidden test intentionally remains a hard failure. Bundled Chromium, installed Chrome, and installed Edge were each run headed. A user-like link opened the foreground tab in the same browser window, CDP confirmed the shared window ID, and Chromium accepted a real minimized window state; nevertheless, `document.visibilityState` remained `visible`. No synthetic event or lifecycle override was used. The application RAF probe still reported requested 0, executed 0, cancelled 0, active 0, and no application stacks while the runtime remained visible. Per the W4 plan, that is an environment blocker, not a pass or skip.

Reproduction for the default bundled browser:

```powershell
npm run test:e2e:no-build -- e2e/mobile-performance.spec.ts -g "real hidden" --headed
```

Set `ASTR_E2E_BROWSER_CHANNEL=chrome` or `msedge` to repeat the same check against an installed Chromium channel. A real Android Chrome/Pixel 6a soft keyboard run, TalkBack session, real-user monitoring, and field INP remain pending.

## Verification order

Task 9 first proves the boundary checker itself, then creates an authoritative build:

```powershell
npm test -- --run scripts/check-mobile-boundaries.test.mjs
npm run test:coverage
npm run test:e2e -- --list
npm run check:mobile-boundaries
```

The last command must report `passed:true`, exactly the five routes, `buildEvidence.status:"checked"`, real server/manifest evidence, and zero violations. A bare `next build` without the ASTR E2E stamp is not authoritative boundary evidence.

After Task 10 adds the browser matrices, run the W4 closeout gate in this order:

```powershell
npm run test:run
npm run test:coverage
npm run lint
npm run typecheck
npm run test:e2e
npm run check:presence-boundaries
npm run check:control-boundaries
npm run check:mobile-boundaries
```

Then, from the repository root, run `git diff --check`, `git diff --cached --check`, and inspect `git status --short`. The Mobile baseline-to-HEAD audit must also show no committed, logged, staged, or working-tree change under backend `src`, `tests`, `integrations`, Python dependency files, or `uv.lock`.

Acceptance closes only the W4 shell tranche when all Critical and Important review findings are zero. It does not authorize invented Studio, Knowledge, Dispatch, remote-device, approval, or ACK behavior, and it does not close the complete Mobile workstream.
