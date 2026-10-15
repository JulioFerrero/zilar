---
id: T-1533
title: "Phone Stickers My packs (approved Stickers canvas, Phone + PhoneSheet; twin of T-1523): header Back + New pack key and a large title; lean pack rows (4 thumbs, name, globe when shared, count) that open a pack sheet (its stickers, then Share, Edit, Make private/shared, Move up/down, Remove from panel, Delete); Import from Telegram as a row; Added rows with @handle and a remove key"
status: merged
milestone: M5
branch: task/T-1533-mobile-my-packs
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1533: Phone Stickers My packs

## Spec (written by Claude, do not edit)

### Why
Julio approved the Stickers design on 2026-10-15. Read `docs/design/mockups/stickers/README.md`, `Phone.dc.html` and `PhoneSheet.dc.html`. Web shipped as T-1523, and the phone pack link page as T-1524.

The phone's My packs tab still shows big cards with Move up/down, Edit and Remove word buttons, and has no Share. **No status words**, and the kit's sizes (`IconButton` 40 px with 12).

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/app/settings/stickers.tsx` (193 lines):** `SettingsScreenShell`, a `SegmentedControl` with the tabs already (`:87-99`), then `PacksTab`, `DiscoverTab` and `FavoritesTab`, a `ConfirmDialog` and `TelegramImportSheet`. The screen hook provides `movePack`, `askRemove`, `addPack`, `token` and `meId` (`:55-75`).
- **`apps/mobile/src/components/stickers/packs-tab.tsx` (140 lines):**
  - a "My packs" heading with a "New pack" button and an "Import from Telegram" button (`:41-63`);
  - `PackCard` rows with Move up/down (`ChevronUp`/`ChevronDown`), Edit and Remove buttons (`:83-135`);
  - props `onMove`, `onRemove`, `onEdit`.
- **`apps/mobile/src/components/stickers/pack-card.tsx` (77 lines):** 3 overlapping 36 px thumbs through `stickerImageSource` and `expo-image` (`:28-60`), and a title and count.
- **Sharing:** `stickerPackUrl(packId)` (`apps/mobile/src/lib/stickers.ts:137`) and `Share.share({ message })` (see `apps/mobile/src/app/settings/contacts.tsx:136-145`).
- **The sheet:** `ActionSheet` and `ActionSheetItem` (`apps/mobile/src/components/ui/action-sheet.tsx`).
- **Visibility:** the pack's `visibility` is `'private' | 'server'`. The existing visibility change is in the pack editor (`pack-visibility-field.tsx`), and the API patch is `patchStickerPack` in `apps/mobile/src/lib/stickers-api.ts`.
- **The owner's handle:** `ownerHandle` on list packs is optional and may be missing (T-1531 adds it on the server); show it only when present.

### Steps
1. **Header:**
   - `SettingsScreenShell` with no subtitle;
   - at the top right, a "New pack" `IconButton` (`Plus`) that opens today's create flow;
   - the large title "Stickers";
   - the tabs stay.
2. **My packs (`packs-tab.tsx` and `pack-card.tsx`):**
   - remove the heading and buttons;
   - one rounded list (`overflow-hidden rounded-2xl border border-border bg-surface`, rows divided by a hairline);
   - each row is pressable: four 36 px thumbs side by side (gap 4, radius 8), the name (15 px, 600) with a `Globe` icon (`accessibilityLabel` "Shared") when `visibility === 'server'`, the meta "N stickers" (with " · Telegram" for an imported pack), and a `ChevronRight`;
   - the last row of the list is "Import from Telegram" (a `Download` icon tile and the text), which opens today's import sheet.
   - Pressing a pack row opens the pack sheet.
3. **New `apps/mobile/src/components/stickers/pack-sheet.tsx`** after `PhoneSheet.dc.html`: an `ActionSheet` with a header row (name, count, Close), a strip of up to 8 sticker thumbs, then the items:
   - **Share:** shares `stickerPackUrl(id)`;
   - **Edit:** today's edit;
   - **Make private / Make shared:** patches visibility, with an error in the sheet;
   - **Move up / Move down:** today's `movePack`; hide one at the end of the list;
   - **Remove from panel:** today's remove;
   - **Delete:** red, behind today's confirm.
   
   Owner-only items (Edit, visibility, Delete) show only for your own packs.
4. **Added section:** a small label "Added", then the same list style. The meta is "N stickers · @handle" when `ownerHandle` is set. A `CircleMinus` `IconButton` ("Remove <name> from panel") takes the place of the word button. Pressing the row opens `/stickers/<id>` (the T-1524 page).
5. **Keep Discover and Favorites unchanged**, and every file under 400 lines.

### Not in scope
- web;
- the server;
- the New pack grid (a later task);
- drag to reorder.

### Tests
None (UI).

### Allowed files
- `apps/mobile/src/app/settings/stickers.tsx`
- `apps/mobile/src/components/stickers/packs-tab.tsx`
- `apps/mobile/src/components/stickers/pack-card.tsx`
- `apps/mobile/src/components/stickers/pack-sheet.tsx` (new)
- `apps/mobile/src/lib/stickers-api.ts` (only to map `ownerHandle` or add a visibility call, if missing)
- `work/T-1533-mobile-my-packs.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Phone mock `/settings/stickers`:**
  - the large title, the tabs, and Cats and Moods as lean rows with the globe;
  - an "Import from Telegram" row;
  - tapping a pack opens the sheet with its stickers and Share, Edit, Make private, Move, Remove from panel and Delete.
- No word buttons on the rows.

---

## Report (written by the worker when done)

### What I did
- **Header (`stickers.tsx`):** dropped the subtitle; the `SettingsScreenShell` `right` slot holds a "New pack" `IconButton` (`Plus`, label "New pack") that opens today's create flow (`/settings/sticker-pack`); the title stays "Stickers" and the three tabs are unchanged.
- **My packs (`packs-tab.tsx`, `pack-card.tsx`):** removed the heading and the New pack / Import buttons; one rounded list (`overflow-hidden rounded-2xl border border-border bg-surface`, rows divided by a hairline) of lean pressable rows — four 36 px thumbs side by side (gap 4, radius 8), the name (15 px, 600) with a `Globe` (`accessibilityLabel` "Shared") when `visibility === 'server'`, the meta "N stickers" ("· Telegram" for an imported pack), and a `ChevronRight`. The row opens the pack sheet. The last row of the list is "Import from Telegram" (a `Download` tile and the text), which opens today's import sheet.
- **Pack sheet (`pack-sheet.tsx`, new):** an `ActionSheet` after `PhoneSheet.dc.html` — a header (name, globe, count, `Close` key), a strip of up to 8 sticker thumbs, then **Share** (`stickerPackUrl(id)`), the owner-only **Edit**, **Make private / Make shared** (patches visibility, the error shows inside the sheet via the sheet's `error` line) and **Delete** (red, behind a confirm), **Move up / Move down** (today's `movePack`, one hidden at each end of the panel) and **Remove from panel** (today's remove).
- **Added (`packs-tab.tsx`):** a small "Added" label and the same list style; the meta is "N stickers · @handle" when `ownerHandle` is set; a `CircleMinus` `IconButton` ("Remove <name> from panel") replaces the word button; pressing the row opens `/stickers/<id>` (the T-1524 page). The panel list is split into your own packs and added packs (`ownerId` vs `meId`); while `meId` is unknown every pack counts as your own, so no Added row flashes a remove key on your pack.
- **Delete:** a new `ConfirmDialog` in `stickers.tsx` with the pack editor's exact copy; Delete and Remove both close the sheet before their confirm.
- **`stickers-api.ts`:** maps the optional `ownerHandle` from the pack row onto a new `PanelPack` type (`StickerPack & { ownerHandle?: string | null }`).
- Discover and Favorites are behaviourally unchanged (see Notes 2).

Files changed: `apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/components/stickers/packs-tab.tsx`, `apps/mobile/src/components/stickers/pack-card.tsx`, `apps/mobile/src/components/stickers/pack-sheet.tsx` (new), `apps/mobile/src/lib/stickers-api.ts`, `work/T-1533-mobile-my-packs.md`.

### Checks run
- `pnpm gate` (repo root) — real output (last run):

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (2.0s)
PASS  lint  (1.1s)
PASS  typecheck  (4.9s)
PASS  effect  (1.0s)
PASS  tests @zilar/mobile  (2.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- Single tests: none run by hand — the task says none (UI) and there is no sticker test file near the change; the gate's `tests @zilar/mobile` step passed (2.4s). The first `pnpm gate` failed `typecheck` on `stickers.tsx` (`Effect.ensuring` needs an Effect, not a thunk); I fixed the two calls and the re-run passed.

### Notes for the lead
1. **`@handle` in Added rows could not be built in scope.** The spec's fact is not true of the list rows: the contract's `StickerPack` has no `ownerHandle` (`packages/api-contract/src/stickers.ts:117` is inside `StickerPackDetail`), and the server returns it only from `GET /sticker-packs/:id` (`apps/server/src/stickers/pack-link.ts:39`); the panel and Discover payloads carry plain `StickerPack` rows. So Added rows show only the count today. I still mapped the field on the mobile side (`PanelPack` in `stickers-api.ts`), so the meta gains "· @handle" the moment the list payload carries it — that needs the contract and the server (the same follow-up the web twin T-1523 reported). Because Effect's struct decode drops unknown keys, the mapping only fires once the contract's `StickerPack` includes `ownerHandle`.
2. **Discover kept its file and behaviour, but its rows now use the shared `PackCard` content** (four 36 px side-by-side thumbs, a globe when shared, the plain count) inside the same bordered card, and the old "· Shared" / "· Imported" subtitle is gone. `discover-tab.tsx` is not in the Allowed files, so I could not keep it pixel-identical; if you want it exactly as before, `PackCard` needs a second layout for the card case or `discover-tab.tsx` must be in scope.
3. **Phone mock vs the spec:** `Phone.dc.html` draws three 34 px thumbs (gap 3); the spec step 2 says four 36 px (gap 4, radius 8). I followed the spec (four 36 px), which also matches the web `Main.dc.html`.
4. **Not smoke-tested on a device:** no dev server or daemon was started (rules), so the phone acceptance (open a pack, the sheet items, visibility, delete) still needs your/Julio's live check.
5. The header title is the shell's 20 px, not the mock's 28 px: `SettingsScreenShell` is not in the Allowed files.
6. No migrations, server, web or registry files touched; no new dependencies.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 3 follow-ups the worker disclosed.
- **Phone smoke** (`/settings/stickers`, mock): PASS.
  - **The screenshot:** Back and + keys, "Stickers", the My packs / Discover / Favorites tabs, then one rounded list with Cats and Moods as lean rows (4 thumbs, name, globe, "6 stickers", chevron) and an "Import from Telegram" row. Thumbs are blank in mock mode, by Julio's choice.
  - **No word buttons** on the rows.
  - The pack sheet (Share, Edit, Make private, Move, Remove from panel, Delete) was read in the code; the smoke cannot tap.
- **Follow-ups:**
  - **F2 (@handle on Added rows):** fixed by T-1531, merged before this. `ownerHandle` is now on the list payloads, and the mock seeds "Space cats" by @marta.
  - **F1 (Discover rows changed look)** and **F3 (the 28 px large title needs `screen-shell.tsx`)** go on the NOW list as one phone stickers polish task.
