---
id: T-0643
title: "Hono: retire the machines item-11 wrapper (machines/routes.ts); move its deps type into api.ts; routes.test.ts and hub.test.ts call createMachinesApi(...).handler and stamp the socket header themselves; delete the wrapper; same assertions"
status: todo
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

## Review (written by Claude)
