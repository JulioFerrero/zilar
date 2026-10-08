---
id: T-0653
title: "zod: drop the legacy schemas in stickers/api.ts (E3); discover and favorite-delete decode with the existing Effect Schemas; invalid bodies answer the same 400 invalid_request with fixed per-route messages ('Nothing to update' kept); add tests"
status: todo
milestone: M5
branch: task/T-0653-stickers-drop-zod
model: auto
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0653: stickers API without zod

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with Schema replacing zod. This is E3 in the T-0626 last-mile audit. T-0650 and T-0651 do the same for `handles` and `contact-requests`.

The lead decided (2026-10-09) that the error texts may change:
- the status (400) and the code (`invalid_request`) stay;
- no test asserts these texts (`apps/server/src/stickers/telegram-import-routes.test.ts:222` checks only the code);
- the one text a client knows, `'Nothing to update'` (`apps/web/src/mock/api.ts:2533`), is kept.

### Verified facts (do not re-derive)
**`apps/server/src/stickers/api.ts`:**
- `import { z } from 'zod';` at line 41.
- The Effect Schemas already exist:
  - `CreatePackBody` (line 101);
  - `PatchPackBody` (lines 114-130), whose filter returns `'Nothing to update'` for `{}`;
  - `DiscoverQuery` (lines 135-138), "kept for parity documentation only";
  - `TelegramImportBody` (lines 143-145) and `STRICT_PAYLOAD` (line 147);
  - `ReorderPanelBody` (lines 150-154);
  - `FavoriteBody` (lines 157-159).
- The legacy zod parts:
  - `stickerVisibilityZod` and the five `legacy*BodySchema` (lines 161-184);
  - `legacyMessage(schema, body)` (lines 186-192);
  - `legacyDiscoverQuerySchema` (lines 203-208).
- The zod parts are used:
  - in `matchLegacyBodyMessage(url, body)` (lines 253-270), called by `schemaErrorLayer` (lines 236-251), which picks the message by path: `/sticker-packs/import/telegram`, `/sticker-panel`, `/sticker-favorites`, `/sticker-packs`, or else the patch;
  - in the `discover` handler (lines 508-529): `legacyDiscoverQuerySchema.safeParse(record)` both decodes and supplies the message;
  - in the `importTelegram` handler (line 552): `legacyMessage(legacyTelegramImportBodySchema, raw)` after a Schema decode fails;
  - in the `removeFavorite` handler (lines 690-705): `legacyFavoriteBodySchema.safeParse(record)` both decodes and supplies the message.
- `parseJsonOrNull` (line 195) feeds `matchLegacyBodyMessage` and the import handler (line 546). The import handler still needs it to decode its body.
- The emoji message at line 756 does not come from zod. Leave it.

### What to build
1. **Replace each legacy message with a fixed message** (`STICKER_PANEL_MAX` and `STICKERS_MAX_PER_PACK` are the existing constants):

   | Route | Message |
   | --- | --- |
   | telegram import | `'input must be a string of 1 to 512 characters, with no other keys'` |
   | sticker panel | `` `order must be a list of at most ${STICKER_PANEL_MAX} sticker ids, with no other keys` `` |
   | sticker favorites (add and remove) | `'sticker_id must be a UUID, with no other keys'` |
   | create pack | `'title must be 1 to 60 characters and visibility private or server, with no other keys'` |
   | patch pack, body `{}` | `'Nothing to update'` |
   | patch pack, other bodies | `` `title must be 1 to 60 characters, visibility private or server and order at most ${STICKERS_MAX_PER_PACK} ids, with no other keys` `` |
   | discover | `'q must be at most 60 characters and cursor at most 128'` |

   `schemaErrorLayer` still reads the cached body only to tell `{}` apart for the patch route.
2. **`discover`:** decode `record` with `Schema.decodeUnknownOption(DiscoverQuery)`. On `None`, throw the fixed 400. Otherwise pass `q` and `cursor` as today. Update the `DiscoverQuery` comment.
3. **`removeFavorite`:** decode with `Schema.decodeUnknownOption(FavoriteBody, STRICT_PAYLOAD)`. On `None`, throw the fixed 400.
4. **Delete** the zod import, `stickerVisibilityZod`, the legacy schemas and `legacyMessage`. Update the comments that describe the zod path (lines 23, 98, 111, 132-134, 140, 149, 156, 161-164, 229-233, 505-507 and 536). Do not mention zod.
5. **Add tests in `apps/server/src/stickers/routes.test.ts`,** in the style of the existing ones:
   - a PATCH of a pack with `{}` answers 400 `invalid_request` with `'Nothing to update'`;
   - a POST `/api/sticker-packs` with `{"title":"ok","extra":1}` answers 400 `invalid_request` with the create message.
6. **Change no existing assertion.**

### Read first
`AGENTS.md`, `apps/server/src/stickers/api.ts` (lines 1-280, 495-560 and 685-710), `apps/server/src/stickers/routes.test.ts` (its harness and one PATCH test).

### Allowed files
`apps/server/src/stickers/api.ts`, `apps/server/src/stickers/routes.test.ts`, `work/T-0653-stickers-drop-zod.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/stickers/routes src/stickers/telegram-import-routes src/stickers/favorites
pnpm gate
```

### Acceptance
- `git grep -n "from 'zod'" apps/server/src/stickers` shows nothing. A comment in `stickers/routes.ts:5` mentions zod; leave it.
- The stickers tests pass, including the two new ones.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
