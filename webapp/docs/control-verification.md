# Control verification

`/admin` is a truthful archive over the current Core boundary. The module registry contains 18 target modules, but only Effector is available. Mock-Core evidence is deterministic frontend evidence; it does not certify a deployed Core, real policy files, real audit chains, or real emergency-stop hardware.

## Allowed Core surface

Control may call exactly these six method/path contracts:

1. `GET /v1/admin/effector/policy`
2. `PUT /v1/admin/effector/policy`
3. `GET /v1/admin/effector/audit`
4. `GET /v1/effector/status`
5. `POST /v1/effector/estop`
6. `POST /v1/effector/estop/reset`

The mock returns the same policy, audit, status, and stop-result field names as Core. Policy PUTs are cumulative and return the full effective policy. Stop and reset acknowledgements are not authority: each action must be followed by a status GET, and the readback decides what the UI may claim.

No Task, device, model-router, plugin, memory, training, migration, Studio, or remote-operation route belongs to this workstream.

## Planned modules

The following 17 module IDs remain `planned` until a real web contract exists:

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

Only `effector` may be `available`. Planned dossiers are read-only boundary statements, not placeholder controls or success states.

## Rendering boundary

Admin owns 0 WebGL contexts, 0 Canvas renderers, and 0 continuous `requestAnimationFrame` loops. Code under `src/app/admin` and `src/features/control` may not import Pixi, Live2D, or Soul Lens code and may not create a canvas context, application, or shared ticker. The constitutional no-green scanner applies to the same production source boundary.

The source scan is necessary but not sufficient. The boundary command also resolves the production Admin client chunks and rejects Pixi, Live2D, Soul Lens, or 2048-texture bytes. A report cannot pass with missing or stale build identity, and `status: "checked"` cannot pass with zero resolved Admin chunks.

## Build and boundary order

Run the production build and browser acceptance before the boundary command. The browser runner owns `.next/astr-e2e-build.json`, which binds the Next build ID to the current source hash; run the boundary immediately afterward and before editing source, configuration, or package files.

```powershell
npm run build
npm run test:e2e -- e2e/control.spec.ts e2e/control-a11y.spec.ts
npm run check:control-boundaries
```

Running `npm run build` alone is not enough evidence for the fail-closed boundary because it does not create the ASTR source/build stamp.

## Screenshot matrix

Control browser acceptance records both night and day materials at:

- desktop: 1440 × 1000 CSS pixels;
- mobile: 390 × 844 CSS pixels.

The same suite checks horizontal overflow at widths 1440, 980, 390, and 320. Screenshots prove the tested browser rendering only; they do not replace keyboard, screen-reader, zoom, or real-device verification.

## Exact verification commands

Focused contract and boundary tests:

```powershell
npm test -- --run e2e/support/mock-core.test.ts
npm test -- --run scripts/check-control-boundaries.test.mjs
```

Complete Workstream 2 acceptance is sequential:

```powershell
npm run test:run
npm run test:coverage
npm run lint
npm run typecheck
npm run build
npm run test:e2e -- e2e/control.spec.ts e2e/control-a11y.spec.ts
npm run check:control-boundaries
```

Then, from the repository root:

```powershell
git diff --check
git diff --name-only -- src tests pyproject.toml
git status --short
```

`npm run test:e2e:real` remains read-only and opt-in through `ASTR_REAL_CORE_URL`. It cannot prove policy mutation or emergency-stop/reset behavior against a real Core. Those mutations require an explicitly authorized operator procedure outside this deterministic browser gate.
