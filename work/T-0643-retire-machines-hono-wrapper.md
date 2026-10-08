---
id: T-0643
title: "Hono: retire the machines item-11 wrapper (machines/routes.ts); move its deps type into api.ts; routes.test.ts and hub.test.ts call createMachinesApi(...).handler and stamp the socket header themselves; delete the wrapper; same assertions"
status: merged
milestone: M5
branch: task/T-0643-retire-machines-hono-wrapper
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0643: retire the machines Hono wrapper

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0. This is A5 in the T-0626 last-mile audit. T-0637 to T-0642 do the same for other modules.

### Verified facts (do not re-derive)
- **`apps/server/src/machines/routes.ts`** (77 lines) imports `Hono`, `Context` and `getConnInfo`.
  - It re-exports the five `PAIR*` rate-limit constants from `./api`.
  - It defines `MachinesRoutesDependencies` (`auth`, `db`, `logger: MachinesLogger`, `audit?`, `registry?`, `now?`, `getClientIp?: (c: Context) => string`, `isMachineOnline?`) and `MachinesLogger = Logger`.
  - `createMachinesRoutes(deps)` mounts each `MACHINES_API_ROUTES` path with `/api` stripped. For each request it copies the headers, deletes `SOCKET_ADDRESS_HEADER` (`apps/server/src/effect/http.ts:25`), sets it to `getClientIp(c)` (or the socket address, which is `'unknown'` in tests), and calls `api.handler(new Request(raw, { headers }))`.
- **The importers** (`git grep`):
  - `apps/server/src/machines/api.ts:46`: `import type { MachinesRoutesDependencies } from './routes';`, used at `api.ts:227`. `api.ts` never reads `deps.getClientIp`.
  - `apps/server/src/machines/routes.test.ts:15-19`: `createMachinesRoutes` and two constants. The `mountMachines(overrides)` harness (about lines 94-119) builds `new Hono()` with an `onError` and is called 8 times. Every `getClientIp` the tests pass ignores its argument, for example `() => '10.7.7.7'`.
  - `apps/server/src/machines/hub.test.ts:27`: one Hono mount at about lines 675-690, passing `isMachineOnline`.
  - `apps/server/src/app.ts` imports only `createMachinesApi` from `./machines/api`. **Do not touch `app.ts`.**
- **`createMachinesApi(deps)`** returns an `EffectApiMount` whose `handler` takes a `Request` with the full `/api/...` URL. The per-IP limiter reads `socketAddressOf` (`effect/http.ts:88-89`), which reads that header.

### What to build
1. **In `apps/server/src/machines/api.ts`:**
   - move `MachinesLogger` and the deps interface here as `export interface MachinesApiDependencies`, without `getClientIp`;
   - type `createMachinesApi` with it;
   - drop the import from `./routes`;
   - update the header comment at lines 10-12 so it says the tests stamp the socket header themselves.
2. **In `routes.test.ts`:**
   - `mountMachines` returns `{ request(url, init) }`. For each request it copies `init.headers`, sets `SOCKET_ADDRESS_HEADER` to `overrides.getClientIp?.() ?? 'unknown'`, and calls `api.handler(new Request(url, { ...init, headers }))`.
   - `getClientIp` becomes `() => string`.
   - Import the constants and `createMachinesApi` from `./api`. Remove the imports that are now unused (`Hono`, `Context`, `HttpError`).
3. **In `hub.test.ts`:** replace the Hono mount with a direct `createMachinesApi({ ...same deps }).handler(new Request(url, init))` call. Remove the imports that are now unused.
4. **Every assertion stays.** If one fails only because of error rendering, stop and report it in Blocked.
5. **Delete** `apps/server/src/machines/routes.ts`. Then `git grep -n "machines/routes'" apps` and `git grep -n "from './routes'" apps/server/src/machines` must show nothing. Leave doc comments outside the Allowed files alone, and list them under Follow-ups.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` item 11, `apps/server/src/machines/routes.ts`, `apps/server/src/machines/api.ts` (lines 1-60 and 195-240), `apps/server/src/machines/routes.test.ts` (lines 1-130), `apps/server/src/machines/hub.test.ts` (lines 1-40 and 660-700), `apps/server/src/effect/http.ts` (lines 20-30 and 85-92).

### Allowed files
`apps/server/src/machines/routes.ts`, `apps/server/src/machines/api.ts`, `apps/server/src/machines/routes.test.ts`, `apps/server/src/machines/hub.test.ts`, `work/T-0643-retire-machines-hono-wrapper.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/machines/routes src/machines/hub
pnpm gate
```

### Acceptance
- `machines/routes.ts` is gone, and both test files pass with the same assertions, including the per-IP limit tests.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Moved `MachinesLogger` and the deps interface into `apps/server/src/machines/api.ts` as `export interface MachinesApiDependencies` (without `getClientIp`); typed `createMachinesApi` with it; dropped the `./routes` import. Added the type imports it now needs (`Logger`, `AuditRecorder`, `Auth`, `ServerDatabase`, and `DbMachineRegistry` from `./registry`).
- Updated the header comment in `api.ts` (lines 10-12) to say the tests stamp the socket header themselves.
- `routes.test.ts`: `mountMachines` now builds `createMachinesApi(...)` and returns `{ request(url, init) }`. Each request copies `init.headers`, sets `SOCKET_ADDRESS_HEADER` to `getClientIp?.() ?? 'unknown'` and calls `api.handler(new Request(url, { ...init, headers }))`. `getClientIp` is now `() => string`. Removed the now-unused `Hono`, `Context` and `HttpError` imports.
- `hub.test.ts`: replaced the Hono mount with a direct `createMachinesApi({ ...same deps }).handler(new Request(url, init))`; removed the now-unused `Hono` and `HttpError` imports.
- Deleted `apps/server/src/machines/routes.ts`.
- Every assertion stayed; none needed changing, including the per-IP and global limit tests.

### Files changed
- `apps/server/src/machines/api.ts`
- `apps/server/src/machines/routes.test.ts`
- `apps/server/src/machines/hub.test.ts`
- `apps/server/src/machines/routes.ts` (deleted)
- `work/T-0643-retire-machines-hono-wrapper.md` (status + this Report)

### Commands
- `pnpm install` — completed (no errors).
- `git grep -n "machines/routes'" apps` and `git grep -n "from './routes'" apps/server/src/machines` — no matches after the deletion.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/machines/routes src/machines/hub` — 3 test files passed, 48 tests passed (22.56s).
- `pnpm gate` — GATE PASS. Summary lines:
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)  (1.3s)`
  - `PASS  format  (21.1s)`
  - `PASS  lint  (1.1s)`
  - `PASS  typecheck  (15.7s)`
  - `PASS  tests @zilar/server  (21.0s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Deviations
- In `mountMachines` I destructure `getClientIp` out of `overrides` before spreading the rest into `createMachinesApi`, so the test-only seam is not passed to the API (which no longer accepts it). Behaviour matches the spec: the socket header is stamped per request.

### Follow-ups (references outside the Allowed files, deliberately untouched)
- `docs/EFFECT_GUIDE.md:212` (item 13) still names `machines/routes.ts` as an item-11 wrapper.
- `docs/audit/effect-last-mile.md` lines 78, 114 and 349 still reference the file.
- Older task files (`work/T-0068`, `T-0070`, `T-0071`, `T-0072`, `T-0075`, `T-0079`, `T-0083`) mention it historically.
- `api.ts` header comment lines 3-4 already call the Hono router "deleted"; that is now literally true.

No open questions.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean. The packet head is 49e4b21f, the current HEAD.
- **Lead check:**
  - the wrapper is deleted;
  - the deps type is in `api.ts`;
  - the tests stamp `SOCKET_ADDRESS_HEADER` themselves;
  - no `expect` line changed.
- **Follow-ups:** the doc references in `docs/EFFECT_GUIDE.md:212` and `docs/audit/effect-last-mile.md`.
