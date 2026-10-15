---
id: T-1523
title: "Web Stickers page (approved Stickers canvas, Main + WebDiscover): header keys Import from Telegram + New pack; tabs My packs · Discover · Favorites; my packs drag to reorder by a grip (SortableList) instead of up/down keys; lean pack rows (4 thumbs, name, globe icon when shared, count); Discover searches as you type with Add or a green check"
status: merged
milestone: M5
branch: task/T-1523-web-stickers-tabs
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1523: Web Stickers page: tabs and drag

## Spec (written by Claude, do not edit)

### Why
Julio approved the Stickers design on 2026-10-15. Read `docs/design/mockups/stickers/README.md`, `Main.dc.html` and `WebDiscover.dc.html`. The pack link page (T-1497), motion (T-1501) and the New pack grid (T-1509) have shipped. The list page still stacks three sections, uses up/down keys and shows word badges.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/routes/StickersPage.tsx` (303 lines):**
  - `SettingsShell` with the title "Stickers" and a subtitle (`:139-142`);
  - the sections "My packs" (heading, Import from Telegram and Create pack buttons, rows; `:162-207`), "Packs I added" (`:209-218`), Discover (a `SearchField` with a submit button; `:213-256` region) and Favorites (`:257-` region);
  - the dialogs at the end;
  - moves go through `runMove`, which calls `movePack(packs ?? [], …)` (`:88-90`, `:101`).
- **`apps/web/src/components/sticker/PackRows.tsx` (155 lines):**
  - `MyPackRow` has a `VisibilityBadge` word ("Private"/"Shared"), "N stickers · Imported from Telegram", Move up and Move down `ChevronUp`/`ChevronDown` buttons, and `PackMenu`;
  - `AddedPackRow` has a "Remove" word button;
  - `DiscoverPackRow` has Add/Remove word buttons;
  - `PackRowShell` is shared.
- **`apps/web/src/components/sticker/PackThumbs.tsx` (56 lines):** 56 px (`size-14`) thumbs and the `VisibilityBadge` component.
- **`apps/web/src/components/sticker/pageActions.ts` (229 lines):**
  - `reorderPanel(next, previous, setters)` (`:196-213`) sends the whole panel order to the atomic reorder endpoint and restores the old order on failure;
  - `movePack` (`:215-229`) moves one step.
- **The kit:**
  - `SortableList`, `SortableItem` and `SortableHandle` in `apps/web/src/components/ui/sortable-list.tsx` (dnd-kit, keyboard included), used in `apps/web/src/routes/FoldersPage.tsx:86-142`;
  - `SegmentedControl` (`apps/web/src/components/ui/segmented-control.tsx:34`, `mode="tabs"`);
  - `SettingsShell` has `action`, and `subtitle` is optional;
  - `IconButton`.
- **`StickerPack` has `ownerHandle`** (`packages/api-contract/src/stickers.ts:117`).

### Steps
1. **The header (`StickersPage.tsx`):**
   - drop the subtitle;
   - the `action` slot holds "Import from Telegram" (outline `Button` with an `Upload` icon) and "New pack" (primary `Button` with `Plus`, opening today's create flow);
   - remove the old buttons from the section.
2. **Tabs:** under the header, a `SegmentedControl` in tabs mode with My packs · Discover · Favorites. Only the chosen tab's content renders; My packs is the default.
3. **My packs tab:**
   - **Your packs:** one rounded list (`overflow-hidden rounded-xl border border-border bg-surface`, rows divided by `border-b border-divider`) inside a `SortableList`. Each row (`SortableItem`) holds:
     - a `SortableHandle` grip (label "Drag <name> to reorder");
     - four 36 px thumbs (`PackThumbs` gains an optional `size` prop);
     - the name (14 px, 600) linking to `/stickers/<id>`, with a `Globe` icon (`aria-label="Shared"`) when shared;
     - the meta "N stickers" (13 px, muted);
     - `PackMenu` behind the kit `IconButton` ⋮.
   - Remove the Move up/down keys, the word badge and "Imported from Telegram". The empty text stays.
   - **Reorder:** a new `dragPack(ordered, activeId, overId, setters)` in `pageActions.ts` moves the active pack to the over pack's place in the whole panel list and calls `reorderPanel`. `movePack` is removed if nothing else uses it.
   - **Added:** a small label "Added", then the same list style without a grip. The meta is "N stickers · @handle" when `ownerHandle` is set. A `CircleMinus` `IconButton` (label "Remove <name> from panel") takes the place of the "Remove" word.
4. **Discover tab:**
   - a `SearchField` ("Search shared packs") that searches as you type, debounced about 300 ms, with no submit button;
   - the rows use the list style with meta "N stickers · @handle";
   - the action is a primary "Add" (with `Plus`), or, when the pack is in your panel, an `IconButton` with a green `Check` (label "<name> is in your panel. Remove") that removes it.
5. **Favorites tab:** today's favorites, unchanged.
6. **`PackRows.tsx` and `PackThumbs.tsx`:** update them to these rows. Delete `VisibilityBadge` if nothing else uses it. Keep every file under 400 lines, and split `StickersPage.tsx` into `apps/web/src/components/sticker/StickerTabs.tsx` if needed.

### Not in scope
- the phone;
- the server;
- the pack link page;
- New pack;
- `PackMenu`'s items.

### Tests
None (UI, CLAUDE.md Hard rules).

### Allowed files
- `apps/web/src/routes/StickersPage.tsx`
- `apps/web/src/components/sticker/PackRows.tsx`
- `apps/web/src/components/sticker/PackThumbs.tsx`
- `apps/web/src/components/sticker/pageActions.ts`
- `apps/web/src/components/sticker/StickerTabs.tsx` (new, only if needed)
- `work/T-1523-web-stickers-tabs.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `/settings/stickers?mock=1` at 1280 and 390 px:
  - the header keys and the three tabs;
  - My packs rows with a grip, 4 thumbs, name and globe icon, and ⋮; dragging (or keyboard on the grip) reorders and the order stays after a reload of the mock;
  - Discover finds packs as you type, with Add or a green check;
  - Favorites as before.
- No word badges, no horizontal scroll, 0 page errors.

---

## Report (written by the worker when done)

### What I did
- **Header** (`StickersPage.tsx`): dropped the subtitle; the `SettingsShell` `action` slot now holds "Import from Telegram" (outline `Button` + `Upload`) and "New pack" (primary `Button` + `Plus`, opening today's create flow); removed the old in-section buttons.
- **Tabs:** a `SegmentedControl` (`mode="tabs"`, aria-label "Sticker sections") with My packs · Discover · Favorites under the header. Only the chosen tab renders; My packs is the default.
- **My packs tab:** one rounded list card (`overflow-hidden rounded-xl border border-border bg-surface`, rows divided by `border-b border-divider`) inside a `SortableList`. Each row is a `SortableItem` with a `SortableHandle` grip (label `Drag <name> to reorder`), four 36 px `PackThumbs`, the name (14 px, 600) linking to `/stickers/<id>` with a `Globe` (`aria-label="Shared"`) when `visibility === 'server'`, the meta "N stickers" (13 px, muted) and `PackMenu`. Removed the Move up/down keys, the word badge and "Imported from Telegram"; the empty text stays.
- **Reorder:** new `dragPack(ordered, activeId, overId, setters)` in `pageActions.ts` removes the active pack and inserts it at the over pack's index in the whole panel list, then calls `reorderPanel`. `movePack` and `MoveRequest` are gone (nothing else used them), and the now-dead `loadDiscover` export was removed too.
- **Added:** an uppercase "Added" label and the same list card without a grip; a `CircleMinus` `IconButton` (label `Remove <name> from panel`) replaces the "Remove" word button.
- **Discover tab:** a `SearchField` ("Search shared packs") that searches as you type, debounced 300 ms (`useQuery` + `Effect.sleep`, so a new keystroke interrupts the wait or the search in flight) with no submit button; rows use the same list card; the action is a primary "Add" (`Plus`) or, when the pack is in the panel, a `IconButton` with a green `Check` (label `<name> is in your panel. Remove`).
- **Favorites tab:** unchanged.
- `PackThumbs` gained an optional `size` (default 56; rows pass 36 with radius 8) and now returns four thumbs; the unused `VisibilityBadge` was deleted. Every changed file stays under 400 lines, so no `StickerTabs.tsx` was needed (page is 327 lines).

Files changed: `apps/web/src/routes/StickersPage.tsx`, `apps/web/src/components/sticker/PackRows.tsx`, `apps/web/src/components/sticker/PackThumbs.tsx`, `apps/web/src/components/sticker/pageActions.ts`, `work/T-1523-web-stickers-tabs.md`.

### Checks run
- `pnpm gate` (repo root) — real output:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (2.4s)
PASS  format  (1.7s)
PASS  lint  (1.3s)
PASS  typecheck  (5.6s)
PASS  effect  (1.0s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- Single tests: none run — the task says none (UI, CLAUDE.md hard rules), and no test file is near the change. The gate reported `SKIP tests @zilar/web (no nearby test files)`.
- The first `pnpm gate` failed on `format` for `PackRows.tsx` and `StickersPage.tsx`; I fixed it with a targeted `pnpm exec prettier --write` on those two files and re-ran the gate, which passed.

### Notes for the lead
1. **`@handle` in the Added and Discover metas could not be built in scope.** The spec's fact "`StickerPack` has `ownerHandle`" is not true of the list rows: `ownerHandle` lives on `StickerPackDetail` only (`packages/api-contract/src/stickers.ts:117` is inside `StickerPackDetail`), and it is returned only by `GET /sticker-packs/:id` (real server `pack-link.ts`, mock `handlePackLink`). Both the panel list and `/sticker-packs/discover` return plain `StickerPack` rows with no handle. Rendering `· @handle` would need the contract, the server and `packages/mock-backend` — all outside this task's Allowed files. I followed the rule as written ("when `ownerHandle` is set") and left the meta as "N stickers"; the rows are one small change away from appending `· @handle` once the list/discover payloads carry it. Please decide: add `ownerHandle` to the list/discover responses in a follow-up, or drop it from this design.
2. **Header keys at 390 px.** With both full labels the fixed `SettingsShell` header overflows 390 px (title + two labelled keys). Since `SettingsShell` is not in the Allowed files I could not let the header wrap, so below the `sm` breakpoint (640 px) each key renders icon-only and keeps its `aria-label`; the full text shows at ≥640 px. If you'd rather keep the visible labels at 390 px, the shell needs a change (wrap, or a narrower action slot).
3. **Discover row for your own pack.** `WebDiscover.dc.html` shows no action on your own pack's row, but step 4 says any pack in your panel gets the green check. I followed the spec (your own shared pack shows the check, which removes it from your panel), matching the pack-link page's in-panel state.
4. Not checked on screen: I did not run a dev server (no daemons allowed) and no browser smoke; the acceptance (1280 / 390, drag persistence, no horizontal scroll) still needs Julio's/live check.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 1 nit and 1 follow-up, for head `eff7e8597`.
- **Headless check (mock, dark, 1280 and 390 px):**
  - the header holds Import from Telegram and New pack (icon keys at 390);
  - the tabs read My packs · Discover · Favorites;
  - the rows have a grip, four 36 px thumbs, the name with a globe icon, "6 stickers" and ⋮;
  - keyboard reorder on the grip moved Cats below Moods;
  - Discover searches as you type ("cat" finds Cats, with the green check);
  - Favorites shows its empty text;
  - no horizontal scroll, 0 page errors.
- **Follow-ups (one later task):**
  - the panel and Discover payloads lack `ownerHandle`, so Added and Discover rows show no "· @handle";
  - the empty texts still say "Create pack", but the key is now "New pack".

