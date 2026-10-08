---
id: T-0563
title: "Effect C (HTTP) adapter: carry the socket address into Effect handlers (internal header set by forwardRequest, client copies stripped) and a shared clientIp helper (trusted proxy hops), so invite-links, machines and setup can move later; no route moves here"
status: todo
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

## Review (written by Claude)
