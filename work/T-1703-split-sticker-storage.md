---
id: T-1703
title: "Size split of apps/server/src/stickers/storage.ts (384 lines): move the view mappers (stickerUrl, toStickerView, toPackView, toAuditEntry) into a new stickers/views.ts and re-export the three public ones from storage.ts so no importer changes — a pure move"
status: merged
milestone: M5
branch: task/T-1703-split-sticker-storage
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1703: Split the sticker view mappers out of stickers/storage.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/stickers/storage.ts` is 384 of 400 lines, so the sticker storage (upload, delete, read) can't change. Its row-to-view mappers are pure and self-contained.

### Facts (the lead read them on 2026-10-16)
- **`storage.ts`:**
  - `resolveStorageDir :40`, `serverPackageRoot :48` and `SERVER_PACKAGE_ROOT :81`;
  - `requireVisiblePack :88`, `loadPackStickers :111` and `requireOwnedPack :126`;
  - **the block to move:**
    - `function stickerUrl(deps, stickerId) :147-149` (private);
    - `export function toStickerView(deps, row) :151-162`;
    - `export function toPackView(…) :164-182`;
    - `export function toAuditEntry(action, actorUserId, subjectId) :184-…`;
    - any comment directly above them;
  - then `function extensionFor :199`, `escapeLike :204`, `uploadSticker :208`, `deleteSticker :307` and `readStickerFile :353` (these stay).
- **Importers of the three public mappers, all from `./storage`:**
  - `apps/server/src/stickers/favorites.ts:6` (`toStickerView`);
  - `apps/server/src/stickers/pack-link.ts:13` (`toPackView`);
  - `apps/server/src/stickers/telegram.ts:19` (`toPackView`);
  - `apps/server/src/stickers/packs.ts:…-26` and `apps/server/src/stickers/service.ts:…-38` (multi-line imports; read them).
- **The folder `apps/server/src/stickers/`** has no `views.ts`.

### Steps
1. **Create `apps/server/src/stickers/views.ts`** with the four functions moved **word for word**, plus only the imports they need (the `StickersServiceDeps`, `StickerRow`, `StickerView` and pack types). It must not import from `./storage`. Keep `stickerUrl` private unless `storage.ts` still calls it; if it does, export it.
2. **`storage.ts`:**
   - delete the block;
   - add `export { toAuditEntry, toPackView, toStickerView } from './views';` so every importer keeps working unchanged;
   - import from `./views` anything `storage.ts` itself still calls (for example `toStickerView` in `uploadSticker`);
   - drop the imports it no longer uses.
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/server/src/stickers/views.ts`
- `apps/server/src/stickers/storage.ts`
- `work/T-1703-split-sticker-storage.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/stickers --reporter=dot
pnpm gate
```

### Acceptance
- **`storage.ts` is about 335 lines,** and `views.ts` holds the mappers unchanged.
- **The `src/stickers` tests and the server typecheck pass.**

---

## Report (written by the worker when done)

### What I did
- Created `apps/server/src/stickers/views.ts` (60 lines) with the four mappers moved **word for word** from `storage.ts`: `stickerUrl` (kept private), `toStickerView`, `toPackView`, `toAuditEntry`. It imports only the types it needs from `./schemas` (`StickerPackRow`, `StickerPackView`, `StickerRow`, `StickerView`, `StickerVisibility`, `StickersServiceDeps`) and does not import from `./storage`.
- `apps/server/src/stickers/storage.ts` (now 333 lines):
  - deleted the four-function block;
  - added `export { toAuditEntry, toPackView, toStickerView } from './views';` so every existing importer (favorites, pack-link, telegram, packs, service — all from `./storage`) keeps working unchanged;
  - imported `toStickerView` from `./views` because `uploadSticker` still calls it;
  - dropped the now-unused `StickerPackView` and `StickerVisibility` type imports.
- No behaviour change, no new tests, no importer edited.

### Checks run
- `pnpm install`: `Done in 22s` (all workspace projects).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/stickers`: `Test Files 1 passed (1)`, `Tests 6 passed (6)`.
- `pnpm gate` (from repo root), summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (1.5s)
  PASS  lint  (1.5s)
  PASS  typecheck  (4.3s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/server  (4.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- `stickerUrl` stayed private to `views.ts`: nothing outside `toStickerView` uses it, and `storage.ts` no longer calls it.
- Changed files: `apps/server/src/stickers/views.ts`, `apps/server/src/stickers/storage.ts`, `work/T-1703-split-sticker-storage.md` — all Allowed.
- No migrations, no API/route changes, no security-relevant behaviour touched (`toStickerView`/`toPackView`/`toAuditEntry` are pure row-to-view mappers).

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the removed lines equal `views.ts` apart from two type names in the import list; the re-export keeps every sticker importer unchanged.
- **The tests:** the lead ran `src/stickers` in the worktree: 1 file, 6 tests passed.
- **Result:** `stickers/storage.ts` drops from 384 to 333 lines.
