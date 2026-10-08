---
id: T-0582
title: "Effect C (HTTP), stickers part A: the 12 JSON sticker routes (packs, discover, Telegram import, panel, favorites, delete sticker) onto HttpApi; sticker body schemas in service.ts zod to Effect Schema; upload (multipart) and file GET stay on Hono for part B; same order, statuses and texts; tests unchanged"
status: todo
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
`apps/server/src/stickers/api.ts`, `apps/server/src/stickers/routes.ts`, `apps/server/src/stickers/service.ts`, `apps/server/src/app.ts`, `work/T-0582-effect-http-stickers-json.md`.

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

## Review (written by Claude)
