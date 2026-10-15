---
id: T-1557
title: "Phone stickers polish (approved Stickers canvas; follow-ups of T-1533/T-1548): SettingsScreenShell gains a large-title mode (keys row, then a 28 px title) used by Stickers and New/Edit pack; the pack editor's visibility becomes a Private/Shared segmented switch; Discover rows use the lean list with '· @handle' and Add/remove icon keys; drop the dead formatPreparedSize"
status: merged
milestone: M5
branch: task/T-1557-mobile-stickers-polish
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1557: Phone stickers polish

## Spec (written by Claude, do not edit)

### Why
The approved boards (`docs/design/mockups/stickers/Phone.dc.html`, `PhoneNewPack.dc.html`) show:
- a keys row (Back left, the action key right), then a large 28 px title ("Stickers", "New pack");
- a Private/Shared segmented switch (`role="radiogroup"`) in the pack editor;
- lean pack rows everywhere.

T-1533 and T-1548 left three follow-ups:
- the shell's title is 20 px inline;
- the editor shows two tall visibility cards with hint text;
- Discover rows still use word buttons ("Add", "Remove").

**No status words, no hint paragraphs.**

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/components/settings/screen-shell.tsx` (65 lines):**
  - props `title`, `subtitle?`, `onBack?`, `right?`, `children`;
  - the header row is Back, then a 20 px title and subtitle, then `right` (`:31-50`);
  - 8 screens use it.
- **The large title elsewhere:** `apps/mobile/src/components/machines/machines-header.tsx:33` draws it as `text-[28px] font-semibold leading-8` under the keys.
- **`apps/mobile/src/app/settings/stickers.tsx`** uses the shell with the New pack key in `right` (T-1533).
- **`apps/mobile/src/app/settings/sticker-pack.tsx`:** `title` is "New pack" or "Edit pack", and the subtitle is "Name it, pick images, save." or the pack title (`:46-55`).
- **`apps/mobile/src/components/stickers/pack-visibility-field.tsx` (94 lines):**
  - "Who can find this pack" plus two `VisibilityOption` cards with descriptions (`:55-94`);
  - the props `value`, `disabled`, `imported` and `onChange`;
  - an imported-pack note.
- **`SegmentedControl`** is in `apps/mobile/src/components/ui/segmented-control.tsx` (`options`, `value`, `onChange`).
- **`apps/mobile/src/components/stickers/discover-tab.tsx` (124 lines):** rows are `PackCard` with `action` = an outline "Remove" or a default "Add" / "Adding…" `Button` (`:84-118`).
- **`pack-card.tsx`** already renders the lean row (4 thumbs, name, globe, meta) and `ownerHandle` when set (T-1533, T-1531).
- **`formatPreparedSize`** (`apps/mobile/src/components/stickers/pack-editor.ts:104`) has no users.

### Steps
1. **`screen-shell.tsx`:** add an optional `largeTitle?: boolean`.
   - When true, the header row holds only Back (left) and `right` (right), and the title renders under it in the scroll content as `text-[28px] font-semibold leading-8 mb-4`, with no subtitle.
   - When false, nothing changes for the other screens.
2. **`stickers.tsx`:** use `largeTitle`.
3. **`sticker-pack.tsx`:** use `largeTitle`, with title "New pack" or "Edit pack" and no subtitle.
4. **`pack-visibility-field.tsx`:**
   - replace the two cards with a `SegmentedControl` of **Private** (`Lock`) and **Shared** (`Globe`), `accessibilityLabel` "Who can find this pack";
   - keep `disabled`;
   - keep the imported note as one short muted line;
   - remove the per-option descriptions and the heading.
5. **`discover-tab.tsx`:**
   - rows go in the same rounded list as My packs;
   - **a pack not in your panel:** a `Plus` `IconButton` (`accessibilityLabel` "Add <name>"; a spinner while adding);
   - **a pack already added:** a `Check` icon plus a `CircleMinus` `IconButton` ("Remove <name> from panel");
   - the meta shows "N stickers · @handle" when `ownerHandle` is set;
   - pressing a row opens `/stickers/<id>`.
6. **Delete `formatPreparedSize`** from `pack-editor.ts`, along with any import that becomes unused.
7. **Every file stays under 400 lines.**

### Not in scope
- web;
- the server;
- other settings screens (they keep the current shell).

### Tests
None (UI).

### Allowed files
- `apps/mobile/src/components/settings/screen-shell.tsx`
- `apps/mobile/src/app/settings/stickers.tsx`
- `apps/mobile/src/app/settings/sticker-pack.tsx`
- `apps/mobile/src/components/stickers/pack-visibility-field.tsx`
- `apps/mobile/src/components/stickers/discover-tab.tsx`
- `apps/mobile/src/components/stickers/pack-editor.ts`
- `work/T-1557-mobile-stickers-polish.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Phone mock `/settings/stickers`:** Back and + keys, then a 28 px "Stickers".
- **`/settings/sticker-pack?id=11111111-1111-4111-8111-111111111111`:** Back, a 28 px "Edit pack", the name field, a Private/Shared switch with Shared on, then the grid.
- **Discover rows** have icon keys only.

---

## Report (written by the worker when done)

### What I did

- **`screen-shell.tsx`:** added an optional `largeTitle?: boolean`. When set, the key row keeps only Back (left) and `right` (right, `justify-between`), the inline 20 px title/subtitle View is skipped, and the title renders at the top of the scroll content as `text-[28px] font-semibold leading-8 mb-4 text-foreground`. When false nothing changes for the other 8 screens.
- **`stickers.tsx`:** passed `largeTitle`; wired the new `onOpenPackLink` prop of `DiscoverTab` to `router.push('/stickers/[packId]')`.
- **`sticker-pack.tsx`:** passed `largeTitle`, removed the `subtitle` prop (title is "New pack" or "Edit pack"). The name field, switch and grid are unchanged.
- **`pack-visibility-field.tsx`:** replaced the heading plus two `VisibilityOption` cards with a `SegmentedControl` (`mode="radio"`, `accessibilityLabel="Who can find this pack"`, options Private/`Lock` and Shared/`Globe`, each carrying `disabled`). Kept `value`, `disabled`, `imported`, `onChange` and the one-line imported note. Removed the now-dead exported `VisibilityOption` and its unused imports.
- **`discover-tab.tsx`:** rows now sit in the same `overflow-hidden rounded-2xl border border-border bg-surface` list as My packs (`inList`, divider between rows). Not-added rows: a `Plus` `IconButton` labelled `Add <name>`, with an `ActivityIndicator` while `busyId` matches. Added rows: a green (`SEEN`) `Check` plus a `CircleMinus` `IconButton` labelled `Remove <name> from panel`. Rows open `/stickers/<id>` via the new `onOpenPackLink` prop. `PackCard` already renders `N stickers · @handle` when `ownerHandle` is set. Removed the unused `Button` import.
- **`pack-editor.ts`:** deleted the dead `formatPreparedSize` helper; no import became unused.

All 6 source files stay under 400 lines (gate size check passed).

### Checks run

- `pnpm install` — Done (1 deprecated subdependency warning; one unmet peer `@types/react` under `apps/mobile`, pre-existing).
- `pnpm gate` from the repo root (final run):
  - `PASS install (frozen) (3.4s)`
  - `PASS format (1.3s)`
  - `PASS lint (1.5s)`
  - `PASS typecheck (7.2s)`
  - `PASS effect (1.9s)`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- Single tests: none run — no test file imports any of the six changed files (UI only; the spec says no tests).
- One intermediate `pnpm gate` failed on `format` (the rewritten `screen-shell.tsx`). Fixed by running `prettier --write` on that one file, then the gate passed. No checks were disabled.

### Notes for the lead

- The `VisibilityOption` export in `pack-visibility-field.tsx` was only used inside that file (grep confirmed), so it was removed with the cards as dead code. If anything outside `apps/mobile/src` needs it, that would be a revision.
- `DiscoverTab` gained a required `onOpenPackLink` prop; its only caller is `stickers.tsx`, updated here.
- `pack-card.tsx` still describes Discover as keeping "its own card" in its doc comment; Discover now uses the shared list. Touching that file was out of scope, so the comment is stale — flagging for the lead.
- `discover` is typed `StickerPack[]` in `use-stickers-panel.ts`/`stickers-api.ts`; `ownerHandle` is only carried at runtime by `toStickerPack`. `PackCard` reads it, so `· @handle` shows when present, but the prop type does not advertise it (out of scope to change).

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 2 follow-ups.
- **Phone smoke** (mock): PASS.
  - **`/settings/stickers`:** Back and + keys, then a 28 px "Stickers"; the Added row reads "Space cats · 8 stickers · @marta" with a remove key.
  - **`/settings/sticker-pack?id=…`:** Back, a 28 px "Edit pack", the name field, and Private/Shared with Shared on, then the grid.
- **Discover, read in code** (the smoke can't tap):
  - rows are `Pressable` "Open <name>";
  - **a pack not yet added:** a `Plus` icon key;
  - **an added pack:** `Check` plus a `CircleMinus` key, with no word buttons.
- `formatPreparedSize` no longer exists, and the other settings screens keep the old shell (`largeTitle` is optional).
- **The follow-ups** (the stale `pack-card.tsx` comment and `ownerHandle` missing from the `StickerPack` type) go into the next sticker type task (the MIME union).

