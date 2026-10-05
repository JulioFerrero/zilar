---
id: T-0232
title: "Server: chat_folders table and API (Telegram-style folders synced between web and phone)"
status: merged
milestone: M5
branch: task/T-0232-chat-folders-server
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0231, T-0171]
estimate: 0.7 day
---

# T-0232: Chat folders on the server

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: chat folders must be fully configurable like Telegram and the same on web and phone. Brief `docs/design/briefs/telegram-nav-folders-settings.md` section b (data model, REST) and "Decisions" (defaults are only Personal and AIs; no Work). Schema task: launch only when no other schema task runs.

### Verified facts (do not re-derive)
- The shared shape and limits are in `packages/chat-core/src/folders.ts` (T-0231): `ChatFolder { id, name, icon, position, includeTypes, includeChats, excludeChats, excludeMuted, excludeRead }`, `FOLDER_ICONS` (24 names), `FOLDER_NAME_MAX = 24`, `FOLDERS_MAX = 20`, `FOLDER_CHATS_MAX = 100`, `defaultFolders()`. The server does NOT depend on `@zilar/chat-core` (`apps/server/package.json` lines 15-17 list protocol, runner-tunnel, xmpp-core): copy the icon list and limits into the server module with a comment naming the source; do not add the dependency.
- Nearest table and routes to copy the style from: `chat_prefs` (`apps/server/src/db/schema.ts` lines 603-619: user FK cascade, jid length check 1-255, user index) and `apps/server/src/chat-prefs/routes.ts` (session via `requireSession` line 66, write limiter lines 59-63, `HttpError(429, 'rate_limited', ...)` line 88). Mounted in `apps/server/src/app.ts` line 358.
- Migrations: generate with `pnpm --filter @zilar/server db:generate`. The latest on main is `0039_workable_sunspot` (T-0171), so this task's migration is `0040_*`.
- `apps/server/src/authz-sweep.test.ts` collects every route from `app.routes` (line 79), so new routes are swept for 401 automatically.

### What to build
1. Table `chat_folders` in `schema.ts` + one generated migration:
   - `id` (text pk, random uuid);
   - `user_id` (FK user cascade);
   - `name` (text, check 1-24 chars);
   - `icon` (text);
   - `position` (integer not null);
   - `include_types`, `include_chats`, `exclude_chats` (text[] not null default '{}');
   - `exclude_muted`, `exclude_read` (boolean not null default false);
   - `created_at`, `updated_at` (timestamptz default now);
   - index on `user_id`.
2. Module `apps/server/src/chat-folders/` (`service.ts`, `routes.ts`, `chat-folders.test.ts`), mounted under `/api` in `app.ts` next to chat-prefs. Session required, writes limited to 60 per minute per user (own limiter, injectable), JSON shape = chat-core `ChatFolder` (camelCase).
   - GET `/api/chat-folders` (new) → `{ folders }` sorted by position. When the user has no rows AND has never had folders, insert the two defaults (Personal: icon `user`, includeTypes `['dm']`; AIs: icon `bot`, `['ai']`) and return them. Track "seeded" so a user who deletes every folder does not get them back: add a boolean column `seeded` on a one-row-per-user table or reuse an existing per-user settings table if one exists (check `schema.ts`; if none, add `chat_folder_seeds(user_id pk FK cascade, seeded_at)` in the same migration).
   - POST `/api/chat-folders` (new): body strict zod (`name` 1-24 trimmed, `icon` in the list, `includeTypes` subset of `dm|group|channel|ai` unique, `includeChats`/`excludeChats` unique jids 1-255 chars, max 100 each, booleans). Appended last. 409 `folder_limit` (`You can have up to 20 folders.`) at 20. 201 `{ folder }`.
   - PATCH `/api/chat-folders/:id` (new): same fields, all optional, strict; 404 `not_found` when the id is not the caller's (same 404 for unknown). 200 `{ folder }`; bumps `updated_at`.
   - PUT `/api/chat-folders/order` (new): `{ ids: string[] }` must be exactly the caller's folder ids (no missing, no extra, no duplicates) → 400 `invalid_request` otherwise; rewrites positions 0..n-1 in one transaction. 200 `{ folders }`.
   - DELETE `/api/chat-folders/:id` (new): 404 as above; 200 `{ deleted: true }`; positions of the rest closed up in the same transaction.
   - Every write is scoped `WHERE user_id = caller`.
3. Tests (Vitest, same DB test setup as `chat-prefs.test.ts`): seeding on first GET and not again after deleting all; create, limit 409 at 20, validation 400s (bad icon, long name, unknown type, duplicate ids, 101 chats); patch own vs another user's (404); order happy path and the three 400 cases; delete closes positions; another user never sees or changes my folders; 429 after 60 writes.

### Read first
`AGENTS.md` (security checklist), `packages/chat-core/src/folders.ts`, `apps/server/src/chat-prefs/routes.ts`, `apps/server/src/chat-prefs/service.ts`, `apps/server/src/chat-prefs/chat-prefs.test.ts` (setup), `apps/server/src/db/schema.ts` (lines 590-620), `apps/server/src/app.ts` (lines 345-365).

### Allowed files
`apps/server/src/chat-folders/routes.ts` (new), `apps/server/src/chat-folders/service.ts` (new), `apps/server/src/chat-folders/chat-folders.test.ts` (new), `apps/server/src/db/schema.ts`, `apps/server/src/app.ts`, `apps/server/src/authz-sweep.test.ts`, `apps/server/drizzle/0040_*.sql` (new, exactly one; use the real next number), `apps/server/drizzle/meta/_journal.json`, `apps/server/drizzle/meta/0040_snapshot.json` (new; real next number), `work/T-0232-chat-folders-server.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chat-folders src/authz-sweep.test.ts
pnpm gate
```

### Acceptance
- The five routes behave as above, scoped to the caller, rate limited, never leaking another user's folders.
- Defaults are Personal and AIs only, seeded once.
- No web or mobile change; no new dependency; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Web and mobile UI, realtime push of folder changes (clients refetch on focus), audit entries (folders are personal UI preferences, like chat-prefs).

---

## Report (written by the worker when done)

Built the `chat_folders` table + API per spec. `pnpm install` ok (12.5s).

What I did:
- `apps/server/src/db/schema.ts`: `chatFolders` table (uuid pk, user FK cascade, name check 1-24, icon, position, 3 text[] not null default '{}', 2 booleans default false, timestamptz created/updated, index on user_id) + `chatFolderSeeds` one-row-per-user table (`user_id` pk FK cascade, `seeded_at`). No reusable per-user settings table existed in schema.ts, so I added the seeds table as the spec allowed.
- `apps/server/drizzle/0040_majestic_legion.sql` (+ journal/snapshot): generated via `pnpm --filter @zilar/server db:generate`. Matches spec exactly.
- `apps/server/src/chat-folders/service.ts` (new): icon list + limits copied from chat-core with source comment (no new dependency); `listChatFolders` (seeds Personal/user+dm and AIs/bot+ai once, per-user advisory lock, re-reads inside tx, seed-row insert as race backstop); create (409 `folder_limit` / `You can have up to 20 folders.`), patch (404 same for foreign/unknown), reorder (400 `invalid_request` on missing/extra/duplicates), delete + position close-up. All writes scoped `WHERE user_id = caller`.
- `apps/server/src/chat-folders/routes.ts` (new): GET/POST/PATCH/PUT-order/DELETE under `/api/chat-folders`, `requireSession`, own 60/min/user write limiter (injectable `now`), strict zod bodies (trimmed name 1-24, icon enum, unique types/jids, max 100 chats, `Nothing to update` on empty patch). PUT `/order` is registered before PATCH `/:id` so the method+path pair is unambiguous.
- `apps/server/src/app.ts`: mounted `createChatFoldersRoutes` next to chat-prefs.
- `apps/server/src/chat-folders/chat-folders.test.ts` (new): 10 tests covering seeding-once, create 201, 409 at 20, all 400 validations, patch own vs 404 foreign, order happy path + 3 (actually 4: missing/extra/dup/empty) 400 cases, delete close-up + 404s, cross-user isolation, 429 after 60 writes, 401s.

Commands and real results:
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chat-folders src/authz-sweep.test.ts`: 2 files, 15 tests passed (10 folder + 5 sweep; sweep shows all 5 folder routes answering 401 unauthenticated).
- `pnpm gate`: GATE PASS — install PASS, format PASS (after one prettier --write on my own files), lint PASS (after removing one unused import), typecheck PASS, tests @zilar/server PASS; "scope: every changed file is inside the Allowed files".

Security checklist: no secrets/tokens in logs (ids only, no message text); deletes/updates scoped by user_id+id; 20-folder cap enforced atomically under per-user advisory lock with state read inside the tx; unknown and foreign ids answer the same 404; new routes covered by the 401 sweep; writes rate-limited 60/min/user; no audit entries (out of scope per spec, like chat-prefs).

Deviations: none. The `FolderTransaction` type is inferred from `ServerDatabase['transaction']` (works for both postgres-js and pglite unions); no `any`, no `@ts-ignore`.

## Review (written by Claude)

**Verdict:** Approved, clean first pre-review (0 nits). Read migration 0040 (`chat_folders` with the name check and user index, `chat_folder_seeds` for seed-once) and the service: every read-modify-write (seed, create with the 20 limit, patch, order, delete) runs under the per-user `chat-folders:` advisory lock, so two concurrent first loads cannot seed twice and two creates cannot pass the limit. Next: web folder rail + Chat folders page, then mobile folders.
