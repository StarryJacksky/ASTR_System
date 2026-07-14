# Control verification

`/admin` is the Control readiness atlas for the current Core boundary. It exposes exactly 18 registered routes: 17 planned, read-only readiness dossiers and one available Effector workspace. The atlas describes what each module must answer and what authority evidence is still missing; it does not invent backend capability, success state, or operator authority.

Mock-Core evidence is deterministic frontend evidence. It does not certify a deployed Core, real policy files, real audit chains, real emergency-stop hardware, or any remote-operation path.

## Route truth

The following 17 IDs remain `planned` until a real web contract exists:

- `dashboard`
- `platform-gateway`
- `model-router`
- `plugins-skills-mcp`
- `sessions-people`
- `schedule`
- `logs-trace`
- `settings`
- `resources-knowledge`
- `setup`
- `soul`
- `memory`
- `emotion`
- `moa-teaching`
- `training`
- `voice`
- `migration`

Every planned route renders module-specific required questions, missing authority evidence, related dossiers, and non-wrapping previous/next navigation within its own domain. These surfaces contain no product controls and must issue zero business requests to `/api/core/**` or direct Mock Core `/v1/**` endpoints.

Only `effector` is `available`. It renders the existing policy, audit, status, emergency-stop, and reset surfaces against the six allowed contracts below.

## Allowed Core surface

Control may call exactly these six method/path contracts:

1. `GET /v1/admin/effector/policy`
2. `PUT /v1/admin/effector/policy`
3. `GET /v1/admin/effector/audit`
4. `GET /v1/effector/status`
5. `POST /v1/effector/estop`
6. `POST /v1/effector/estop/reset`

The mock returns the same policy, audit, status, and stop-result field names as Core. Policy PUTs are cumulative and return the full effective policy. Stop and reset acknowledgements are not authority: each action must be followed by a status GET, and the readback decides what the UI may claim.

Task, device, model-router, plugin, memory, training, migration, Studio, Knowledge, Dispatch, and remote-operation contracts remain outside this workstream.

## Atlas interaction contract

The Atlas is local navigation over the same 18 real routes; filtering never manufactures or removes routes. It supports index, title, and subtitle search, including exact module indices such as `A03`.

- `ArrowDown` and `ArrowUp` move focus among visible links and wrap at the ends.
- `Enter` follows the focused real link using native link behavior.
- `Escape` clears and refocuses the page search, or dismisses the disclosure and returns focus to its summary.
- IME composition and modified key chords are ignored.
- A zero-result query keeps focus in search and announces `未找到匹配档案 · 18 条真实路由保持不变` locally.
- While the disclosure is open, the covered main surface is inert; pointer navigation closes it without moving focus back to the obsolete summary.
- Route changes reset the disclosure query and result set.

The skip link opens the Atlas disclosure and focuses its search field. Axe covers the index, representative planned dossiers, the Effector workspace, and filtered/no-result disclosure states. Keyboard acceptance covers the skip path, inert boundary, dismissal, focus return, and Effector controls. The 200% and 400% zoom-equivalent checks exercise the filtered Atlas disclosure and then keep the real Effector controls reachable without overflow.

## Rendering boundary

Admin owns 0 WebGL contexts, 0 Canvas renderers, and 0 continuous `requestAnimationFrame` loops. Code under `src/app/admin` and `src/features/control` may not import Pixi, Live2D, or Soul Lens code and may not create a canvas context, application, or shared ticker.

The Control source boundary also rejects gradients, CSS animations, and `backdrop-filter`. Its star field and relay arc are static CSS geometry. Global ambient and grain layers are suppressed on the Control route, and the constitutional no-green scanner applies to the same production source boundary.

The source scan is necessary but not sufficient. The boundary command walks the transitive local graph for relative and `@/` imports across TypeScript, JavaScript, CJS, and CSS; unresolved, computed, or resolved-but-unscannable dependencies fail closed. Renderer ownership is inspected from syntax, including optional access, bracket access, JSX/createElement canvas creation, Application construction, and shared Ticker access. Resolved production Admin client chunks are a second gate for renderer APIs plus Pixi, Live2D, Soul Lens, or 2048-texture bytes.

A report cannot pass with a missing or stale build identity, zero resolved Admin chunks, a registry other than the exact approved 18 IDs, a non-canonical module href, duplicate IDs, anything other than 17 planned modules plus available Effector, or any forbidden renderer/material evidence.

## Screenshot matrix

Control owns exactly 20 approved browser baselines: five surfaces, each in night/day themes at desktop and mobile sizes.

| Surface | Desktop | Mobile | Themes |
| --- | --- | --- | --- |
| Atlas index | 1440 x 1000 | 390 x 844 | night, day |
| Model Router planned dossier | 1440 x 1000 | 390 x 844 | night, day |
| Memory planned dossier | 1440 x 1000 | 390 x 844 | night, day |
| Effector workspace | 1440 x 1000 | 390 x 844 | night, day |
| Filtered Atlas disclosure | 1440 x 1000 | 390 x 844 | night, day |

The same suite checks horizontal overflow at widths 1440, 768, 390, and 320. Disclosure screenshots intentionally capture the viewport, not a stitched full page, so an inert dossier cannot appear below the fixed overlay. Screenshots prove the tested browser rendering only; they do not replace keyboard, screen-reader, zoom, or real-device verification.

## Build and boundary order

The browser runner owns `.next/astr-e2e-build.json`, which binds the Next build ID to the current source hash. Run production-stamped browser discovery before the fail-closed boundary command, and do not edit source, configuration, or package files between them.

```powershell
npm run test:e2e -- --list
npm run test:e2e:no-build -- e2e/control.spec.ts e2e/control-a11y.spec.ts
npm run check:control-boundaries
```

Running `npm run build` alone is not enough evidence because it does not create the ASTR source/build stamp.

## Latest deterministic evidence

Recorded on 2026-07-14 from the commands below:

- unit suite: 96 files, 1473 tests passed;
- coverage: 92.30% statements, 91.99% branches, 93.93% functions, 93.28% lines;
- lint and TypeScript checks: passed with zero errors;
- production build: 29 static pages generated; Playwright discovered 182 tests in 13 files;
- Control browser acceptance: 50/50 passed, including 20 approved screenshots, route-announcer behavior, axe states, 200%/400% zoom-equivalent scrollport visibility, and runtime RAF/WebGL probes;
- Control boundary: 24 transitive source files and 4 resolved Admin chunks checked, exact Effector availability, zero violations;
- Presence and Mobile production boundaries: passed with zero violations;
- dedicated Control boundary suite: 26/26 passed.

## Exact verification commands

From `webapp`:

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

Then, from the repository root:

```powershell
git diff --check
git diff --name-only c8c751e -- src tests integrations pyproject.toml requirements.txt uv.lock
git status --short
```

`npm run test:e2e:real` remains read-only and opt-in through `ASTR_REAL_CORE_URL`. It cannot prove policy mutation or emergency-stop/reset behavior against a real Core. Those mutations require an explicitly authorized operator procedure outside this deterministic browser gate.
