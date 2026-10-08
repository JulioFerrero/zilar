---
id: T-0514
title: "Effect C (HTTP): blocks, contacts and directory routes onto the HttpApi adapter (T-0498 recipe); every route test unchanged"
status: merged
milestone: M5
branch: task/T-0514-effect-http-blocks-contacts-directory
model: auto
effort: low
depends_on: [T-0498]
estimate: 0.5 day
---

# T-0514: blocks, contacts and directory on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono. T-0498 (merged) built the strangler adapter and moved `handles`. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP".**

This task moves the next three small route modules. Their DB code stays as it is (T-0510 moves `blocks/service.ts` to effect/sql in parallel; do not touch any `service.ts`).

### Verified facts (do not re-derive)
- **`apps/server/src/handles/api.ts`** (T-0498) is the worked example: `HANDLES_API_ROUTES` (line 174) and `createHandlesApi(deps): EffectApiMount` (line 179). `apps/server/src/effect/http.ts` holds `Session`, `CurrentUser`, `sessionLayer`, `withErrorEnvelope`, `httpErrorResponse`, `failureResponse`, `mountEffectRoutes` and `EffectApiRoute`/`EffectApiMount`.
- **`apps/server/src/blocks/routes.ts`** (86 lines):
  - two limiters: `writeLimiter` and `readLimiter` (injectable, with their constants);
  - `PUT /blocks/:userId` gives `blockUser(...)`, `DELETE /blocks/:userId` gives `unblockUser(...)`, `GET /blocks` gives `listBlockedUsers(...)`;
  - each route checks the session, then the limiter (`HttpError(429, 'rate_limited', 'Too many attempts, try again later')`), then the service;
  - the service deps include `audit` when given.
  
  `app.ts:332` is `app.route('/api', createBlocksRoutes({ auth, db, audit: auditRecorder }))`.
- **`apps/server/src/contacts/routes.ts`** (24 lines): `GET /contacts` gives `listContacts(db, user.id, config.xmpp.domain)`. `app.ts:321`.
- **`apps/server/src/directory/routes.ts`** (105 lines):
  - a zod `directoryQuerySchema` (`q` max 100, `kind` group|channel, `cursor` max 200, all optional) and one limiter;
  - **`GET /directory`:** a bad query gives `HttpError(400, 'invalid_request', <zod issues[0].message ?? 'Invalid request'>)`, then `searchDirectory` gives `{ entries: page.entries.map(toEntry), next }`;
  - **`GET /groups/by-handle/:handle`** gives `toEntry(await publicGroupForHandle(...))`.
  
  `app.ts:336`.
- **The tests** (all must pass unchanged): `apps/server/src/blocks/blocks.test.ts`, `apps/server/src/contacts/contacts.test.ts`, `apps/server/src/groups/visibility.test.ts` (it covers the directory and by-handle routes), `apps/server/src/contact-requests/contact-requests.test.ts`, `apps/server/src/files/routes.test.ts`, `apps/server/src/avatars/routes.test.ts`, `apps/server/src/media/routes.test.ts`, plus the authz sweep test (`authz-sweep`) and `app.test`.

### What to build
1. **One `api.ts` per module** (`blocks/api.ts`, `contacts/api.ts`, `directory/api.ts`) following the recipe, with:
   - the same paths, methods, status codes and bodies;
   - the same limiter order (session, then limiter, then decode, then the service);
   - injectable limiters and `now` where the routes had them;
   - **exact-route mounts.**
2. **Directory query errors:** if any test asserts the **text** of the 400 message, keep it byte-identical. The handles pilot ran the old zod schema only to build the message; do the same, or match the text by hand. If no test asserts it, use the Effect Schema issue message, and list the old and new texts in the Report.
3. **`app.ts`:** replace the three `app.route(...)` lines with `mountEffectRoutes(...)`, as `handles` does. Nothing else changes. Delete each old `routes.ts`; if a test imports something from one, keep that export in the new `api.ts` and say so.
4. **Tests:** every test listed above passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/handles/api.ts`, and the three `routes.ts` files.

### Allowed files
`apps/server/src/blocks/api.ts`, `apps/server/src/blocks/routes.ts`, `apps/server/src/contacts/api.ts`, `apps/server/src/contacts/routes.ts`, `apps/server/src/directory/api.ts`, `apps/server/src/directory/routes.ts`, `apps/server/src/app.ts`, `work/T-0514-effect-http-blocks-contacts-directory.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot blocks contacts groups/visibility contact-requests authz-sweep app.test
pnpm gate
```

### Acceptance
- The three modules are served by Effect `HttpApi` through the adapter, with the same answers.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Moved `blocks`, `contacts` and `directory` onto the Effect `HttpApi` adapter
with one `api.ts` per module, following the T-0498 recipe in
`docs/EFFECT_GUIDE.md` and the `handles/api.ts` worked example, then mounted
each with `mountEffectRoutes(app, routes, handler)` using exact routes.

- `apps/server/src/blocks/api.ts` (new): `createBlocksApi` builds the
  `HttpApi` group (`PUT`/`DELETE` `/blocks/:userId`, `GET` `/blocks`) with
  `Session`, then the endpoint-level write/read limiter middleware, then the
  service. Bodies, status codes and the 429 envelope are identical to the old
  Hono router. Injectable `writeLimiter`, `readLimiter` and `now` are kept.
- `apps/server/src/contacts/api.ts` (new): `createContactsApi` for
  `GET /contacts`; `Session` then `listContacts(db, user.id, config.xmpp.domain)`.
- `apps/server/src/directory/api.ts` (new): `createDirectoryApi` for
  `GET /directory` and `GET /groups/by-handle/:handle`, with an Effect Schema
  query replacing the zod schema, a group schema-error transform that renders a
  query decode failure as `400 invalid_request`, and the injectable `limiter`/`now`.
- `apps/server/src/app.ts`: the three `app.route('/api', …)` lines became
  `create*Api` + `mountEffectRoutes`. Nothing else changed.
- `apps/server/src/contacts/routes.ts`, `apps/server/src/directory/routes.ts`:
  deleted (nothing imports them but `app.ts`).
- `apps/server/src/blocks/routes.ts`: reduced to a compatibility re-export (see
  the deviation below).

Ordering is preserved: `Session` (group) → rate limiter (endpoint middleware,
so it charges before the query decode) → schema decode → service. The router
logger stays off (`disableLogger: true`) and failures go through
`withErrorEnvelope` / `failureResponse`, so the Hono request log and redaction
are unchanged.

### Deviation from the spec (blocks test import path)

`blocks.test.ts` imports `BLOCK_WRITE_RATE_LIMIT_MAX` and `createBlocksRoutes`
from `./routes` and mounts `createBlocksRoutes(...)` on its own Hono wrapper as
a **Hono app** to exercise an injected limiter. Deleting `routes.ts` outright
would break that unchanged test. Per the spec's fallback ("if a test imports
something from one, keep that export in the new `api.ts` and say so") I moved
the legacy Hono factory and the constants into `blocks/api.ts` (clearly marked
as the legacy test seam) and left `blocks/routes.ts` as a 12-line re-export so
the `./routes` import still resolves. Production uses `createBlocksApi`; the
`createBlocksRoutes` Hono body is not reachable from `app.ts`.

Consequence: the two blocks limiter tests ("refuses reads after the injected
read limiter is exhausted" / "refuses writes after the injected limiter is
exhausted") still exercise the legacy Hono factory, not the Effect path. All
other blocks tests go through `app` and therefore through the Effect mount.

### Directory 400 message texts (no test asserts them)

For a query decode failure the old route threw
`HttpError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Invalid request')`.
No listed test asserts the text (the `?q=h` 400 comes from `searchDirectory`,
not the schema), so the new code uses the Effect Schema issue message. Old
(zod) vs new (Effect Schema):

- `kind=bogus`: old `Invalid option: expected one of "group"|"channel"` →
  new `Expected "group" | "channel"\n  at ["kind"]`.
- `q` longer than 100: old `Too big: expected string to have <=100 characters`
  → new `Expected a value with a length of at most 100\n  at ["q"]`.
- `cursor` longer than 200: old `Too big: expected string to have <=200 characters`
  → new `Expected a value with a length of at most 200\n  at ["cursor"]`.

### Files changed (all inside the Allowed files)

- `apps/server/src/blocks/api.ts` (new)
- `apps/server/src/blocks/routes.ts` (reduced to a re-export)
- `apps/server/src/contacts/api.ts` (new)
- `apps/server/src/contacts/routes.ts` (deleted)
- `apps/server/src/directory/api.ts` (new)
- `apps/server/src/directory/routes.ts` (deleted)
- `apps/server/src/app.ts`
- `work/T-0514-effect-http-blocks-contacts-directory.md`

### Commands and real results

- `pnpm install` → done in 18.4s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot blocks contacts groups/visibility`
  → 3 files passed, 44 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot contact-requests authz-sweep app.test files/routes avatars/routes media/routes`
  → 6 files passed, 71 tests passed (the authz sweep lists the new
  `/api/blocks/:userId`, `/api/blocks`, `/api/contacts`, `/api/directory` and
  `/api/groups/by-handle/:handle` routes and all answer 401 unauthenticated).
- `pnpm gate` (first run) → `FAIL format`, only `apps/server/src/blocks/api.ts`;
  ran `pnpm exec prettier --write apps/server/src/blocks/api.ts`.
- `pnpm gate` (second run) → GATE PASS:

```
PASS  install (frozen)  (1.5s)
PASS  format  (23.4s)
PASS  lint  (1.0s)
PASS  typecheck  (12.8s)
PASS  tests @zilar/server  (544.2s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Rebase onto main (T-0515, 2026-10-08)

`git rebase main` conflicted only in the `app.ts` import block. Resolved by
keeping both sides: `createBlocksApi` (`./blocks/api`), `createContactsApi`
(`./contacts/api`), `createContactRequestsApi` (`./contact-requests/api`,
main's T-0515) and `createDirectoryApi` (`./directory/api`); no `routes` import
for these four. The mount block auto-merged: main's `contactRequestsApi` mount
plus my blocks/contacts/directory mounts. After the rebase: `pnpm install`
(11.6s); focused tests → 6 files, 73 tests passed; `pnpm gate` → GATE PASS
(install 4.6s, format 56.0s, lint 1.0s, typecheck 15.2s, tests @zilar/server
507.2s; scope: every changed file is inside the Allowed files).

### Open questions / notes

- The blocks re-export shim is the only place a `routes.ts` file survives. If
  the lead prefers, the two limiter tests could be rewritten against the Effect
  mount and `blocks/routes.ts` deleted; that needs a test change, which this
  task forbids.

## Review (written by Claude)

Approved (lead, 2026-10-08). blocks, contacts and directory are served by Effect HttpApi through the adapter, with the same answers, and every listed test is unchanged and green. The legacy createBlocksRoutes stays only because two blocks tests import it. Both pre-review follow-ups (port those tests to the Effect mount, then delete the legacy factory; add directory 400 and limiter tests through the app) are task T-0518. Nit: the stale header comment goes in T-0518 too.
