---
id: T-1531
title: "Sticker lists carry the owner's @handle (follow-up of T-1523): StickerPack gains an optional ownerHandle filled in the panel and Discover lists (one batched read) and the mock; web Added/Discover rows show 'N stickers · @handle'; the empty texts say 'New pack'"
status: merged
milestone: M5
branch: task/T-1531-sticker-owner-handle
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1531: Sticker lists carry the owner's @handle

## Spec (written by Claude, do not edit)

### Why
The approved Stickers boards (`docs/design/mockups/stickers/Main.dc.html`, `WebDiscover.dc.html`) show other people's packs as "8 stickers · @marta". Only the pack link route returns `ownerHandle` today, so T-1523's Added and Discover rows show the count alone. The lead's review of T-1523 also found that the empty texts still say "Create pack", but the key is now "New pack".

### Facts (the lead read them on main, 2026-10-15)
- **Contract:** `StickerPack` has no `ownerHandle` (`packages/api-contract/src/stickers.ts:98-108`); `StickerPackDetail` adds `ownerHandle: Schema.NullOr(Schema.String)` (`:115-119`).
- **Server:**
  - the panel list is `listPanelPacks` (`apps/server/src/stickers/packs.ts:28-`), and Discover is `discoverPacks` (`:242-295`), whose views are built with `toPackView` (`apps/server/src/stickers/storage.ts:164`);
  - the link route reads the handle with `SELECT handle FROM handles WHERE user_id = … LIMIT 1` (`apps/server/src/stickers/pack-link.ts:23-27`, `:39`).
- **Mock:** `packages/mock-backend/src/domains/stickers/routes.ts` has `ownerHandle(data, ownerId)` (`:121`), used only for the detail (`:110`).
- **Web:**
  - `toStickerPack` spreads the contract pack (`apps/web/src/lib/api/stickers.ts:28-32`);
  - `PackRows.tsx` renders `meta={countLabel(pack)}` for mine (`:82`), Added (`:96`) and Discover (`:119`);
  - `StickersPage.tsx` says "Create pack" in the two empty texts (`:207`, `:262`).

### Steps
1. **Contract:** `StickerPack` gains `ownerHandle: Schema.optional(Schema.NullOr(Schema.String))` (optional, so older servers still decode). `StickerPackDetail` keeps its required field: keep it valid by overriding it there.
2. **Server:** `listPanelPacks` and `discoverPacks` add `ownerHandle` to each view, with one `SELECT user_id, handle FROM handles WHERE user_id IN (…)` per call for the owners on that page. A missing handle is `null`.
3. **Mock:** the panel list and Discover responses add `ownerHandle` through the existing helper.
4. **Web `PackRows.tsx`:** the Added and Discover rows show "N stickers · @handle" when `ownerHandle` is set; your own packs keep "N stickers".
5. **Web `StickersPage.tsx`:** "Create pack" becomes "New pack" in both empty texts.

### Not in scope
- the phone (its My packs task will use the field);
- the link page.

### Tests
None new. Keep the stickers tests passing; update any server or mock test that compares a whole list payload.

### Allowed files
- `packages/api-contract/src/stickers.ts`
- `apps/server/src/stickers/packs.ts`
- `apps/server/src/stickers/schemas.ts`
- `packages/mock-backend/src/domains/stickers/routes.ts`
- `packages/mock-backend/src/domains/stickers/packs.ts`
- `packages/mock-backend/src/domains/stickers/owner-handle.ts`
- `packages/mock-backend/src/domains/stickers/seed.ts`
- `apps/web/src/components/sticker/PackRows.tsx`
- `apps/web/src/routes/StickersPage.tsx`
- any existing `*.test.ts` under `apps/server/src/stickers/` or `packages/mock-backend/src/domains/stickers/` that compares whole list payloads
- `work/T-1531-sticker-owner-handle.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In the web mock, a pack someone else owns shows "N stickers · @handle" under Added and in Discover.
- The empty texts say "New pack".
- `/api/sticker-packs` and Discover still answer 401 signed out.
- Every file stays under 400 lines.

---

## Report (written by the worker when done)

### What I did
All five steps are done (the block was resolved: you added the mock files and allowed
the `schemas.ts` typing change).

- **Step 1, contract** (`packages/api-contract/src/stickers.ts`): `StickerPack` gains
  `ownerHandle: Schema.optional(Schema.NullOr(Schema.String))`. `StickerPackDetail`
  keeps its required `ownerHandle` (the spread's optional field is overridden by the
  explicit required one), so the detail stays valid and older servers still decode.
- **Step 2, server** (`apps/server/src/stickers/packs.ts`, `schemas.ts`):
  `StickerPackView` gains `ownerHandle?: string | null` (your typing note, so the field
  is declared rather than spread through an anonymous type). Added `loadOwnerHandles`,
  which reads `SELECT user_id, handle FROM handles WHERE user_id IN (…)` once per call,
  and merged `ownerHandle` into the views of `listPanelPacks` and `discoverPacks`; a
  missing handle is `null`. `toPackView` (storage.ts) is unchanged, so the pack-link
  detail is unaffected.
- **Step 3, mock**:
  - moved `ownerHandle(data, ownerId)` into a new shared module
    `packages/mock-backend/src/domains/stickers/owner-handle.ts`; `routes.ts` (pack
    link) and `packs.ts` (panel list, Discover) both import it;
  - `packs.ts` panel list (`GET /sticker-packs`) and Discover (`GET /sticker-packs/discover`)
    now return `ownerHandle` per pack;
  - `seed.ts`: added a third shared pack, "Space cats" (8 stickers, `visibility: 'server'`,
    same `pack` helper and art-tile style as Cats/Moods), owned by `u-marta`, placed after
    Cats and Moods in the panel.
- **Step 4, web rows** (`apps/web/src/components/sticker/PackRows.tsx`): the Added and
  Discover rows use `ownerCountLabel`, which renders `N stickers · @handle` when
  `ownerHandle` is set and the count alone otherwise; My packs keep `countLabel`.
- **Step 5, web empty texts** (`apps/web/src/routes/StickersPage.tsx`): "Create pack"
  became "New pack" in both empty texts.

Mock evidence (one-off `tsx -e`, read-only):
`panel` → `[["Cats",null],["Moods",null],["Space cats","marta"]]`,
`discover` → `[["Cats",null],["Moods",null],["Space cats","marta"]]`.
Space cats is owned by `u-marta` (≠ the viewer), so in the web mock the Added row and
the Discover row both show "8 stickers · @marta".

### Checks run
- `pnpm gate` from the repo root: **GATE PASS** (10 changed files). Summary lines:
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`, `PASS  effect`
  - `SKIP tests @zilar/api-contract (no nearby test files)`
  - `SKIP tests @zilar/mock-backend (no nearby test files)`
  - `PASS  tests @zilar/server`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
- Mock runtime check as above (the one-off command, no file added).
- No single test file was run on its own and no test was changed: no server or mock test
  compares a whole sticker-list payload, and the mock has no sticker tests.

### Notes for the lead
- Allowed files updated in this task file: added `apps/server/src/stickers/schemas.ts`
  and `packages/mock-backend/src/domains/stickers/{packs.ts,owner-handle.ts,seed.ts}`.
- Marta already has handle `marta` in `packages/mock-backend/src/data/people.ts` (T-1520),
  so no change was needed there.
- `/api/sticker-packs` and Discover keep their routes, handlers and auth unchanged; the
  401-signed-out behaviour was not touched (not re-tested here).
- Backward compatibility: `ownerHandle` is optional on `StickerPack` and required on
  `StickerPackDetail`, so an older server's reply still decodes.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean (no findings).
- **The worker blocked once** because the mock lists and seed were outside the Allowed files. The lead allowed `stickers/packs.ts`, `seed.ts`, the new `owner-handle.ts` and `apps/server/src/stickers/schemas.ts`.
- **Headless web mock** (1280 and 390 px):
  - My packs shows Cats and Moods with "6 stickers" and no handle;
  - the Added section shows "Space cats · 8 stickers · @marta";
  - Discover ("cat") shows Cats with no handle and "Space cats · 8 stickers · @marta";
  - drag reorder still works;
  - no horizontal scroll, 0 page errors.
- **Copy:** both empty texts now say "New pack" (checked in the diff).
- **Server:** one batched `handles` read per page. A missing handle is `null`, and the field is optional on `StickerPack`, so older clients and servers still decode.
