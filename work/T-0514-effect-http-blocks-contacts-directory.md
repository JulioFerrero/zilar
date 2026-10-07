---
id: T-0514
title: "Effect C (HTTP): blocks, contacts and directory routes onto the HttpApi adapter (T-0498 recipe); every route test unchanged"
status: todo
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

## Review (written by Claude)
