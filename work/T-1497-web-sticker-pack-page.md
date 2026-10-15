---
id: T-1497
title: "Web sticker pack link page (approved Stickers canvas): /stickers/:packId shows a pack with Share, Copy link and Add; pack names open it; my pack rows get a ⋮ menu with Share (copy link) first"
status: merged
milestone: M5
branch: task/T-1497-web-sticker-pack-page
model: auto
effort: default
depends_on: [T-1495]
estimate: 0.5 day
---

# T-1497: Web sticker pack link page

## Spec (written by Claude, do not edit)

### Why
Julio approved the Stickers canvas on 2026-10-15. Every pack has a link, `https://chat.zilar.app/stickers/<packId>`; anyone signed in who has it can open the pack and add it. T-1495 added the server route.

Read `docs/design/mockups/stickers/README.md`, then the two boards:
- `WebPack.dc.html`: the link page;
- `Main.dc.html`: My packs, with its ⋮ menu.

Copy their sizes and order. This is D24 only (`docs/design/ui-style.md`).

### Facts (the lead read them on main, 2026-10-15)
- **The contract,** `packages/api-contract/src/stickers.ts`, after T-1495:
  - `getPack` answers `GET /sticker-packs/:id` with `StickerPackDetail` (a `StickerPack` plus `ownerHandle: string | null` and `inPanel: boolean`);
  - it answers 404 for an unknown id and for someone else's imported pack.
  - The mock has the same route (`packages/mock-backend/src/domains/stickers/routes.ts`).
- **The web client,** `apps/web/src/lib/api/stickers.ts` (252 lines):
  - `listStickerPacks` (`:33`), `addStickerPanelPack` (`:63`), `removeStickerPanelPack` (`:67`);
  - the `toStickerPack` mapper (`:29-31`);
  - calls go through `callApi((client) => client.stickers.<name>(…))`.
- **Routes,** `apps/web/src/routes/AppRoutes.tsx` (332 lines):
  - `/settings/stickers` is wrapped in `RequireAuth` (`:197-204`);
  - `RequireAuth` (`:68-…`) sends a guest to `/login` with `state.from`, so a link opened signed out comes back after login.
- **The Stickers page,** `apps/web/src/routes/StickersPage.tsx` (319 lines), renders `MyPackRow`, `AddedPackRow` and `DiscoverPackRow` from `apps/web/src/components/sticker/PackRows.tsx` (184 lines).
- **`MyPackRow` today** shows inline Up/Down keys, then a visibility key labelled "Share" or "Make private" (`:41-54`), then Edit, Remove from panel and Delete (`:72-115`).
  - Imported packs keep that key disabled with the reason "Imported packs stay private for personal use" (`:41`, `:95-101`).
- **`PackRowShell`** (`:120-133`) draws the thumbnails, title and count for the Added and Discover rows. `DiscoverPackRow` shows Add or Remove (`:150-184`).
- **Kit:**
  - `apps/web/src/components/ui/menu.tsx` (`Menu` with a `trigger`, `MenuItem` with `icon` and `destructive`), as used in `apps/web/src/components/topic/StatusMenu.tsx`;
  - `IconButton` (36 px, 10 px radius), `Well`, `StateMessage`;
  - `useToast()` (`apps/web/src/components/ui/toast.tsx:66`) returns `show(text)`;
  - `copyText(text)` (`apps/web/src/lib/clipboard.ts:11`).
- **Sticker images:** `StickerThumb` (`apps/web/src/components/sticker/StickerThumb.tsx:12`) draws one sticker.

### What to build
1. **Client:** add `getStickerPack(packId)` to `apps/web/src/lib/api/stickers.ts`. It calls `client.stickers.getPack({ params: { id: packId } })` and maps `stickers` like `toStickerPack`.
2. **Route:** add `<Route path="/stickers/:packId" element={<RequireAuth><StickerPackPage /></RequireAuth>} />` in `AppRoutes.tsx`, next to `/settings/stickers`.
3. **New `apps/web/src/routes/StickerPackPage.tsx`,** at most 250 lines; put parts in `apps/web/src/components/sticker/` if needed. It follows `WebPack.dc.html`:
   - **Header:** a Back `IconButton` (history back, or `/settings/stickers` when there is no history), the pack title, then a Share `IconButton` ("Share <title>"), which copies the link and shows the toast "Link copied".
   - **Then:**
     - **Primary key:** Add when `!inPanel` (adds to the panel, then shows the in-panel state). When `inPanel`, an `IconButton` with a green check ("<title> is in your panel. Remove") removes it. Hide both for the viewer's own pack.
     - **The line** "<n> stickers · @<ownerHandle>", without the handle part when `ownerHandle` is null, plus the globe icon (aria-label "Shared") when `visibility === 'server'`.
     - **The link row:** a `Well` holding the link icon, the mono text `<host>/stickers/<packId>` (`window.location.host`, ellipsized) and a Copy `IconButton` ("Copy link") that copies `${window.location.origin}/stickers/${packId}`.
     - **The stickers** in a 7-column grid of `StickerThumb`s.
   - **States:** loading uses the kit's skeleton or `StateMessage`. A 404 shows `StateMessage` "This pack is not available" with the Back key.
4. **Pack names open the link page:** in `DiscoverPackRow`, `AddedPackRow` and `MyPackRow`, the title becomes a `Link` to `/stickers/<id>`.
5. **`MyPackRow` gets the ⋮ menu from `Main.dc.html`,** replacing the inline visibility, Edit, Remove from panel and Delete keys:
   - a `Menu` with an `IconButton` trigger ("<title> actions");
   - **Share** (copy the link, toast "Link copied");
   - **Edit**;
   - **Make private** when shared, or **Make shared** when private. Imported packs show no visibility item;
   - **Remove from panel**;
   - **Delete** (destructive; it runs today's delete flow unchanged).
   - The Up/Down keys stay as they are (drag comes later).
6. **Every file stays at most 400 lines.** No new tests (UI).

### Allowed files
- `apps/web/src/lib/api/stickers.ts`
- `apps/web/src/routes/AppRoutes.tsx`
- `apps/web/src/routes/StickerPackPage.tsx`
- `apps/web/src/routes/StickersPage.tsx`
- `apps/web/src/components/sticker/PackRows.tsx`
- `apps/web/src/components/sticker/PackMenu.tsx`
- `apps/web/src/components/sticker/PackLinkRow.tsx`
- `apps/web/src/components/sticker/pageActions.ts`
- `work/T-1497-web-sticker-pack-page.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Lead, headless web `?mock=1` at 1280 and 390 px:**
  - on Settings › Stickers › Discover, a pack name opens `/stickers/<id>` and the page matches `WebPack.dc.html`;
  - Add switches to the green check, and the pack shows under Added;
  - Copy link and Share both show "Link copied";
  - an unknown id shows "This pack is not available";
  - My packs' ⋮ menu shows Share, Edit, Make private or Make shared, Remove from panel and Delete, and an imported pack has no visibility item.
- No console errors.

---

## Report (written by the worker when done)

### What I did

Followed `WebPack.dc.html` and `Main.dc.html` and the spec.

- **Client:** `apps/web/src/lib/api/stickers.ts` gained the web `StickerPackDetail`
  type and `getStickerPack(packId)`, which calls
  `client.stickers.getPack({ params: { id: packId } })` and copies `stickers`
  like `toStickerPack`.
- **Route:** `apps/web/src/routes/AppRoutes.tsx` gained a lazy
  `StickerPackPage` and
  `<Route path="/stickers/:packId" element={<RequireAuth><StickerPackPage /></RequireAuth>} />`
  next to `/settings/stickers`, so a link opened signed out returns after login.
- **New `apps/web/src/routes/StickerPackPage.tsx`** (202 lines): a
  Back `IconButton` (history back, or `/settings/stickers` with no history), the
  pack title, a Share `IconButton` (`Share <title>`) and the primary key (Add,
  or a green-check `IconButton` labelled `<title> is in your panel. Remove`);
  the `<n> stickers · @<handle>` line with the `Shared` globe when
  `visibility === 'server'`; the `PackLinkRow`; and a 7-column grid of
  `StickerThumb`s. Loading shows `StateMessage`; a 404 shows "This pack is not
  available" with a Back action; other failures show Retry. Both keys are hidden
  for the viewer's own pack.
- **`apps/web/src/components/sticker/PackLinkRow.tsx`** (new): the `Well` with
  the link icon, the mono `host/stickers/<packId>` text and the Copy
  `IconButton`; copying shows "Link copied".
- **`apps/web/src/components/sticker/PackMenu.tsx`** (new): the ⋮ `Menu` on a
  pack I own: Share, Edit, Make private / Make shared (no item for an imported
  pack), Remove from panel and Delete (destructive; still runs the page's
  existing confirm dialog). Share and Copy go through an Effect.
- **`apps/web/src/components/sticker/PackRows.tsx`:** `MyPackRow` keeps its
  Up/Down keys and now ends in `PackMenu`; its inline visibility/Edit/Remove/
  Delete keys are gone. The title in `MyPackRow`, `AddedPackRow` and
  `DiscoverPackRow` (`PackRowShell`) is a `Link` to `/stickers/<id>`.
- **`apps/web/src/components/sticker/pageActions.ts`:** added
  `stickerPackUrl` / `stickerPackUrlText` and the `loadPackDetail`,
  `addPackToPanel`, `removePackFromPanel` effects the page uses.

### Checks run

- `pnpm install` — done (pnpm v10.32.1).
- Fixed one lint failure (`react(set-state-in-effect)`) by deriving the in-panel
  state from an override that records its `packId`, and two Effect-ratchet
  failures by routing the clipboard calls through `useAction` + `Effect.tryPromise`.
- `pnpm gate` from the repo root (final run):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.7s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/web  (4.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No standalone test files were run: the change is UI only, the spec says no new
  tests, and no existing test touches `PackRows` / the sticker pages (the only
  sticker test, `store/realStore.send.test.tsx`, is untouched; its package ran
  inside the gate).

### Notes for the lead

- **Where Add sits:** the spec lists the header as Back + title + Share and puts
  the "Primary key" under "Then", while `WebPack.dc.html` puts Add in the header
  to the right of Share. Because Acceptance says the page must match
  `WebPack.dc.html`, I put Add (and its green-check in-panel replacement) in the
  header. Say the word and I'll move it into the body above the meta line.
- `getStickerPack` and `StickerPackDetail` are exported from
  `lib/api/stickers.ts` but **not** re-exported by the `lib/api` barrel, because
  `apps/web/src/lib/api.ts` is not in this task's Allowed files. `pageActions.ts`
  and `StickerPackPage.tsx` import them from `@/lib/api/stickers` directly — the
  same submodule import other files already use (`@/lib/api/media`, …). If you
  want them on the barrel, that needs a one-line edit outside scope.
- The pack page uses the mock's 64 px header, 640 px centered column and
  7-column `rounded-2xl` grid; stickers render with `[&_img]:h-full w-full`-style
  sizing so the grid stays square at 390 px without measuring.
- No new tests (UI), per the spec. No console-error smoke was run by me — the
  lead's headless pass covers it.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** the packet was clean (3 cosmetic nits) for head `446a3972b`.
- **Headless web `?mock=1` (vite from this worktree):**
  - **My packs:** each pack has a ⋮ key whose menu reads Share, Edit, Make private, Remove from panel, Delete. Share copies `http://localhost:5317/stickers/11111111-…` and shows "Link copied".
  - **Pack names** link to `/stickers/<id>` (4 links: My packs plus Discover).
  - **The link page for Cats** matches `WebPack.dc.html`: Back, the title, Share; "6 stickers" with the globe icon; the mono link row with Copy; the sticker grid. Copy link and Share both show "Link copied". Add is hidden on your own pack, as specced.
  - **An unknown id** shows "This pack is not available".
  - At 390 px there is no horizontal overflow, and no console errors.
- **Not testable in the mock:** Add and the in-panel check, because the mock seeds no pack owned by someone else. The server side was tested in T-1495.
- **Nits left as they are:** the shown link text is not URL-encoded (ids are UUIDs); a refused clipboard gives no feedback; an empty id makes one 404 request.

