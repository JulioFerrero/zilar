---
id: T-0520
title: "Effect C (HTTP): chat-prefs and chat-folders routes onto the HttpApi adapter (T-0498 recipe), zod bodies to Effect Schema; every route test unchanged"
status: todo
milestone: M5
branch: task/T-0520-effect-http-chat-prefs-folders
model: auto
effort: low
depends_on: [T-0514]
estimate: 0.5 day
---

# T-0520: chat-prefs and chat-folders on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. T-0498 built the adapter (`handles`). T-0515 and T-0514 moved contact-requests, blocks, contacts and directory. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP".** This task moves wave 2 of plan `docs/audit/effect-everywhere-plan.md` §4.4: `chat-prefs` and `chat-folders`. Do not touch any `service.ts`.

### Verified facts (do not re-derive)
- **Worked examples:** `apps/server/src/handles/api.ts`, `apps/server/src/contact-requests/api.ts`, and the `blocks`, `contacts` and `directory` `api.ts` files from T-0514. The helpers live in `apps/server/src/effect/http.ts`: `Session`, `CurrentUser`, `withErrorEnvelope`, `mountEffectRoutes` and `EffectApiRoute`/`EffectApiMount`.
- **`apps/server/src/chat-prefs/routes.ts`** (161 lines): one `writeLimiter` (`CHAT_PREFS_WRITE_RATE_LIMIT_MAX` = 60 per minute, with an injectable `now`).
  - **`GET /chat-prefs`** gives `{ prefs, defaultBackground }`.
  - **`PUT /chat-prefs/:chatJid`** runs in this order:
    1. session;
    2. decode the body (`putChatPrefSchema`, strict, at least one key or `'Nothing to update'`);
    3. `requireChatAccess` with `decodePathJid` (a bad percent escape gives 404 `not_found` `'Chat not found'`);
    4. limiter (429 `rate_limited` `'Too many preference changes, try again later'`);
    5. `putChatPref` with `parseMutedUntil`.
    
    It returns `{ prefs: null }` when the row went back to its defaults, else the pref.
  - **`GET /chat-background`** gives `{ defaultBackground }`.
  - **`PUT /chat-background`:** session, decode (`putChatBackgroundSchema`), limiter, then `putChatBackgroundDefault`.
  - **Decode errors** are 400 `invalid_request` with zod `issues[0].message ?? 'Invalid request'`. A body that is not JSON decodes as `null`, and so gives a 400.
  - `mutedUntil` is an ISO datetime with an offset, nullable and optional.
- **`apps/server/src/chat-folders/routes.ts`** (183 lines): one limiter (60 per minute, 429 `'Too many folder changes, try again later'`).
  - **`GET /chat-folders`** gives `{ folders }`.
  - **`POST /chat-folders`:** session, decode `createFolderSchema`, limiter, then `createChatFolder`; it answers **201** `{ folder }`.
    - The name is **trimmed**, then 1 to `FOLDER_NAME_MAX` characters.
    - `includeTypes`, `includeChats` and `excludeChats` default to `[]`; `excludeMuted` and `excludeRead` default to `false`.
    - Duplicate refine messages: `'Chat lists must not contain duplicates'` and `'includeTypes must not contain duplicates'`.
  - **`PUT /chat-folders/order`** (`{ ids }`, strict) gives `{ folders }`. **It must stay matched before `/:id`.**
  - **`PATCH /chat-folders/:id`** (every field optional, strict, at least one key or `'Nothing to update'`) gives `{ folder }`.
  - **`DELETE /chat-folders/:id`:** session, limiter, then `{ deleted: true }`.
- **`apps/server/src/app.ts:385-386`** mount both modules with `app.route('/api', create…Routes({ auth, db, config }))`. They are imported at lines 23-24 and have no other importer.
- **Tests (all must pass unchanged):** `apps/server/src/chat-prefs/chat-prefs.test.ts` and `apps/server/src/chat-folders/chat-folders.test.ts`. The 400 texts they assert (`'Choose a preset or an image'`, `'Dim needs an image'`, `'Unknown background image'`, `'You can have up to 20 folders.'`) come from the services and must not change. Also: the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **`chat-prefs/api.ts` and `chat-folders/api.ts`,** following the recipe:
   - the same paths, methods, status codes (201 on create) and bodies;
   - **the same step order per route**, as listed above;
   - injectable `now` and the same exported limit constants;
   - exact-route mounts.
2. **The bodies use Effect Schema, not zod:**
   - strict objects, using the guide's `onExcessProperty: 'error'` fact;
   - `Schema.Trim` (or an equivalent) before the length check on folder names;
   - the defaults;
   - the duplicate checks and the "at least one key" check, **with the same message texts.**
   
   For generic messages that no test asserts (a wrong type, too long, an unknown key), use Schema's message, and list the old and new texts in the Report. **No zod import is left in either module.**
3. **`app.ts`:** replace the two `app.route(...)` lines and their imports with `mountEffectRoutes(...)`, like the modules before. Delete both `routes.ts` files.
4. **Tests:** every test listed above passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe and the Schema facts), `apps/server/src/effect/http.ts`, `apps/server/src/handles/api.ts`, `apps/server/src/blocks/api.ts`, and both `routes.ts` files.

### Allowed files
`apps/server/src/chat-prefs/api.ts`, `apps/server/src/chat-prefs/routes.ts`, `apps/server/src/chat-folders/api.ts`, `apps/server/src/chat-folders/routes.ts`, `apps/server/src/app.ts`, `work/T-0520-effect-http-chat-prefs-folders.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot chat-prefs chat-folders authz-sweep app.test
pnpm gate
```

### Acceptance
- Both modules are served by Effect `HttpApi` through the adapter, with the same answers, and have no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
