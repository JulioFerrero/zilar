---
id: T-1867
title: "Media cards W1 (web): draw the `images` block (1–4 tiles in a 2×2 grid, +N on the last tile, opens the full image) and the `file` block (file key, name, 'size · FORMAT · N rows' mono line, Download key) from /api/card-media/<id>, per WebContent.dc.html:84-135"
status: merged
milestone: M5
branch: task/T-1867-web-media-blocks
model: auto
effort: default
depends_on: [T-1853]
estimate: 40 min
---

# T-1867: Web renderers for the images and file blocks (media plan W1)

## Spec (written by Claude, do not edit)

### Why
**Julio took every recommendation of `docs/plan/message-blocks-media.md` (2026-10-17).**
- **Already merged:** the read route `GET /api/card-media/:id` (T-1853).
- **The schemas** already exist in `packages/protocol/src/blocks-content.ts`:
  - `images` (`:16-25`): `items` is 1–4 media ids, plus `extra?`;
  - `file` (`:74-84`): `media`, `name`, `size`, `format` and `rows?`.
- **Today `BlockCard` skips both kinds** (`apps/web/src/components/message/blocks/BlockCard.tsx:62-63`, `default: return null`).

### The board (match it)
**`docs/design/mockups/blocks/WebContent.dc.html`.**
- **24 · FILE (`:84-100`):** one row with a 12 px gap:
  1. the 40 px `tilekey` with the lucide `File` icon (18 px, `#d4d4d4`);
  2. a column with the name (weight 500), then a mono 11 px `#8a8a8a` line `12 KB · CSV · 31 rows`, i.e. `size · format · rows rows` with `rows` left out when absent;
  3. a 36 px square dark key, `aria-label="Download"`, with the lucide `Download` icon.
- **20 · IMAGES (`:122-135`):**
  - the card padding is `6px 6px 8px 6px`;
  - the grid is `repeat(2, minmax(0,1fr))` with a 4 px gap, and each tile is 120 px high;
  - the outer corners are 12 px, the inner 6 px (top-left tile `12 6 6 6`, top-right `6 12 6 6`, bottom-left `6 6 6 12`, bottom-right `6 6 12 6`);
  - when `extra > 0`, the last tile gets a centred `+N` (20 px, weight 500) over `rgba(0,0,0,.55)`;
  - **one image** spans the full width, 180 px high, with all corners 12 px (the plan, §3 "one image full width").

### Facts (read by the lead on 2026-10-17)
- **The content dispatch** is `apps/web/src/components/message/blocks/ContentBlocks.tsx` (25 lines, `place`/`weather`/`event`). `BlockCard.tsx` (211 lines) routes `place`/`weather`/`event` to `renderContentBlock` (`:58-61`).
- **The dark key style** is the `KEY` object in `apps/web/src/components/message/blocks/PlaceBlock.tsx:5-9`. Reuse the same values, and move them to a shared `blockKey.ts` if a second file needs them.
- **Same-origin `<img src="/api/card-media/<id>">`** is authenticated by the session cookie (the plan, §3 "Web"). The route sends files as attachments.

### Steps
1. **New `apps/web/src/components/message/blocks/ImagesBlock.tsx`:**
   - each tile is an `<a href={/api/card-media/${id}} target="_blank" rel="noopener noreferrer">` holding `<img loading="lazy" className="size-full object-cover" alt="">`;
   - the card title (or "Image") is the tile link's `aria-label`;
   - a tile whose image fails to load (`onError`) shows the board's `#181818` placeholder, so mock mode and a deleted file still look right.
2. **New `apps/web/src/components/message/blocks/FileBlock.tsx`:** the row above. The Download key is an `<a href={/api/card-media/${block.media}} download={block.name}>` styled as the key.
3. **`ContentBlocks.tsx`:** add `images` and `file` to the `Extract` type and the switch.
4. **`BlockCard.tsx`:**
   - add `case 'images': case 'file':` next to `place`/`weather`/`event`;
   - give a card whose only block is `images` the board's tight padding, the same way the lone-callout layout is special-cased. Read how that's done first, and keep the file at most 400 lines.
5. **`ContentBlocks.fixture.tsx`:** add an `images` sample (4 ids, `extra: 3`), a one-image sample and a `file` sample (`prices-october.csv`, `12 KB`, `CSV`, `31`). The images show the placeholder in Cosmos.
6. **No tests** (UI).

### Allowed files
- `apps/web/src/components/message/blocks/ImagesBlock.tsx`
- `apps/web/src/components/message/blocks/FileBlock.tsx`
- `apps/web/src/components/message/blocks/ContentBlocks.tsx`
- `apps/web/src/components/message/blocks/ContentBlocks.fixture.tsx`
- `apps/web/src/components/message/blocks/BlockCard.tsx`
- `apps/web/src/components/message/blocks/PlaceBlock.tsx`
- `apps/web/src/components/message/blocks/blockKey.ts`
- `work/T-1867-web-media-blocks.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **In Cosmos:**
  - the images card shows the 2×2 grid with the board's corners and the `+3` tile;
  - the one-image card is full width;
  - the file card shows the key, the name, `12 KB · CSV · 31 rows` and the Download key.
- **No other block changes.**
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`blockKey.ts` (new):** moved `PlaceBlock`'s dark `KEY` here as
  `BLOCK_KEY`, with the same values, so `FileBlock` can reuse it.
- **`PlaceBlock.tsx`:** now imports `BLOCK_KEY`; no visual change.
- **`ImagesBlock.tsx` (new):** `images` tiles drawn exactly like the board
  (`WebContent.dc.html:122-135`):
  - one image is full width, 180 px high, all corners 12 px;
  - 2–4 images use `grid-cols-2` with a 4 px gap and 120 px tiles;
  - corners are 12 px on the outside and 6 px inside, computed per tile
    position (4 tiles reproduce `12 6 6 6`, `6 12 6 6`, `6 6 6 12`,
    `6 6 12 6` exactly);
  - each tile is an `<a href="/api/card-media/<id>" target="_blank"
    rel="noopener noreferrer">` with `aria-label` = card title or `Image`,
    holding `<img loading="lazy" class="size-full object-cover" alt="">`;
  - a tile whose image fails (`onError`) keeps the `#181818` placeholder
    background, so Cosmos shows the board's placeholder;
  - `extra > 0` draws a centred `+N` (20 px, weight 500) over `bg-black/55`
    on the last tile.
- **`FileBlock.tsx` (new):** the board's one row (`:85-100`): 40 px raised
  tile with the lucide `File` (18 px, `#d4d4d4`), the name (weight 500), the
  mono 11 px `#8a8a8a` meta line `size · format · N rows` (rows omitted when
  absent), then a 36 px dark key with `aria-label="Download"` and the lucide
  `Download` (16 px), linked to `/api/card-media/<media>` with
  `download={name}`.
- **`ContentBlocks.tsx`:** `images` and `file` added to the `Extract` type and
  the switch; the dispatcher now accepts an optional `title` and passes it to
  `ImagesBlock` only.
- **`BlockCard.tsx`:** `images`/`file` routed to `renderContentBlock`;
  `renderBlock` threads `shown.title` to it; a headerless card whose only block
  is `images` gets the board's `6px 6px 8px 6px` padding (footer gets `pr-2`,
  matching the board's time offset). File is 224 lines.
- **`ContentBlocks.fixture.tsx`:** added 20 · IMAGES (4 ids, `extra: 3`),
  20 · IMAGES · one, and 24 · FILE (`prices-october.csv`, `12 KB`, `CSV`,
  `31`).
- No tests added: the spec says UI, and the gate confirms there are no nearby
  test files for `@zilar/web`.

### Checks run

- `pnpm install` — done, 19.2 s.
- `pnpm gate` (first run) — **GATE FAIL**: `format` flagged
  `FileBlock.tsx` only (`Code style issues found`); scope/migration/images/size
  all passed.
- `pnpm exec prettier --write apps/web/src/components/message/blocks/FileBlock.tsx`
  — fixed.
- `pnpm gate` (final) — **GATE PASS**, summary:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.6s)
  PASS  lint  (0.8s)
  PASS  typecheck  (4.3s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run (UI-only change, spec step 6).

### Notes for the lead

- **Cosmos was not opened by me.** AGENTS.md forbids starting a dev server or
  any background/detached process, so the visual acceptance is left to you. The
  markup and every value mirror the board lines named above; the gate's
  typecheck validates the new fixtures against `BlocksData`.
- The images tiles' `aria-label` needs the card title, so `renderContentBlock`
  and `renderBlock` gained an optional `title` parameter. With no card title
  the label is `Image` (the board's "Four photos" is a mock caption the payload
  does not carry).
- Only `PlaceBlock.tsx` was switched to `blockKey.ts`. `RatingBlock.tsx`,
  `choiceStyles.ts` and `ButtonsBlock.tsx` keep their own identical copies:
  they are outside the Allowed files and the spec says no other block changes.
- Not done, per spec: no gallery/swipe navigation between images and no
  per-image alt text (the payload has only ids).

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `559d59d11`.
- **The Cosmos check** (`ContentBlocks.fixture.tsx` "Content blocks", 1440 px) against `WebContent.dc.html:84-135`:
  - **images:** a 2×2 grid of 120 px tiles with 12/6 corners, the `+3` overlay on the last tile and the tight card padding;
  - **one image:** full width;
  - **file:** the 40 px file key, `prices-october.csv`, the mono `12 KB · CSV · 31 rows` line and the square Download key.
  - The placeholders show because Cosmos has no card media.
- **`BlockCard.tsx` is 224 lines.** The live render needs an AI card with real ids, which comes with M3b, M4 and G1.
