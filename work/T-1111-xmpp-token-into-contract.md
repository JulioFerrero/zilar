---
id: T-1111
title: "S15 (part 1): the /xmpp/token endpoint moves into @zilar/api-contract unchanged; web getXmppToken uses callApi"
status: merged
milestone: M5
branch: task/T-1111-xmpp-token-into-contract
model: auto
effort: default
depends_on: [T-1109]
estimate: 0.15 day
---

# T-1111: The XMPP token in the shared contract

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11, S15: "move them unchanged". Only 8 hand-written `request(` calls are left on web (`docs/audit/simplify-status.md` row 3.3). This task moves one of them, the XMPP credential.

**What the lead read:**
- **The server declares the group locally,** in `apps/server/src/xmpp/api.ts`:
  - `TokenResult` (`:38-45`: `jid`, `token`, `expiresAt`, `service`, `domain`, `mucDomain`, all strings);
  - `TokenRateLimit = makeRateLimit('zilar/effect/http/XmppTokenRateLimit', 'Too many token requests')` (`:50-53`);
  - `XmppGroup`, `HttpApiGroup.make('xmpp')` with `post('token', '/xmpp/token', { success: TokenResult }).middleware(TokenRateLimit.Middleware)`, `.middleware(Session)` and `.prefix('/api')` (`:55-63`);
  - `XmppApi` (`:65`).
- **Web** calls it by hand: `apps/web/src/lib/api/chats.ts:100-102`, `request('/xmpp/token', xmppTokenSchema, { method: 'POST' })`, with the same six fields at `:57-64`.
- **The pattern to copy:** `apps/server/src/blocks/api.ts:7`, which imports `BlocksGroup` and its rate-limit tags from `@zilar/api-contract`, builds `HttpApi.make('blocks').add(BlocksGroup)` (`:47`) and provides the limiter with `rateLimitLayer`. The contract tags live in `packages/api-contract/src/middleware.ts`, and the groups are listed in `packages/api-contract/src/api.ts:37`.

### What to build
1. **A new `packages/api-contract/src/xmpp.ts`** exports `XmppTokenResult` (the same six-string struct) and `XmppGroup` (the same name `'xmpp'`, endpoint name `'token'`, path, `Session` middleware and `/api` prefix as today).
2. **`packages/api-contract/src/middleware.ts`** gets `XmppTokenRateLimit`, declared like the other `requires: CurrentUser` rate-limit tags, with the **same key** `'zilar/effect/http/XmppTokenRateLimit'`.
3. **`packages/api-contract/src/api.ts`** adds `XmppGroup` to `ZilarApi`, and `packages/api-contract/src/index.ts` exports the new module (follow how the others are exported).
4. **`apps/server/src/xmpp/api.ts`:**
   - delete the local `TokenResult`, `TokenRateLimit` and `XmppGroup`, and import them from `@zilar/api-contract`;
   - provide the limiter with `rateLimitLayer(XmppTokenRateLimit, limiter, 'Too many token requests')`, the way `blocks/api.ts` does;
   - **the limiter itself is unchanged:** `TOKEN_RATE_LIMIT_MAX`, `TOKEN_RATE_LIMIT_WINDOW_MS`, `now` and the `user.id` key;
   - the handler body is unchanged.
5. **`apps/web/src/lib/api/chats.ts`:** `getXmppToken()` returns `callApi((client) => client.xmpp.token())`, with the same `XmppToken` type for callers. Delete `xmppTokenSchema` if nothing else uses it.
6. **Leave alone:** mobile (`apps/mobile/src/lib/chat-api.ts:436`) and the mock route (`packages/mock-backend/src/domains/xmpp-token/routes.ts`).
7. **Tests** (auth and keys): run `apps/server/src/xmpp/token.test.ts` and paste the result. Do not edit it.
8. **Proof in the Report:** `grep -n "request(" apps/web/src/lib/api/chats.ts` shows no `/xmpp/token`.

### Read first
`AGENTS.md`, `apps/server/src/xmpp/api.ts`, `apps/server/src/blocks/api.ts`, `packages/api-contract/src/middleware.ts`, `packages/api-contract/src/api.ts`, `packages/api-contract/src/index.ts`, and `apps/web/src/lib/api/chats.ts`.

### Allowed files
`packages/api-contract/src/xmpp.ts`, `packages/api-contract/src/middleware.ts`, `packages/api-contract/src/api.ts`, `packages/api-contract/src/index.ts`, `apps/server/src/xmpp/api.ts`, `apps/web/src/lib/api/chats.ts`, `work/T-1111-xmpp-token-into-contract.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/xmpp/token.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- The grep proof is in the Report.

---

## Report (written by the worker when done)

### What I did

Moved the `/xmpp/token` group into the shared contract unchanged, and switched
web's `getXmppToken` from the hand-written `request(` to `callApi`.

- **`packages/api-contract/src/xmpp.ts`** (new): exports `XmppTokenResult` (the
  same six-string struct) and `XmppGroup` (`HttpApiGroup.make('xmpp')`, endpoint
  name `token`, path `/xmpp/token`, `XmppTokenRateLimit` middleware on the
  endpoint, `Session` on the group, `.prefix('/api')`). Same shape as
  `blocks.ts`.
- **`packages/api-contract/src/middleware.ts`**: added `XmppTokenRateLimit`,
  `HttpApiMiddleware.Service<..., { requires: CurrentUser }>` with the same key
  `'zilar/effect/http/XmppTokenRateLimit'` as the deleted server-local tag.
- **`packages/api-contract/src/api.ts`**: imported `XmppGroup` and added it to
  `ZilarApi`.
- **`packages/api-contract/src/index.ts`**: `export * from './xmpp';`.
- **`apps/server/src/xmpp/api.ts`**: deleted the local `TokenResult`,
  `TokenRateLimit` and `XmppGroup`; imports `XmppGroup` / `XmppTokenRateLimit`
  from `@zilar/api-contract`; provides the limiter with
  `rateLimitLayer(XmppTokenRateLimit, limiter, 'Too many token requests')`.
  The limiter (`TOKEN_RATE_LIMIT_MAX`, `TOKEN_RATE_LIMIT_WINDOW_MS`, `now`,
  `user.id`) and the handler body are unchanged. Dropped the now-unused `Schema`
  and `Session` imports and the `makeRateLimit` import.
- **`apps/web/src/lib/api/chats.ts`**: `getXmppToken()` is now
  `callApi((client) => client.xmpp.token())`; `XmppToken` is
  `type XmppToken = XmppTokenResult` (imported from the contract), so callers are
  unchanged. Deleted `xmppTokenSchema` (nothing else used it) and the now-unused
  `request` import.

Left alone: mobile (`apps/mobile/src/lib/chat-api.ts`) and the mock route
(`packages/mock-backend/src/domains/xmpp-token/routes.ts`).

### Files changed

`packages/api-contract/src/xmpp.ts`, `packages/api-contract/src/middleware.ts`,
`packages/api-contract/src/api.ts`, `packages/api-contract/src/index.ts`,
`apps/server/src/xmpp/api.ts`, `apps/web/src/lib/api/chats.ts`,
`work/T-1111-xmpp-token-into-contract.md` (all inside the Allowed files).

### Commands run and results

- `pnpm install`: done, no changes.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/xmpp/token.test.ts`
  (the task's `exec vitest run` check, run with the worker cap AGENTS.md
  requires): `Test Files 1 passed (1)`, `Tests 6 passed (6)`.
- `pnpm gate` from the repo root:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (5.7s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (2.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Proof (grep)

`grep -n "request(" apps/web/src/lib/api/chats.ts` prints nothing (exit 1):
after the change the file has no `request(` call and no `request` import at all,
so no `/xmpp/token` hand-written call remains.

### Problems / deviations

- The task's Checks write the test command as
  `pnpm --filter @zilar/server exec vitest run src/xmpp/token.test.ts --reporter=dot`
  (no worker cap). AGENTS.md forbids `vitest run` without the worker cap, so I ran
  the same single test file through
  `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/xmpp/token.test.ts`.
  Same test, same result.
- The comment on the handler ("already charged by ...") was updated to name
  `XmppTokenRateLimit`; this is inside the allowed server file.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** `packages/api-contract/src/xmpp.ts` holds `XmppTokenResult` (the same six strings) and `XmppGroup`, with the same group, endpoint name, path, `Session` and `/api` prefix. `middleware.ts` gains `XmppTokenRateLimit` with the same key, `zilar/effect/http/XmppTokenRateLimit`.
- **The server** builds the same limiter (max, window, `now`) and provides it with `rateLimitLayer(..., 'Too many token requests')`. The old `makeRateLimit` was exactly that call (`rate-limit-middleware.ts`), so behaviour is identical.
- **Web:** `getXmppToken()` uses `callApi((client) => client.xmpp.token())`, with the same `XmppToken` type.
- **Tests:** the lead ran `src/xmpp/token.test.ts` on the branch: 6 green. The gate passed.
- **S15 status:** 7 hand-written web calls are left. The 4 voice calls are next (they need their middleware tags moved). `/setup` stays, because it decodes a raw body for its own messages, and so does the avatar delete, which shares the binary group.
