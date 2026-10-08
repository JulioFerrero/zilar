---
id: T-0520
title: "Effect C (HTTP): chat-prefs and chat-folders routes onto the HttpApi adapter (T-0498 recipe), zod bodies to Effect Schema; every route test unchanged"
status: merged
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

### What I did
- Added `apps/server/src/chat-prefs/api.ts` and `apps/server/src/chat-folders/api.ts`: Effect `HttpApi` groups mounted through `mountEffectRoutes`, with the same paths, methods, status codes (201 on folder create) and bodies.
- Kept the exact per-route step order. The write limiters run **inside** the handlers (not as endpoint middleware, which would run before the body decode):
  - `PUT /chat-prefs/:chatJid`: session → body decode → `requireChatAccess` (incl. `decodePathJid`) → limiter → `putChatPref` → `{ prefs: null }` or the pref.
  - `PUT /chat-background`: session → decode → limiter → `putChatBackgroundDefault`.
  - `POST/PUT order/PATCH`: session → decode → limiter → service. `DELETE`: session → limiter → service.
- Bodies use Effect Schema (no zod): strict via `HttpApi.PayloadParseOptions { onExcessProperty: 'error' }`, `Schema.Trim` before the 1..`FOLDER_NAME_MAX` check, defaults via `Schema.withDecodingDefault`, duplicate and "at least one key" checks via `Schema.makeFilter` with the old texts. Decode failures map to `400 invalid_request` through a module-local `layerSchemaErrorTransform` carrying `SchemaError.message`.
- `app.ts`: swapped the two imports and the two `app.route(...)` lines for `createChatPrefsApi` / `createChatFoldersApi` + `mountEffectRoutes(...)`. Deleted both `routes.ts` files. Kept the exported limit constants and the injectable `now`.

### Files changed (6, all inside the Allowed files)
- `apps/server/src/chat-prefs/api.ts` (new)
- `apps/server/src/chat-prefs/routes.ts` (deleted)
- `apps/server/src/chat-folders/api.ts` (new)
- `apps/server/src/chat-folders/routes.ts` (deleted)
- `apps/server/src/app.ts`
- `work/T-0520-effect-http-chat-prefs-folders.md`

### Commands and real outcomes
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot chat-prefs chat-folders authz-sweep app.test`
  → `Test Files  4 passed (4)`, `Tests  41 passed (41)`.
- `pnpm gate` (from repo root)
  → `gate: 6 changed file(s) against main`; `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`; `scope: every changed file is inside the Allowed files`; `GATE PASS`.
  - An earlier gate run failed only on Prettier formatting of the two new files, and after that a typecheck error: the response schemas typed `backgroundPreset` as the preset literal union while the service returns `string | null`. I fixed both (ran `pnpm exec prettier --write` on the two files; relaxed the response schema to `Schema.NullOr(Schema.String)`), then the full gate passed.

### Message texts: old (zod) → new (Effect Schema)
Generic messages (no test asserts them):
- excess key: `Unrecognized key: "nope"` → `Expected no excess property\n  at ["nope"]`
- folder name too short: `Too small: expected string to have >=1 characters` → `Expected a value with a length of at least 1`
- folder name too long: `Too big: expected string to have <=24 characters` → `Expected a value with a length of at most 24`
- non-object body (empty/unparseable): `expected object, received null` → Effect's `InvalidType` wording (`Expected object`-style); status stays 400.
Preserved exactly (from `Schema.makeFilter`, same as zod refinements): `Nothing to update`, `Chat lists must not contain duplicates`, `includeTypes must not contain duplicates`. The service messages (`Choose a preset or an image`, `Dim needs an image`, `Unknown background image`, `You can have up to 20 folders.`) are untouched. I checked the new texts with a throwaway `node` Schema decode; I did not modify any test.

### Deviations / notes
- `PUT /chat-prefs/:chatJid` success is `Schema.Union([ChatPrefView, Schema.Struct({ prefs: Schema.Null })])` because the router answered the bare pref or `{ prefs: null }`.
- `POST /chat-folders` answers `HttpServerResponse.jsonUnsafe({ folder }, { status: 201 })` (same approach as contact-requests), so the 201 is exact.
- No zod import remains in either module.

### Security checklist
Session middleware runs before any decode/effect; every write is rate-limited (60/min/user on the shared module limiter); unknown and foreign ids answer the same 404 (chat-folders) and unknown/unseeable chats the same 404 (chat-prefs); no audit or secret-logging changes.

### Blocked / needs a decision
None.

## Review (written by Claude)

Approved (lead, 2026-10-08). chat-prefs and chat-folders are served by Effect HttpApi through the adapter, with the same step order, 201 on create, the same limiter texts and the refine texts kept. No zod is left in either module; the generic Schema texts that changed are listed in the Report and no test asserts them. Pre-review clean, 0 nits. Follow-up for later: the Schema excess-key message is multi-line ("at [...]"); the web shows error.message in some dialogs.
