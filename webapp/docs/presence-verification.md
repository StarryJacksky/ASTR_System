# ASTR Presence verification

This document defines the evidence boundary for the 星枢 Presence route. It is an acceptance contract, not a claim that every optional visual asset or fixed-hardware profile is currently certified.

## Canonical automated sequence

Run the gates sequentially from `webapp` so fixed ports and evidence files cannot race:

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
npm run test:e2e:real
```

`test:e2e` is the canonical mock-Core browser command. It rebuilds Next with both `ASTR_CORE_URL` and `NEXT_PUBLIC_ASTR_CORE` fixed to the isolated mock origin, refuses occupied ports, validates a per-run mock nonce, and cleans up its owned process tree. `test:e2e:no-build` is only an iteration helper; it refuses a `.next` directory whose Core identity or source fingerprint differs from the current tree.

`check:presence-budgets` is self-contained: it first builds and runs the focused production-browser evidence profile, then schema-validates and evaluates the fresh desktop/mobile artifacts. Run it before `check:presence-boundaries`; the boundary gate deliberately refuses missing or stale production build evidence. These fixed-port commands must not run in parallel.

Playwright browsers are stored outside the system drive for this workspace:

```text
D:\ASTR_System\.playwright-browsers
```

The npm cache used to install the acceptance dependencies is also workspace-local at `D:\ASTR_System\.npm-cache`.

## Hard automated budgets

Every applicable delivery row below requires measured raw evidence. `unsupported`, `not-run`, a missing row, an empty sample set, a negative sample, or a non-finite sample fails `check:presence-budgets`, except where the schema explicitly records that the static path has no renderer. Reduced-motion, paused, and offscreen RAF are separate hard sub-gates; a browser that cannot expose a true hidden lifecycle must retain that sub-gate as incomplete rather than infer a pass.

| Metric | Desktop | Mobile |
| --- | ---: | ---: |
| WebGL contexts | 1 | 1 |
| active app-owned RAF/ticker | 1 | 1 |
| hidden/offscreen/reduced/paused app-owned RAF | 0 | 0 |
| effective DPR | 1.5 | 1.25 |
| draw calls | 110 | 96 |
| triangles | 8,000 | 8,000 |
| texture + render-target bytes | 67,108,864 | 33,554,432 |
| optional visual transfer bytes | 4,000,000 | 1,500,000 |
| active Jewel | 1 | 1 |
| Lens bundle gzip bytes | 25,000 | 25,000 |
| any long task during the 10-second stream | 50 ms | 50 ms |

Limits are inclusive: equality passes, the smallest value above the limit fails. The schema extension in `e2e/evidence.schema.json` is the budget single source of truth.

## Evidence status semantics

- `measured`: an automated row contains raw non-negative finite samples and participates in the hard gate.
- `passed` / `failed`: an explicit result for fixed-hardware or manual certification.
- `unsupported`: the declared environment cannot expose the measurement. This is never converted into an automated pass.
- `not-run`: the profile was not executed. It keeps certification incomplete.
- `not-applicable`: allowed only for renderer-only evidence when the measured delivery path is the static fallback and no renderer exists; it is not a numeric zero.

Environment-independent limits must never be omitted or inferred from a mock. Fixed-hardware CWV/GPU rows and manual AT/device/IME rows may remain `unsupported` or `not-run`, but the artifact must retain them.

Optional visual transfer includes both `/live2d/**` assets and production-only visual chunks identified from the built route/request delta. Lens gzip uses the shipped production chunk bytes, not TypeScript source size.

## Current Live2D certification boundary

`npm run check:presence-assets` requires the StaticSoulLens delivery path and emits a structured dynamic certification report. At the 2026-07-13 workspace snapshot the report is intentionally:

- `staticFallbackAvailable=true`;
- `dynamicCertified=false`;
- one model3 byte/hash mismatch;
- two missing referenced audio files.

This is not a browser failure: the route must fail closed to the static Soul Lens and keep chat, Life, safety, theme, and navigation usable. It is also not permission to claim the dynamic Live2D path is certified. Use `npm run check:presence-assets:dynamic` when all locked assets are intentionally present; that strict command remains nonzero until every byte passes the existing verifier.

No verification command downloads, replaces, or rewrites local Live2D assets.

## Real Core smoke

Mock Core proves deterministic UI behavior only. The real integration profile is read-only and matches only `e2e/presence-real-smoke.spec.ts`; it performs GET/SSE observation and contains no ingest, e-stop, reset, enrollment, or other mutation.

Without an explicit URL:

```powershell
npm run test:e2e:real
```

the command exits successfully with a `real-core-read-only-smoke` evidence row whose status is `not-run`. To execute it:

```powershell
$env:ASTR_REAL_CORE_URL = "http://127.0.0.1:8300"
npm run test:e2e:real
```

The real profile must fail if the configured Core cannot satisfy current status/SSE integration. It must never fall back to mock evidence.

## Soak and fixed-hardware profiles

The short profile validates the harness without claiming the 30-minute fixed-hardware budget:

```powershell
npm run presence:soak
```

The full profile is deliberately opt-in:

```powershell
$env:ASTR_PRESENCE_SOAK_PROFILE = "full"
$env:ASTR_PRESENCE_SOAK_CAPABLE = "1"
npm run presence:soak
```

It runs for at least 1,800,000 ms. Post-GC heap growth must be strictly less than 10 MiB. If explicit GC or the required memory evidence is unavailable, the fixed-hardware row is `unsupported`/`not-run`, never passed. A full request without `ASTR_PRESENCE_SOAK_CAPABLE=1` does not launch a browser and records `not-run`.

The fixed 5 cold / 5 warm profile additionally budgets visual JS P95 at 4/6 ms, GPU P95 at 6/8 ms, LCP at 2,500 ms, INP at 200 ms, CLS at 0.1, and TBT at 200 ms. These results require a declared browser/OS/CPU/GPU and throttle state.

## Manual evidence rows

The following remain manual evidence and are never inferred from Playwright:

- NVDA, VoiceOver, and TalkBack reading and focus behavior;
- real soft keyboards;
- Microsoft, macOS, Japanese, and Gboard IME behavior;
- real mobile viewport chrome and safe-area behavior;
- fixed-device GPU timing when browser timer queries are unavailable.

Record each row as `passed`, `failed`, `unsupported`, or `not-run`, with device and version notes.

## Product boundaries guarded by the harness

- The backend contract remains status, ingest ACK, named SSE, transcription, voiceprint, and local effector safety only.
- Presence may show Task as unavailable; it may not invent Task/artifact/approval/device/provenance APIs or completed state.
- `soul.stream` remains provisional and `soul.decision` remains authoritative.
- The initial production route must not statically include the Live2D lock, verifier, 2048 texture paths, or a private Pixi/Live2D runtime.
- One Presence runtime owns visual context/ticker/RAF APIs. Mobile, reduced-motion, hidden, offscreen, paused, context-lost, and invalid-asset paths remain truthful static fallbacks.
- Green hardcodes are rejected through the constitutional no-green scanner used by the source boundary command.
