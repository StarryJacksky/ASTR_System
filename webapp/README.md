# 星枢 ASTR Web

ASTR Web is the frontend for 星枢: a Presence-first interface that keeps functional AI work, emotional continuity, Soul identity, Life context, and safety evidence in one coherent system.

The frontend currently delivers the `/` Presence route, the `/admin` Control archive, and a five-domain `/mobile` shell. All three surfaces use existing Core contracts only. Control exposes only Effector as available; its other 17 modules remain explicitly planned. Mobile keeps Workbench and Knowledge unavailable and Tasks browser-local until authorized contracts exist. No surface invents backend Task, artifact, approval, device, model-router, plugin, memory, training, migration, provenance, or remote-computer APIs.

## Run locally

Requirements:

- Node `^20.19.0 || ^22.13.0 || >=24.0.0`
- npm `10.8.2`
- ASTR Core at `http://127.0.0.1:8300`, or an explicit `ASTR_CORE_URL`

```powershell
npm install
npm run dev
```

Open `http://localhost:3100`.

The frontend proxy uses `ASTR_CORE_URL`; the browser SSE client uses `NEXT_PUBLIC_ASTR_CORE`. When changing the latter for a production run, rebuild Next because public environment variables are embedded at build time.

## Presence architecture

- Chat is the primary working field, with balanced and explicit deep-dialogue layouts.
- Soul remains mounted while chat and Life states change.
- The fixed S-shaped orbit expresses navigation state without fabricating empty data.
- `soul.stream` is provisional; only `soul.decision` is authoritative.
- ACK, stream, decision, timeout, late final, SSE gaps, Core reachability, and safety readback remain distinct UI facts.
- One owned Pixi runtime may create the visual context and ticker. Mobile, reduced-motion, hidden, offscreen, paused, context-lost, and invalid-asset paths fail closed to the static Soul Lens.
- Day and night themes invert material treatment while preserving geometry and semantic state.
- The visual palette is blue/violet/black; the constitutional no-green scanner is an automated boundary.

## Mobile architecture

- `/mobile` redirects to `/mobile/presence`; the five explicit domains are Presence, Tasks, Workbench, Knowledge, and Safety.
- Presence and Safety mount trusted clients only when both server Core targets and the browser hostname are exact loopback authorities. The server shares only the resulting boolean, never the private Core target.
- Tasks stores explicit, unencrypted text drafts only in this browser under `astr.mobile.task-drafts.v1`; it sends no task and makes no network request.
- Safety is a local, read-only projection over exactly three existing Effector GET endpoints. It has no mutation path.
- Workbench/Studio, a Knowledge corpus, Secure Dispatch, and remote-computer control remain unavailable until authority, authentication, scopes, endpoints, approval, and ACK contracts exist.

## Verification

The complete automated gate is intentionally sequential:

```powershell
npm run test:run
npm run test:coverage
npm run check:presence-assets
npm run check:presence-budgets
npm run check:presence-boundaries
npm run lint
npm run typecheck
npm run build
npm run test:e2e
npm run check:control-boundaries
npm run check:mobile-boundaries
npm run test:e2e:real
```

Useful focused commands:

```powershell
npm run test:e2e:no-build
npm run check:presence-assets:dynamic
npm run presence:soak
```

`check:presence-budgets` performs its own fresh production-browser collection and must run before the fail-closed build boundary check. `test:e2e:no-build` refuses stale Core/build/source identity. `test:e2e:real` is read-only and writes `not-run` evidence unless `ASTR_REAL_CORE_URL` is explicitly provided. The default asset gate accepts the truthful static fallback while reporting `dynamicCertified=false`; the strict dynamic command fails until every locked Live2D byte is present and verified.

See [Presence verification](docs/presence-verification.md) for exact desktop/mobile budgets, evidence semantics, real-Core setup, fixed-hardware profiles, soak rules, and manual AT/device rows. See [Control verification](docs/control-verification.md) for the six allowed Effector endpoints, planned-module boundary, build evidence order, and Control screenshot matrix. See [Mobile verification](docs/mobile-verification.md) for authority, route, storage, GET-only, bundle, browser, and pending real-device evidence. See [Live2D assets](docs/live2d-assets.md) for source, lock, and license details.

## Repository boundaries

- `src/features/presence/` — Presence model, controller, UI, and the single visual runtime.
- `src/features/mobile/` — five-domain Mobile metadata, authority gate, shell, local drafts, trusted projections, and capability boundaries.
- `src/components/system/` — app-wide semantic, theme, motion, and announcement bridges.
- `e2e/` — Playwright acceptance profiles and the protocol-faithful mock Core.
- `scripts/check-presence-*.mjs` — source/build/asset certification gates.
- `live2d-assets.lock.json` — immutable asset inventory; local binaries remain ignored.

Do not copy private Core data, secrets, or unlicensed visual assets into browser fixtures. Mock evidence proves deterministic frontend behavior only; it is never a substitute for real-Core, real-device, assistive-technology, or fixed-hardware evidence.
