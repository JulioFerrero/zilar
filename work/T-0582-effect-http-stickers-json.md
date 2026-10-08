---
id: T-0582
title: "Effect C (HTTP), stickers part A: the 12 JSON sticker routes (packs, discover, Telegram import, panel, favorites, delete sticker) onto HttpApi; sticker body schemas in service.ts zod to Effect Schema; upload (multipart) and file GET stay on Hono for part B; same order, statuses and texts; tests unchanged"
status: merged
milestone: M5
branch: task/T-0582-effect-http-stickers-json
model: auto
effort: low
depends_on: [T-0577]
estimate: 1 day
---

# T-0582: sticker JSON routes on Effect HTTP (part A)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. The recipe is `docs/EFFECT_GUIDE.md` "Moving a server route module onto Effect HTTP", items 1-13, with the worked examples `apps/server/src/groups/api.ts` and `apps/server/src/media/api.ts` (a query decoded by hand).

`stickers/routes.ts` is large (441 lines, 14 routes), so it moves in two parts:
- **this task (A)** moves the 12 JSON routes;
- **part B** later moves the multipart upload (`POST /sticker-packs/:id/stickers`) and the file GET (`GET /stickers/:stickerId/file`).

### Verified facts (do not re-derive; read each route for its exact order and texts)
- **`apps/server/src/stickers/routes.ts`**. The routes that move:
  - `GET /sticker-packs` (162);
  - `POST /sticker-packs` (167, **201**);
  - `GET /sticker-packs/discover` (181, query `q?` ≤ 60, `cursor?` ≤ 128);
  - `POST /sticker-packs/import/telegram` (201). Its order:
    1. session;
    2. the token (501 `import_unavailable`);
    3. the body;
    4. `parseTelegramPackInput` (400 "That sticker pack link is not valid");
    5. **then** the limiter (429);
    6. the import;
    7. it answers `{ pack, imported, skippedAnimated, skippedInvalid, partial?: true }`, with `partial` **only when true**;
  - `PATCH /sticker-packs/:id` (240);
  - `DELETE /sticker-packs/:id` (256);
  - `DELETE /sticker-packs/:id/stickers/:stickerId` (335);
  - `PUT /sticker-panel` (350);
  - `PUT /sticker-panel/:packId` (365);
  - `DELETE /sticker-panel/:packId` (371);
  - `GET /sticker-favorites` (381);
  - `PUT /sticker-favorites` (386);
  - `DELETE /sticker-favorites` (400; the body comes **from the query**, `favoriteBodySchema.safeParse(c.req.query())`).
  
  Body decode failures answer 400 `invalid_request` with **the first issue's message**, else "Invalid request". `decodePathId` turns a bad escape into a 404. The Effect router already decodes params like Hono (the T-0576 Report), so keep `decodePathId` exactly as `avatars/api.ts` does.
- **The schemas in `apps/server/src/stickers/service.ts`** (zod):
  - `stickerVisibilitySchema` (27): `'private' | 'server'`, with `type StickerVisibility`;
  - `createPackBodySchema` (118): strict, `title` trimmed with min and max, `visibility?`;
  - `patchPackBodySchema` (128): strict, all optional, plus a refine with **"Nothing to update"** when empty;
  - `reorderPanelBodySchema` (523);
  - `favoriteBodySchema` (586): strict, `sticker_id: uuid`.
  
  Their `z.infer` types (`CreatePackBody`, `PatchPackBody`, `ReorderPanelBody`, `FavoriteBody`) are used by the service functions. **Convert these schema consts and types in `service.ts` to Effect Schema with the same shapes; change nothing else in `service.ts`.** Only `routes.ts` imports the schemas (check with grep).
- **Message texts:**
  - the custom "Nothing to update" must stay byte-identical. **Effect 4.0.2 drops `{ message }` on length checks** (the guide's "Schema, custom messages"), so use `makeFilter` and prove the text;
  - `apps/server/src/stickers/telegram-import-routes.test.ts:581` asserts an exact message; keep it;
  - other zod default texts may become Schema texts (item 10). List the old and new texts in the Report.
- **What stays on Hono in `routes.ts`:** `POST /sticker-packs/:id/stickers` (261, multipart, with the upload limiter) and `GET /stickers/:stickerId/file` (414), plus `readCapped` and `uploadFormSchema` for them.
  - The Hono factory keeps **only** those two routes.
  - `app.ts` mounts the Effect api **and** the reduced Hono factory at the current position (`apps/server/src/app.ts:464-479`), Effect first. **The authz sweep must still see all 14 routes.**
- **Deps:** `StickersRoutesDependencies` (line 45: `auth`, `db`, `config`, `storageDir`, `audit?`, `now?`, `uploadLimiter?`, `importLimiter?`, `telegramClient?`, `getBotToken?`). Keep it and pass the same deps to both. The tests build through `createApp` (nothing mounts `createStickersRoutes` directly; check with grep).
- **Tests (all unchanged):** `apps/server/src/stickers/*.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/stickers/api.ts`** with the 12 routes:
   - the same order, statuses, texts and bodies;
   - success schemas listing every field the service returns (item 8, with the comparison in the Report);
   - the Telegram answer with `partial` only when true.
   
   Export `createStickersApi(deps)` and `STICKERS_API_ROUTES`.
2. **`service.ts`:** the schema consts and types only, as described above.
3. **`routes.ts`:** keep only the two binary routes and what they need. Remove the zod schemas the moved routes used.
4. **`app.ts`:** both mounts, as described above.
5. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe and "Effect 4 facts"), `apps/server/src/groups/api.ts`, `apps/server/src/avatars/api.ts`, `apps/server/src/stickers/routes.ts` (all of it), `apps/server/src/stickers/service.ts` (lines 1-140 and 515-600) and `apps/server/src/app.ts` (lines 455-480).

### Allowed files
`apps/server/src/stickers/api.ts`, `apps/server/src/stickers/routes.ts`, `apps/server/src/stickers/service.ts`, `apps/server/src/app.ts`, `apps/server/src/stickers/telegram-import-routes.test.ts` (added by the lead on 2026-10-08 for the two order regression tests only), `work/T-0582-effect-http-stickers-json.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot stickers authz-sweep app.test
pnpm gate
```

### Acceptance
- The 12 JSON sticker routes are served by Effect `HttpApi`, with the same answers and order and with Effect Schema bodies; the two binary routes are unchanged on Hono.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Created `apps/server/src/stickers/api.ts` with the 12 JSON routes on Effect
  `HttpApi` (`createStickersApi(deps)`, `STICKERS_API_ROUTES`): same order,
  statuses, texts and bodies as `routes.ts`. The Telegram import keeps its
  order (session -> token 501 -> body decode -> pack-input parse 400 ->
  limiter 429 -> import) via a `StickersImportRateLimit` endpoint middleware
  that re-parses the cached body and spends budget only for well-formed
  requests for a real pack name; `partial` is answered only when true.
  `DELETE /sticker-favorites` decodes the id from the query string; the
  discover query decodes manually with the legacy zod schema for the exact
  `issues[0].message`.
- `service.ts`: converted only the schema consts/types to Effect Schema
  (`stickerVisibilitySchema`, `createPackBodySchema`, `patchPackBodySchema`,
  `reorderPanelBodySchema`, `favoriteBodySchema`; `z.infer` -> `.Type`).
  Length messages use `makeFilter` (Effect 4.0.2 drops `{ message }`), and
  "Nothing to update" is a `makeFilter` on `patchPackBodySchema`. The two
  `safeParse` call sites (upload emoji, Telegram emoji) now use
  `Schema.decodeUnknownOption`. Nothing else in `service.ts` changed.
- `routes.ts`: kept only the two binary routes
  (`POST /sticker-packs/:id/stickers`, `GET /stickers/:stickerId/file`) plus
  `readCapped`/`uploadFormSchema`; removed the JSON routes and the zod
  schemas they used. `StickersRoutesDependencies` is unchanged and passed to
  both mounts.
- `app.ts`: mounts the Effect api first (`mountEffectRoutes`) and the reduced
  Hono factory (`app.route('/api', ...)`) at the same position.
- Body decode failures answer 400 `invalid_request` with the exact legacy
  `issues[0].message`: the Schema-error layer replays the matching legacy zod
  schema on the cached body (handles/contact-requests pattern), so only the
  asserted "Nothing to update" plus all other zod texts stay byte-identical.

### Success-schema comparison (service return vs endpoint schema)
- `StickerViewSchema`: id, packId, emoji (NullOr), mime, width, height,
  bytes, url — all 8 fields of `StickerView`.
- `StickerPackViewSchema`: id, ownerId, title, visibility, importedFrom
  (optional, omitted when absent), stickers, createdAt, updatedAt — all 8
  fields of `StickerPackView`.
- `deletePack` returns `{ warning }` -> `DeletePackResult { warning }`.
- `discoverPacks` returns `{ packs, next }` -> `DiscoverPage { packs, next }`.
- Telegram import returns `{ pack, imported, skippedAnimated, skippedInvalid,
  partial }` -> same fields with `partial` optional (present only when true).
- Panel/favorite writes return `{ ok: true }` / `StickerView` / lists —
  matched by `OkResult`, `StickerViewSchema`, `PackList`, `FavoritesList`.

### Old vs new decode texts
- No text changed: every body/query decode replays the legacy zod schema, so
  the 400 message is the old `issues[0].message` in all cases (spot-checked:
  `Too small: expected string to have >=1 characters`,
  `Unrecognized key: "extra"`, `Nothing to update`, `Invalid UUID`,
  `Invalid input: expected array, received undefined`). The exact-message
  test at `telegram-import-routes.test.ts:581` passes unchanged.

### Commands and real results
- `pnpm install`: done (18.6s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot stickers`:
  6 files, 91 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot authz-sweep app.test`:
  2 files, 14 tests passed; sweep covers 158 /api routes.
- `pnpm gate`: GATE PASS — install, format, lint, typecheck, tests
  @zilar/server all PASS; scope: every changed file is inside the Allowed
  files (5 changed files).
- Fixed along the way: middleware generic needed `{ requires: CurrentUser }`
  (provides-type error), `request.text` body re-read works for the limiter
  middleware, limiter constants imported from `./routes`.

### Problems / deviations
- None. All listed tests pass unchanged; no new tests added (spec: tests
  unchanged).

### Round 2 (prereview fix round)
- Finding 1 (must-fix): dropped the `StickersImportRateLimit` endpoint
  middleware and spend the Telegram import budget inline in the handler via
  `spendTelegramImportBudget`, after the 501 token check and the
  `parseTelegramPackInput` 400, exactly like the old route's order. 501s and
  garbage input never consume the 3/hour budget now.
- Findings 2, 3 (nits in lines not otherwise touched): left as-is per the
  task instructions (no nit-only changes).
- Test added: `telegram-import-routes.test.ts` →
  "does not burn the hourly budget on 501s without the token" (3× 501 with no
  token configured, then configure the token and expect 200). It fails on the
  old code (`expected 429 to be 200`) and passes on the new code.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot stickers authz-sweep app.test`:
  8 files, 106 passed, 0 failed.
- `pnpm gate`: GATE PASS — install, format, lint, typecheck,
  tests @zilar/server all PASS; scope notes 1 file outside Allowed files:
  `apps/server/src/stickers/telegram-import-routes.test.ts` (the regression
  test the fix round requires; the spec's "tests unchanged" predates the
  finding).

### Round 3 (prereview fix round: 501-before-decode order)
- Finding 1 (must-fix): `importTelegram` no longer declares a framework
  `payload`; the body is decoded manually inside the handler with
  `Schema.decodeUnknownOption(TelegramImportBody, STRICT_PAYLOAD)` **after**
  the 501 token check, following the `media/api.ts` precedent (501 -> limiter
  -> decode). A missing token now answers 501 `import_unavailable` even with
  a malformed body; a malformed body with the token configured still answers
  400 with the exact legacy `issues[0].message` via the replay (spot-checked
  by the unchanged decode tests, all green). The success schema
  (`TelegramImportResult`) is unchanged, so the endpoint-to-service field
  comparison in this Report still holds.
- Findings 3, 4 (nits in lines not otherwise touched): left as-is per the
  task instructions (no nit-only changes).
- Tests added (`telegram-import-routes.test.ts`, outside the spec's Allowed
  files — see Disagreements): "answers 501 import_unavailable before the body
  decode without the token" (`{}`, `{ input: 7 }`, `{ input: '' }` all 501
  without a token; fails on the pre-fix code with 400).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot stickers authz-sweep app.test`:
  8 files, 107 passed, 0 failed.
- `pnpm gate`: GATE PASS — install, format, lint, typecheck,
  tests @zilar/server all PASS; scope notes 1 file outside Allowed files:
  `apps/server/src/stickers/telegram-import-routes.test.ts` (the regression
  tests the fix rounds require).

### Disagreements
- Finding 2 (should-fix: revert the `telegram-import-routes.test.ts`
  regression test because the spec says "tests unchanged"): not applied. The
  fix-round instructions require a test for each behaviour fix, and both
  Round 2 and Round 3 behaviour fixes are untestable without touching that
  file. I keep both regression tests and ask the lead to extend the Allowed
  files to include `apps/server/src/stickers/telegram-import-routes.test.ts`;
  if the lead disagrees, the Round 2 budget test and the Round 3 501-order
  test should be reverted together (accepting the loss of the guards).

### Security checklist
- Token 501 before decode of pack input; limiter after parse; no token/secret
  in logs, errors or audit (unchanged paths). Deletes/updates scoped by
  owner+id in the service (untouched). 401 sweep covers all 14 routes (158
  total, green). Audit entries carry ids only (untouched).

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean after the auto round: 2 nits and 1 follow-up. The packet (11:24) is newer than HEAD cb01be74.
- **The extra test file:** the lead added `telegram-import-routes.test.ts` to the Allowed files. Its two new tests pin the order the auto round fixed: the 501 for a missing token comes before the body decode and does not use up the hourly import budget.
- **Follow-ups (nits):**
  - `void DiscoverQuery` (`api.ts:692`) is dead code;
  - `PatchPackBody` hardcodes `60` instead of `STICKER_PACK_TITLE_MAX` (`api.ts:98`).
