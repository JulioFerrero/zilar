---
id: T-0187
title: Mobile: manage sticker packs (my packs, discover, add and remove, reorder, favourites)
status: planned
milestone: M5
branch: task/T-0187-mobile-sticker-packs
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 1 day
---

# T-0187: Mobile: manage sticker packs (my packs, discover, add and remove, reorder, favourites)

## Spec (written by Claude, do not edit)

### Why
The phone can send stickers but cannot manage them: no way to add a pack, remove one, reorder them or keep favourites. Web has a Stickers settings page. Julio, 2026-10-03: "implement all the features we have in web into the mobile app". Roadmap: `docs/ROADMAP_MOBILE_PARITY.md`.

### Verified facts (do not re-derive)
- Web: `apps/web/src/routes/StickersPage.tsx` (656 lines; mirror the list, discover, add, remove, reorder and favourites parts; the pack editor and the Telegram import are a later task, T-0191), client functions in `apps/web/src/lib/api.ts`: `listStickerPacks()` (~1368), `discoverStickerPacks(...)` (~1383), `addStickerPanelPack(id)` (~1394), `removeStickerPanelPack(id)` (~1400), `reorderStickerPanelPacks(order)` (~1497), `listStickerFavorites()` (~1589), `addStickerFavorite(id)`, `removeStickerFavorite(id)` (~1593-1601).
- Server: `apps/server/src/stickers/` (routes and service).
- Mobile: `apps/mobile/src/lib/stickers-api.ts` already has what the panel needs (read it, extend it, keep its tests green), `components/chat/sticker-panel.tsx` shows the panels the user has.
- Conventions (all mobile parity tasks): API module in `apps/mobile/src/lib/<area>-api.ts` mirroring the web client function names, validated at the boundary, with an error class carrying `status` and `code`; a hook that returns the real API or the mock (copy `use-ais-api.ts`); screens under `apps/mobile/src/app/`, guarded by `RequireAuth`; components under `apps/mobile/src/components/<area>/`; lucide icons, no emoji; every list has loading, empty and error states; error text shown to the user is always a fixed plain sentence, never the server's raw message; no new dependency (`expo-image-picker`, `expo-document-picker`, `expo-clipboard`, `zod` are already installed); never log tokens, codes, keys or message text.
- Settings registry (checked 2026-10-04): `apps/mobile/src/lib/settings-items.ts` is one array `SETTINGS_ITEMS = [ ... ] as const satisfies readonly SettingsItemShape[]` (lines 23-66); each row is `{ id, title, subtitle, icon, href }`, and the icon and route types are derived from the rows, so you never edit a type there. Add your row as the LAST element INSIDE the array, before line 66. Every row's `icon` needs an entry in `HUB_ICONS` in `apps/mobile/src/app/settings/index.tsx` (line 39), or `pnpm typecheck` fails. There is no `ownerOnly` field.
- Sticker images: draw them like `StickerThumb` in `apps/mobile/src/components/chat/sticker-panel.tsx` (line 275): React Native `Image` with `source={stickerImageSource(sticker.url, API_URL, token)}` (from `@/lib/stickers`) and the session token from `getSessionToken()`; never a placeholder icon. A test that renders a component using `Image` must list `Image` in its `react-native` mock, as `components/chat/sticker-panel.test.tsx` line 10 does.

### What to build
1. Extend `apps/mobile/src/lib/stickers-api.ts` (+ tests) with the functions above that are missing.
2. `apps/mobile/src/app/settings/stickers.tsx`: 'My packs' list with Remove (confirm) and reorder (move up / move down buttons; no drag library), a Discover tab with search and Add, a Favourites section with remove; empty and error states. Follow the design brief `docs/design/briefs/T-0187-sticker-packs.md` exactly for layout, sizes, icons and copy (screen text spells it "Favorites", as web does). Row `{ id: 'stickers', title: 'Stickers', subtitle: 'Your packs, shared packs and favorites.', icon: 'stickers', href: '/settings/stickers' }` in `settings-items.ts`, and `stickers: Sticker` (lucide `Sticker`) in `HUB_ICONS`.
3. After a change the chat's sticker panel shows the new order and packs without an app restart (reload the panel's pack list when the settings screen closes).
4. Tests (Vitest): the API additions, the screen (list, add, remove, reorder, favourites, empty, error), the reorder payload is the complete id list in the new order.

### Read first
`AGENTS.md`, `docs/design/briefs/T-0187-sticker-packs.md` (the design brief: follow it), `docs/ROADMAP_MOBILE_PARITY.md`, `docs/design/ui-style.md`, `apps/mobile/src/lib/approvals-api.ts` and `apps/mobile/src/lib/ais-api.ts` (the API module pattern), `apps/mobile/src/components/ais/use-ais-api.ts` and `require-ais-auth.tsx` (the real-or-mock hook and the auth guard), `apps/mobile/src/app/ais/index.tsx` (a screen with header, list, empty and error states), `apps/mobile/src/lib/settings-items.ts` (add your row), plus the web files named above.

### Allowed files
`apps/mobile/src/lib/stickers-api.ts` and its test, `apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/components/stickers/**`, `apps/mobile/src/lib/settings-items.ts` (one row), `apps/mobile/src/app/settings/index.tsx` (one `HUB_ICONS` entry and its import), `apps/mobile/src/components/chat/sticker-panel.tsx` (only the reload hook-up), `work/T-0187-mobile-sticker-packs.md`.

### Checks
```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 stickers settings
pnpm gate
```
Say in the Report that the lead tests on the emulator and the phone.

### Acceptance
- Packs can be added, removed and reordered from Settings; favourites can be removed.
- The chat sticker panel reflects the change without restarting the app.
- No emoji in UI, no new dependency, no server change, no unrelated file touched.

### Out of scope
Creating or editing packs and uploading sticker files, the Telegram importer (T-0191).

---

## Report (written by the worker when done)

## Review (written by Claude)
