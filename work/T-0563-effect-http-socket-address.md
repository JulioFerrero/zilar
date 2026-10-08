---
id: T-0563
title: "Effect C (HTTP) adapter: carry the socket address into Effect handlers (internal header set by forwardRequest, client copies stripped) and a shared clientIp helper (trusted proxy hops), so invite-links, machines and setup can move later; no route moves here"
status: merged
milestone: M5
branch: task/T-0563-effect-http-socket-address
model: auto
effort: low
depends_on: [T-0556]
estimate: 0.5 day
---

# T-0563: socket address for Effect HTTP handlers

## Spec (written by Claude, do not edit)

### Why
Three Hono modules cannot move to Effect HTTP yet, because the adapter loses the socket address their IP rate limiters need:
- `invite-links/routes.ts` (the join limiter);
- `machines/routes.ts` (the pairing limiters);
- `setup/routes.ts`.

This task adds the missing piece only. **No route module moves here.**

### Verified facts (do not re-derive)
- **`apps/server/src/effect/http.ts`:**
  - `REQUEST_ID_HEADER = 'x-request-id'` (line 23);
  - `forwardRequest(context)` (152) copies the raw headers, sets the request id and returns `new Request(context.req.raw, { headers })`;
  - `mountEffectApi` (166) and `mountEffectRoutes` (182) both use `forwardRequest`.
- **How Hono modules get the IP today:**
  - `socketAddress(c)` reads `getConnInfo(c).remote.address` from `@hono/node-server/conninfo`, giving `'unknown'` when it is empty or throws (`apps/server/src/invite-links/routes.ts:240-247`; a copy is at `apps/server/src/machines/routes.ts:357`);
  - `clientIpFor(trustedProxyHops)` (`invite-links/routes.ts:208`) uses `trustedClientIp(x-forwarded-for, hops)` (222), which takes the Nth address from the right, when hops > 0, and otherwise falls back to the socket address;
  - `setup/routes.ts:37` imports `clientIpFor` from `../invite-links/routes`;
  - `apps/server/src/invite-links/invite-links.test.ts:26` imports `trustedClientIp` from `./routes`.

### What to build
1. **In `forwardRequest`:**
   - **always delete** any incoming `x-zilar-socket-address` header, so a client can never forge it;
   - then set it to the socket address, using the same `getConnInfo` read and the same `'unknown'` fallback;
   - export the header name as `SOCKET_ADDRESS_HEADER`.
2. **Create `apps/server/src/http/client-ip.ts`** with pure functions on plain inputs, not on a Hono `Context`:
   - `trustedClientIp(header, hops)`, moved here verbatim;
   - `clientIpFrom({ forwardedFor, socketAddress }, trustedProxyHops)`, with the same rule as `clientIpFor`.
   
   In `invite-links/routes.ts`, keep `trustedClientIp` and `clientIpFor` exported, now as thin wrappers over these, so `setup/routes.ts` and the test keep working unchanged.
3. **In `apps/server/src/effect/http.ts`,** add `socketAddressOf(request: HttpServerRequest)`, which reads `SOCKET_ADDRESS_HEADER` and falls back to `'unknown'`.
4. **Tests:**
   - `apps/server/src/http/client-ip.test.ts`: the same cases as the existing `trustedClientIp` test, plus `clientIpFrom` with hops 0 and 1 and a missing header;
   - **one** new test in `apps/server/src/effect/http.test.ts`: a request sent through `mountEffectRoutes` with a forged `x-zilar-socket-address` header reaches the Effect handler with the real socket address (or `'unknown'` under the test transport), never the forged value.
   
   Every existing test stays unchanged.

### Read first
`AGENTS.md`, `apps/server/src/effect/http.ts`, `apps/server/src/effect/http.test.ts`, `apps/server/src/invite-links/routes.ts` (lines 100-115 and 200-249), `apps/server/src/setup/routes.ts` (lines 30-40 and 105-130).

### Allowed files
`apps/server/src/effect/http.ts`, `apps/server/src/effect/http.test.ts`, `apps/server/src/http/client-ip.ts`, `apps/server/src/http/client-ip.test.ts`, `apps/server/src/invite-links/routes.ts`, `work/T-0563-effect-http-socket-address.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot effect/http client-ip invite-links setup machines authz-sweep
pnpm gate
```

### Acceptance
- Effect handlers can read the real socket address, a forged header never gets through, and the client-IP rule is shared.
- Every existing test is unchanged and green, and the new tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/effect/http.ts`: exported `SOCKET_ADDRESS_HEADER = 'x-zilar-socket-address'`; `forwardRequest` deletes any incoming value then sets it from `getConnInfo` with the same `'unknown'` fallback; added `socketAddressOf(request)` reading the header with `'unknown'` fallback.
- `apps/server/src/http/client-ip.ts` (new): pure `trustedClientIp(header, hops)` moved verbatim and `clientIpFrom({ forwardedFor, socketAddress }, hops)` with the same rule as `clientIpFor`.
- `apps/server/src/invite-links/routes.ts`: `trustedClientIp` and `clientIpFor` kept exported as thin wrappers over the shared module, so `setup/routes.ts` and the existing test work unchanged.
- Tests: `apps/server/src/http/client-ip.test.ts` (same `trustedClientIp` cases plus `clientIpFrom` with hops 0/1 and missing header); one new forged-header test in `apps/server/src/effect/http.test.ts` via `mountEffectRoutes`.

### Files changed
- `apps/server/src/effect/http.ts`, `apps/server/src/effect/http.test.ts`, `apps/server/src/http/client-ip.ts`, `apps/server/src/http/client-ip.test.ts`, `apps/server/src/invite-links/routes.ts`, `work/T-0563-effect-http-socket-address.md`.

### Commands and results
- `pnpm install`: pass (34.2s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/http/client-ip.test.ts`: 4 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/http.test.ts`: 10 passed (9 existing + 1 new).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot effect/http client-ip invite-links setup machines authz-sweep`: 11 files, 125 tests, all passed.
- `pnpm gate` (first run): GATE FAIL on format only (2 test files needed prettier); fixed with `prettier --write` on those two files.
- `pnpm gate` (final): PASS install, PASS format, PASS lint, PASS typecheck, PASS tests @zilar/server; `scope: every changed file is inside the Allowed files`; GATE PASS.

### Problems / deviations
- None from the spec. No route modules moved. No existing tests changed.

### Security checklist
- Forged `x-zilar-socket-address` is deleted before stamping; verified by the new test (handler never sees `203.0.113.99`).
- `trustedClientIp`/`clientIpFrom` move is verbatim logic; default hops 0 ignores proxy headers.
- No secrets logged; no new routes (authz sweep green); no deletes/updates touched.

## Review (written by Claude)

Approved (lead, 2026-10-08). forwardRequest deletes any client copy of x-zilar-socket-address, then sets it from getConnInfo (same unknown fallback), and Effect handlers read it with socketAddressOf. The client-IP rule (Nth address from the right of x-forwarded-for when hops > 0, otherwise the socket address) moved verbatim to http/client-ip.ts; invite-links keeps trustedClientIp and clientIpFor as thin wrappers, so setup and the tests are unchanged. A new adapter test proves a forged header never reaches a handler. This unblocks moving invite-links, machines and setup. Pre-review clean.
