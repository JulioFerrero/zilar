---
id: T-0572
title: "Effect C (HTTP): machines + runner pairing routes onto HttpApi; the per-IP pair limiter reads socketAddressOf; the item-11 Hono wrapper stamps the test's getClientIp(c) into the socket-address header so tests stay unchanged; zod to Effect Schema; same order, texts and timing-safe pair branch"
status: merged
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

### What I did

- Created `apps/server/src/machines/api.ts`: the eight machines/runner-pair
  routes on Effect `HttpApi`, with the same statuses, bodies, logs, audit
  calls, texts and per-route step order as the old Hono router. Effect Schema
  replaces zod (trims, bounds, strict `{ onExcessProperty: 'error' }`); the
  per-IP pair limiter reads `socketAddressOf(request)`.
- Rewrote `apps/server/src/machines/routes.ts` as the item-11 wrapper:
  `createMachinesRoutes(deps): Hono` keeps the old signature, builds the
  Effect API, registers `MACHINES_API_ROUTES` on a `new Hono()` (path minus
  `/api`) and, per request, copies the raw headers, **deletes**
  `SOCKET_ADDRESS_HEADER`, **sets** it to `(deps.getClientIp ?? socketAddress)(c)`
  and forwards a new `Request` to `api.handler`. Removed zod and all route
  bodies. `MachinesRoutesDependencies` (still with
  `getClientIp?: (c: Context) => string`), `MachinesLogger` and the five rate
  limit constants are kept (constants now live in `api.ts` and are re-exported
  from `routes.ts`).
- `apps/server/src/app.ts`: replaced `app.route('/api', createMachinesRoutes(...))`
  at the same position with
  `mountEffectRoutes(app, machinesApi.routes, machinesApi.handler)`, same deps,
  no `getClientIp`.
- `SOCKET_ADDRESS_HEADER` was already exported from `effect/http.ts:25`; no
  change was needed there.

### Files changed

- `apps/server/src/machines/api.ts` (new)
- `apps/server/src/machines/routes.ts` (rewritten)
- `apps/server/src/app.ts` (mount + import)
- `work/T-0572-effect-http-machines.md` (this Report + status)

### Commands and real results

- `pnpm install` — done, 20.3s (only pre-existing mobile peer warnings).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot machines` —
  **5 files passed, 62 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot authz-sweep app.test` —
  **2 files passed, 14 tests passed**.
- `pnpm gate` (first run) — GATE FAIL, `format` (Prettier) flagged
  `apps/server/src/machines/api.ts`; scope was already clean.
- `pnpm exec prettier --write apps/server/src/machines/api.ts routes.ts app.ts` —
  only `api.ts` changed.
- `pnpm gate` (second run) — **GATE PASS**:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (3.6s)
  PASS  format  (50.2s)
  PASS  lint  (2.0s)
  PASS  typecheck  (23.3s)
  PASS  tests @zilar/server  (654.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

The listed tests are unchanged. All machines tests (`routes.test.ts`,
`hub.test.ts`, service/registry/codes tests) plus the authz sweep and
`app.test` pass byte-for-byte as before.

### Item 8 — `PublicMachine` field by field

`toPublicMachine` (`service.ts:88`) has 16 fields; `PublicMachineView` lists all
16 in the same order:

| service field | schema | old JSON | new JSON |
|---|---|---|---|
| id | `Schema.String` | string | same |
| name | `Schema.String` | string | same |
| status | `Schema.Literals([...])` | string | same |
| os | `Schema.String` | string | same |
| osVersion | `Schema.String` | string | same |
| arch | `Schema.String` | string | same |
| cpu | `Schema.String` | string | same |
| cores | `Schema.Number` | number | same |
| ramGb | `Schema.Number` | number | same |
| diskFreeGb | `Schema.Number` | number | same |
| drivers | `Schema.Array(Schema.String)` | string[] | same |
| fingerprint | `Schema.String` | string | same |
| online | `Schema.Boolean` | bool | same |
| createdAt | `Schema.Date` | ISO string | same |
| approvedAt | `Schema.NullOr(Schema.Date)` | ISO/string-or-null | same |
| lastSeenAt | `Schema.NullOr(Schema.Date)` | ISO/string-or-null | same |

Dates are `Date` in the service and encode to the same ISO strings
`JSON.stringify` produced on the old `c.json()`. `approve`/`revoke`/`rename`
call `toPublicMachine(row)` without `isMachineOnline`, so `online` stays
`false`; `GET /machines` passes `isMachineOnline`.

### Item 10 — message texts

Every test-asserted text is byte-identical:

- 400 `invalid_request` "Invalid JSON body" (PATCH malformed JSON)
- 400 `invalid_request` "Invalid machine update" (PATCH bad shape)
- 400 `invalid_code` "Invalid or expired pairing code"
- 404 `not_found` "Machine not found"
- 409 `invalid_transition` "Only pending machines can be approved" / "... denied" / "Machine is already revoked" / "Machine can no longer be deleted"
- 409 `revoke_first` "Revoke the machine before deleting it"
- 429 `rate_limited` "Too many pairing codes, try again later" / "Too many pairing attempts, try again in a minute"
- 204 bodies (deny, delete), 201 `{ code, expiresAt }`, 201 `{ machineId, status: 'pending' }`

No generic Schema text is reachable: there are no framework-decoded bodies
(bodies are decoded in the handler to keep order/text) and the `:id` params are
plain strings, so no schema-error middleware is needed.

### Timing-safe pair branch

The `Promise.all([consumePairingCode, verifyPairingSignature])` shape is kept
verbatim inside a single `Effect.promise`, and the route branches once
afterwards with the same disjunction, so the timing does not reveal which check
failed. Malformed JSON is read via `catchCause` → `undefined` and decodes to
`invalid_code`, never `invalid_request`, matching `readPairJson`.

### Security checklist

- No secret reaches logs/audit/errors: logs carry `machineId` only, audit
  entries carry ids only (action + subjectId), pair failures never echo the
  code/public key/signature.
- Pair lookup/delete/update SQL is unchanged and scoped by `ownerUserId`.
- The per-IP limiter trusts only the socket address; the wrapper strips any
  client-forged `x-zilar-socket-address` before setting it.
- Unknown machine and another user's machine both answer 404.
- Every owner route is covered by the 401 sweep; pair has the global + per-IP
  cap.

### Deviations / notes

- `MachinesLogger` is now a type alias of pino `Logger` (`export type
  MachinesLogger = Logger`) instead of the previous `{ info }` interface: the
  Effect error envelope needs `logger.error` for the 500 branch. Every caller
  already passes a full pino logger (checked by grep: the name is used only in
  `routes.ts`), so no call site changed. The export is kept as the spec asks.
- The rate limit constants moved to `api.ts` and are re-exported from
  `routes.ts` so the existing test imports (`PAIRING_CODE_RATE_LIMIT_WINDOW_MS`,
  `PAIR_RATE_LIMIT_WINDOW_MS`) keep working.

### Open questions

None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** 0 must-fix. The packet (08:22) is newer than HEAD 928532ef.
- **No test file changed.**
- **Lead check:**
  - the item-11 wrapper deletes any client copy of `SOCKET_ADDRESS_HEADER`, then stamps the test `getClientIp(c)` or the `getConnInfo` socket;
  - production reads `socketAddressOf` behind `forwardRequest`, with no proxy trust, as before;
  - the pair branch keeps the `Promise.all` shape;
  - `PublicMachineView` lists the 16 `PublicMachine` fields with the same types.
- **Accepted nit:** `MachinesLogger` is now the pino `Logger`, which matches the other api modules.
