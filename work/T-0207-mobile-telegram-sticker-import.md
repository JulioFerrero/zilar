---
id: T-0207
title: Mobile: import a Telegram sticker pack from the Stickers screen
status: planned
milestone: M5
branch: task/T-0207-mobile-telegram-sticker-import
model: minimax-coding-plan/MiniMax-M3
effort: default
depends_on: [T-0191]
estimate: 1 day
---

# T-0207: Mobile Telegram sticker import

## Spec (written by Claude, do not edit)

### Why
Julio's product direction: user stickers plus a Telegram importer. Web has `TelegramImportDialog`; the phone cannot import. Julio, 2026-10-03: "implement all the features we have in web into the mobile app". Split out of T-0191 (the pack editor), which this builds on.

### Design
Follow `docs/design/briefs/T-0207-telegram-import.md` exactly for layout, sizes, icons, copy, states and error sentences. Where this spec and the brief disagree, the spec wins.

### Verified facts (do not re-derive)
- Server route `POST /sticker-packs/import/telegram` (`apps/server/src/stickers/routes.ts` line 201), body exactly `{ input: string }` (1 to 512 characters, `.strict()`, line 134). Responses:
  - 200: `{ pack, imported, skippedAnimated, skippedInvalid, partial? }` (lines 230-236); `partial` is present only when true.
  - 501 `import_unavailable` (no Telegram token on the server, line 205).
  - 400 `invalid_request` (bad link or name, line 222, or a body problem).
  - 429 `rate_limited` (3 imports per hour per person, line 227).
  - From the service (`apps/server/src/stickers/service.ts`): 404 `pack_not_found`, 503 `try_later`, 409 `token_invalid`, 400 `custom_emoji_unsupported`, 400 `pack_limit`.
  - The import can take up to 30 seconds.
- Web client: `importTelegramStickers(input)` and `telegramImportResultSchema` in `apps/web/src/lib/api.ts` (lines 1616-1632). Web dialog: `apps/web/src/components/TelegramImportDialog.tsx`.
- After T-0191: the mobile `StickerPack` has optional `ownerId`, `visibility`, `importedFrom`; `StickersApi` in `apps/mobile/src/lib/stickers-api.ts` has the editor functions; the mock is `apps/mobile/src/components/stickers/stickers-mock.ts`; the editor route is `/settings/sticker-pack?id=...`; the Stickers screen `apps/mobile/src/app/settings/stickers.tsx` has the `New pack` pill in the My packs heading row. Read these files on main before you start; the line numbers moved with T-0191.
- Modals and sheets: copy the structure of the confirm `Modal` already in `stickers.tsx` (transparent, `bg-black/40` backdrop).

### What to build
1. `StickersApi` + real client + mock gain `importTelegramStickers(input: string): Promise<TelegramImportResult>` with `TelegramImportResult = { pack: StickerPack; imported: number; skippedAnimated: number; skippedInvalid: number; partial: boolean }` (`partial` false when absent). Validate the response at the boundary like the other functions; errors become the module's error class with `status` and `code`. The mock returns a success, and it can be switched to the `partial`, `import_unavailable`, `token_invalid` and `rate_limited` outcomes for tests.
2. New `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`: the sheet of the brief with its form, busy, result, not-set-up and token-rejected states. Map errors to the brief's sentences by HTTP status and code (`import_unavailable` and `token_invalid` switch to their states; `rate_limited` and any 429 give the rate-limit sentence; `invalid_request` gives the invalid-link sentence; anything else, including network errors, gives `The import failed. Try again.`). Never show server text. One request at a time (ref guard). The sheet cannot be closed while busy.
3. Put the pure parts (error-to-state mapping, count sentences with singular and plural) in `apps/mobile/src/components/stickers/telegram-import.ts` so they are tested without rendering.
4. `stickers.tsx`: the `Import from Telegram` row under the My packs heading row (brief section 1) opens the sheet; `Done` reloads the list; `Open pack` closes the sheet and pushes `/settings/sticker-pack?id=<pack id>`. Nothing else on that screen changes.
5. Tests (Vitest): the API function (path, method, body, result parsing with and without `partial`, error mapping); `telegram-import.ts` (every code to its state or sentence, plural forms); the sheet (success with counts, partial with `Import again`, not-set-up state, rate limit sentence, empty input sentence, busy blocks close).

### Read first
`AGENTS.md`, `docs/design/briefs/T-0207-telegram-import.md`, `apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/lib/stickers-api.ts`, `apps/mobile/src/components/stickers/stickers-mock.ts`, `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/web/src/components/TelegramImportDialog.tsx`.

### Allowed files
`apps/mobile/src/lib/stickers-api.ts`, `apps/mobile/src/lib/stickers-api.test.ts`, `apps/mobile/src/components/stickers/stickers-mock.ts`, `apps/mobile/src/components/stickers/stickers-mock.test.ts`, `apps/mobile/src/components/stickers/telegram-import.ts` (new), `apps/mobile/src/components/stickers/telegram-import.test.ts` (new), `apps/mobile/src/components/stickers/telegram-import-sheet.tsx` (new), `apps/mobile/src/components/stickers/telegram-import-sheet.test.tsx` (new), `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/mobile/src/app/settings/stickers.tsx`, `work/T-0207-mobile-telegram-sticker-import.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers telegram-import
pnpm gate
```
The lead checks the sheet on the Android emulator (`pnpm phone:smoke`) before merging.

### Acceptance
- A Telegram pack link or name imports a pack; the result shows the counts; `partial` offers `Import again`; `Open pack` opens the editor.
- Every error code shows the brief's state or fixed sentence, never server text.
- No emoji in app chrome, no new dependency, no server change; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Choosing a visibility for imported packs, animated stickers, an import history, the pack editor itself (T-0191).

---

## Report (written by the worker when done)

## Review (written by Claude)
