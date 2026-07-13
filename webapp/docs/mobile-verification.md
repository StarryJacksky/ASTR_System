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
| Trusted and remote-origin request/authority matrix | Pending Task 10 | Remote Presence/Safety must show gates and make zero Core requests. |
| Axe, one-live-region, overflow, 200%/400% reflow, focus, and desktop soft-keyboard contraction proxy | Pending Task 10 | Desktop simulation is not a real mobile keyboard or screen reader. |
| Five domains × dark/light × 390×844/430×932 visual baselines | Pending Task 10 | Exactly 20 inspected screenshots are required. |
| LCP, CLS, TBT, Event Timing, and lab interaction proxy | Pending Task 10 | Field INP remains pending even after laboratory gates pass. |
| Pixel 6a, Android Chrome, real soft keyboard, and TalkBack | Pending real-device/manual AT run | Must remain explicitly pending; Playwright cannot certify these rows. |

The planned route-level matrix also covers 320, 390, 430, and 768 CSS-pixel widths, dark/light themes, reduced motion, 200%/400% equivalents, and focused inputs above the fixed navigation. Do not report W4 as fully accepted until the automated rows have evidence. Even then, W4 remains `partial` while the real-device/AT rows and future product contracts above are incomplete.

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
