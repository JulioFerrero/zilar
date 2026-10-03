---
id: T-0191
title: Mobile: sticker pack editor and Telegram sticker import
status: planned
milestone: M5
branch: task/T-0191-mobile-sticker-editor-telegram
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0187]
estimate: 1 day
---

# T-0191: Mobile: sticker pack editor and Telegram sticker import

## Spec (written by Claude, do not edit)

### Why
Julio's product direction: user stickers plus a Telegram importer. Web has `PackEditor` and `TelegramImportDialog`; the phone cannot create a pack or import one. Julio, 2026-10-03: "implement all the features we have in web into the mobile app". Roadmap: `docs/ROADMAP_MOBILE_PARITY.md`.

### Verified facts (do not re-derive)
- Web: `apps/web/src/components/PackEditor.tsx` (666 lines), `TelegramImportDialog.tsx` (332 lines); client functions in `apps/web/src/lib/api.ts`: `createStickerPack(input)` (~1372), `patchStickerPack(id, ...)` (~1505), `deleteStickerPack(id)` (~1516), `deletePackSticker(packId, stickerId)` (~1526), `uploadStickerFile(...)` (~1541), `importTelegramStickers(input)` (~1626).
- Server: `apps/server/src/stickers/` (limits, formats, warning on delete, rate limits).
- Mobile: T-0187 adds the Stickers settings page and the base of `stickers-api.ts`; this task adds to it. Pick images with `expo-image-picker`.
- Conventions (all mobile parity tasks): API module in `apps/mobile/src/lib/<area>-api.ts` mirroring the web client function names, validated at the boundary, with an error class carrying `status` and `code`; a hook that returns the real API or the mock (copy `use-ais-api.ts`); screens under `apps/mobile/src/app/`, guarded by `RequireAuth`; components under `apps/mobile/src/components/<area>/`; lucide icons, no emoji; every list has loading, empty and error states; error text shown to the user is always a fixed plain sentence, never the server's raw message; no new dependency (`expo-image-picker`, `expo-document-picker`, `expo-clipboard`, `zod` are already installed); never log tokens, codes, keys or message text; one row in `settings-items.ts` per settings page (`ownerOnly` where the web page is owner-only).

### What to build
1. Extend `apps/mobile/src/lib/stickers-api.ts` (+ tests) with the functions above.
2. `apps/mobile/src/app/settings/sticker-pack.tsx` (new pack or edit by id): name, add stickers from the photo library with upload progress and the server's limits shown as fixed sentences, remove a sticker, delete the pack with the server's warning text in a confirm sheet (the warning is shown verbatim only because it is a fixed server string; read the route).
3. A 'Import from Telegram' sheet on the Stickers page: paste a pack link or name, show progress and the result summary, errors as fixed sentences.
4. Tests (Vitest): API additions, the editor (create, add, remove sticker, delete with warning), the import sheet (success, partial, error).

### Read first
`AGENTS.md`, `docs/ROADMAP_MOBILE_PARITY.md`, `docs/design/ui-style.md`, `apps/mobile/src/lib/approvals-api.ts` and `apps/mobile/src/lib/ais-api.ts` (the API module pattern), `apps/mobile/src/components/ais/use-ais-api.ts` and `require-ais-auth.tsx` (the real-or-mock hook and the auth guard), `apps/mobile/src/app/ais/index.tsx` (a screen with header, list, empty and error states), `apps/mobile/src/lib/settings-items.ts` (add your row), plus the web files named above.

### Allowed files
`apps/mobile/src/lib/stickers-api.ts` and test, `apps/mobile/src/app/settings/sticker-pack.tsx`, `apps/mobile/src/components/stickers/**`, `apps/mobile/src/app/settings/stickers.tsx` (only the two entry buttons).

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 stickers sticker-pack
```
Say in the Report that the lead tests on the emulator and the phone.

### Acceptance
- A pack can be created and edited from the phone with photos from the library.
- A Telegram pack can be imported from a pasted link.
- No emoji in UI, no new dependency, no server change, no unrelated file touched.

### Out of scope
Animated stickers beyond what the server accepts, sharing packs.

---

## Report (written by the worker when done)

## Review (written by Claude)
