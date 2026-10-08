---
id: T-0572
title: "Effect C (HTTP): machines + runner pairing routes onto HttpApi; the per-IP pair limiter reads socketAddressOf; the item-11 Hono wrapper stamps the test's getClientIp(c) into the socket-address header so tests stay unchanged; zod to Effect Schema; same order, texts and timing-safe pair branch"
status: todo
milestone: M5
branch: task/T-0572-effect-http-machines
model: auto
effort: low
depends_on: [T-0566]
estimate: 1 day
---

# T-0572: machines and runner pairing on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP", items 1-11. The worked examples are `apps/server/src/push/api.ts` (with the item-11 wrapper) and `apps/server/src/invite-links/api.ts` (T-0566, the client IP).

**The design decision, from the lead, for the per-IP limiter:**
- **Production:** the Effect handler reads the IP with `socketAddressOf(request)` (`apps/server/src/effect/http.ts:88`). `forwardRequest` (around line 162) strips any client copy of `x-zilar-socket-address` and sets it from `getConnInfo`. This is the same value the old `socketAddress(c)` read (`apps/server/src/machines/routes.ts:356`). **Do not use `clientIpFrom` or proxy headers here:** this module trusts the socket only, and that stays.
- **Tests:** they mount `createMachinesRoutes` directly and pass `getClientIp?: (c: Context) => string` (`apps/server/src/machines/routes.test.ts:97`, `622`, `659`, `884`, `915`). So the item-11 wrapper `createMachinesRoutes(deps): Hono` keeps that exact dependency type. For each request it:
  1. copies the raw headers;
  2. **deletes** `SOCKET_ADDRESS_HEADER`;
  3. sets it to `(deps.getClientIp ?? socketAddress)(c)`;
  4. forwards a new `Request` to the api handler.
  
  Export `SOCKET_ADDRESS_HEADER` from `effect/http.ts` if it is not exported yet. It is at line 25.

### Verified facts (do not re-derive; read each route for its exact statuses and texts)
- **`apps/server/src/machines/routes.ts`** (393 lines):
  - `MachinesRoutesDependencies` (around line 36) holds `auth`, `db`, `logger`, `audit?`, `registry?`, `now?`, `getClientIp?` and `isMachineOnline?`;
  - the zod schemas, with **`.trim()` transforms** on strings and **strict objects**: `machineNameSchema` (58), `toolsValueSchema` (60), `capabilitiesSchema` (69), `pairSchema` (88) and `renameSchema` (96). `tools` has a refine of at most 64 keys;
  - three limiters (114-128).
- **The eight routes (130-348):**
  1. `POST /machines/pairing-codes`: session, then the limiter (429 "Too many pairing codes, try again later"), then **201** `{ code, expiresAt: ISO string }`. A `MachineServiceError` becomes 409 through `toConflict`.
  2. `GET /machines`: `toPublicMachine(row, isMachineOnline)` for each row.
  3. `POST /machines/:id/approve`, `POST /machines/:id/deny` and `POST /machines/:id/revoke`:
     - session, then the owned lookup (404 "Machine not found"), then the state check (409 `invalid_transition`, with the texts per route), then the update (a null result is the same 409);
     - approve and revoke call the registry notify;
     - each logs and writes an audit entry;
     - approve and revoke answer `toPublicMachine(row)` **without** `isMachineOnline`, so `online` is `false`; deny answers **204**.
  4. `PATCH /machines/:id`: session, then the **body decode** (a bad JSON body is 400 `invalid_request` "Invalid JSON body"; a bad shape is 400 `invalid_request` "Invalid machine update"), then the owned lookup (404), then the rename (null is 404).
  5. `DELETE /machines/:id`: session, then the owned lookup (404), then `approved` is 409 `revoke_first`, then the delete (null is 409 `invalid_transition` "Machine can no longer be deleted"), then the log and audit, then **204**.
  6. `POST /runner/pair` (public, no session):
     - the global limiter, then the per-IP limiter (both 429 "Too many pairing attempts, try again in a minute");
     - then the body. **Malformed JSON counts as a failed parse and gives `invalid_code`, never `invalid_request`** (`readPairJson`, line 386);
     - the code consume and the signature check run **together** (`Promise.all`, 309-318), and any failure gives the one 400 `invalid_code` "Invalid or expired pairing code". **Keep the `Promise.all` shape so the timing stays the same**;
     - then the insert, the log and the audit, then **201** `{ machineId, status: 'pending' }`.
- **`toPublicMachine`** (`apps/server/src/machines/service.ts:88`) returns `PublicMachine`, with **16 fields** including dates and nullable values. List each one in the success schema and compare field by field (item 8).
- **Mounts:**
  - `apps/server/src/app.ts:353-363` mounts `createMachinesRoutes` through `app.route('/api', …)`. Change it to `mountEffectRoutes(app, machinesApi.routes, machinesApi.handler)` at the same position, with the same deps, and without `getClientIp`;
  - `apps/server/src/machines/hub.test.ts:684` and `routes.test.ts:111` mount the wrapper.
- **Tests (all unchanged):** `apps/server/src/machines/*.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/machines/api.ts`** with the eight routes on `HttpApi`:
   - the same statuses, bodies, logs, audit calls, texts and step order;
   - Effect Schema with the same trims, bounds and strictness (`onExcessProperty: 'error'`);
   - the IP from `socketAddressOf(request)`.
   
   Export `createMachinesApi(deps)` and `MACHINES_API_ROUTES`.
2. **`routes.ts`** becomes the item-11 wrapper described above. Keep `MachinesRoutesDependencies` (with `getClientIp?: (c: Context) => string`), `MachinesLogger` and every other export a test or `app.ts` imports (check with grep). Remove the zod.
3. **`app.ts`:** mount it as described above.
4. **Tests:** every listed test passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/push/api.ts`, `apps/server/src/invite-links/api.ts`, `apps/server/src/machines/routes.ts` (all of it), `apps/server/src/machines/service.ts` (lines 60-112), `apps/server/src/machines/routes.test.ts` (lines 80-130 and 600-680), and `apps/server/src/app.ts` (lines 345-365).

### Allowed files
`apps/server/src/machines/api.ts`, `apps/server/src/machines/routes.ts`, `apps/server/src/effect/http.ts` (only to export `SOCKET_ADDRESS_HEADER`, if needed), `apps/server/src/app.ts`, `work/T-0572-effect-http-machines.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot machines authz-sweep app.test
pnpm gate
```

### Acceptance
- Machines and runner pairing are served by Effect `HttpApi`, with the same answers, order and timing-safe pair branch, the per-IP limiter on the socket address, and no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
