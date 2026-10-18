---
id: T-2097
title: "Share (web + phone): one stickers and GIFs API in client-core (make…Api(call) over the contract client, contract types) used by both apps — each app keeps its module names, only the transport differs"
status: merged
milestone: M5
branch: task/T-2097-api-stickers
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2097: One stickers and GIFs API for web and phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count must really go down, and web and phone share code. Both apps call the same contract endpoints through hand-written wrappers (phone `lib/*-api.ts` 4,037 lines, web `lib/api/*` 2,216). Both apps already have the derived contract client: `ZilarClient` in `packages/api-contract/src/client.ts`.

### The pattern to copy (already merged)
- `packages/client-core/src/topics-api.ts` and `packages/client-core/src/groups-api.ts`: `makeTopicsApi(call)` and `makeGroupsApi(call)` take
  ```ts
  call: <A>(f: (client: ZilarClient) => Effect<A, …>) => Promise<A>
  ```
  and return the Promise functions, with normalisation living once.
- **Web** (`apps/web/src/lib/api/topics.ts`): `const api = makeTopicsApi(callApi)`, then it exports the same function names as before.
- **Phone** (`apps/mobile/src/lib/topics-api.ts`): `makeTopicsApi((call) => runApi(call(client)))` inside its `create…Api(getToken, fetch, url)`.

### Facts (read by the lead on 2026-10-18 at `f9fdac014`)
- **Web:** `apps/web/src/lib/api/stickers.ts` (235 lines).
  - Stickers: `listStickerPacks` (`:33`), `getStickerPack`, `createStickerPack`, `discoverStickerPacks`, `addStickerPanelPack`, `removeStickerPanelPack`, `reorderStickerPanelPacks` (`:130`), `patchStickerPack`, `deleteStickerPack`, `deletePackSticker`, `uploadStickerFile`, `listStickerFavorites`, `addStickerFavorite`, `removeStickerFavorite` and `importTelegramStickers` (`:194`).
  - GIFs: `searchGifs` (`:216`), `trendingGifs` and `gifMediaUrl`.
  - The push calls (`:85-123`) stay where they are.
- **Phone:** `apps/mobile/src/lib/stickers-api.ts` (289; its own `parseStickerItem`/`parseStickerPack` at `:83-88` and `createStickersApi` at `:195`) and `apps/mobile/src/lib/gifs-api.ts` (108).
- **Uploads differ by platform.** Keep the app-specific upload body (web `Blob`, phone file URI) in each app if it cannot be shared, and share the rest.

### Steps
1. **The shared module.** Create `packages/client-core/src/stickers-api.ts` exporting `make…Api(call)`. It holds every call both apps make, plus any call only one app makes in this area, using contract types from `@zilar/api-contract` (`ZilarClient` and the row types).
2. **The barrel.** Add ONE line `export * from './<file>';` to `packages/client-core/src/index.ts` **directly after** the line `} from './atom-store';`, not at the end. Other tasks append elsewhere, so this keeps merges clean.
3. **Web.** The web module builds the API with `callApi` and keeps exporting the **same names**, so its importers do not change. Types it exported become aliases of the contract types.
4. **Phone.** Its `create…Api(getToken, fetchImpl, apiUrl)` keeps its signature and returns the shared object. Phone-only parsing and type copies of contract rows go; keep the exported type names as aliases.
5. **Users.** Users of both modules must compile unchanged. If one cannot, report BLOCKED with its path; the lead adds it.
6. **Tests.** No new tests. Existing tests of these modules must pass; adapt them only where a deleted hand-written parser was what they tested.
7. **Size.** Report the line counts. Product lines must go down by at least 150.

### Allowed files
- `packages/client-core/src/stickers-api.ts`
- `apps/web/src/lib/api/stickers.ts`
- `apps/mobile/src/lib/stickers-api.ts`
- `apps/mobile/src/lib/gifs-api.ts`
- `packages/client-core/src/index.ts`
- `work/T-2097-api-stickers.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 150 lower.
- **Lead check:** web mock: the sticker panel and GIF search in a chat, and `/settings/stickers`. Phone emulator: `/settings/stickers`.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/stickers-api.ts` with `makeStickersApi(call)` and
  `makeGifsApi(call, toItem)`, plus the shared row types (`Sticker`, `StickerPack`,
  `StickerPackDetail`, `PanelSticker`, `PanelPack`, `TelegramImportResult`, `GifPage<T>`,
  `StickerPackPage`, input types). Every sticker pack row is normalised once, with the
  mutable `stickers` array the editors take; GIF pages share the `pos`/`nextPos` handling.
- Added one barrel line to `packages/client-core/src/index.ts`, directly after the
  `} from './atom-store';` line.
- Web `apps/web/src/lib/api/stickers.ts`: builds the shared API with `callApi` and
  `callApiAbortable`, keeps every exported name (`GifPage` is `GifPage<GifResult>`), and
  turns the row types into aliases of the contract/shared ones. The push calls and the
  `Blob` upload stay in the module.
- Phone `apps/mobile/src/lib/stickers-api.ts`: `createStickersApi` keeps its
  `(getToken, fetchImpl, apiUrl, binaryUpload)` signature and returns the shared object plus
  the file-URI upload. The hand-written `parseStickerItem`/`parseStickerPack`, their
  dimension checks and the type copies are gone; `TelegramImportResult`, `PanelPack`,
  `StickerPack` and `StickerPackDetail` are aliases now.
- Phone `apps/mobile/src/lib/gifs-api.ts`: calls `makeGifsApi` over
  `runApiAbortable`; `GifPage` is `GifPage<GifItem>` and the media URL mapping stays in the
  app. `parseGifItem` is gone.
- No users needed changing; nothing outside the Allowed files was touched.

Line counts (old → new):

- `apps/web/src/lib/api/stickers.ts`: 235 → 122
- `apps/mobile/src/lib/stickers-api.ts`: 289 → 127
- `apps/mobile/src/lib/gifs-api.ts`: 108 → 62
- `packages/client-core/src/stickers-api.ts`: new → 156

Product lines: 632 → 467, a drop of 165 (target ≥ 150).

### Checks run

No single test file was run on its own; the final gate ran the package tests.

`pnpm gate` (from the repo root) ended:

```
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
PASS  build @zilar/server
PASS  tests @zilar/client-core
PASS  tests @zilar/mobile
PASS  tests @zilar/web
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

The first gate run failed at typecheck because the phone's own `StickerPack` (no
`createdAt`/`updatedAt`) was passed to a `PanelPack` typed as the full shared pack; the
shared `PanelPack` is now the panel projection (`PanelSticker = Omit<Sticker, 'bytes'>`)
and the gate passes. No user file needed changing.

### Notes for the lead

- `deletePackSticker` now returns `Promise<void>` (web previously returned `{ ok: boolean }`);
  no caller used the flag.
- Phone `createStickerPack`/`patchStickerPack` now trim the title like web did; phone
  `deleteStickerPack` and the favorites calls already had the same wire shape.
- Phone-only row validation (dimension ≤ 512, URL length, emoji slice) is removed per the
  spec: the contract's lenient decoders still drop schema-invalid rows.
- `gifMediaUrl` stays per app: web resolves against same-origin `API_BASE`, phone must
  resolve against the API origin (pitfall in AGENTS.md), so the base differs by platform.
- `makeGifsApi` takes a `toItem` mapper because web renders contract rows and phone needs
  absolute preview URLs.
- Lead checks still to do: web mock sticker panel/GIF search/`/settings/stickers`, phone
  emulator `/settings/stickers`.

## Review (written by Claude)

Approved; the pre-review passed with no findings. Net −164: `packages/client-core/src/stickers-api.ts` (156) replaces the hand-written sticker and GIF calls on both apps, including the phone's own row parsers.
- **Web mock** (`:5236`): `/settings/stickers` lists My packs, Discover and Favorites. In a chat, the panel shows 19 sticker images and the GIFs tab loads images ("Powered by Giphy"). No page errors.
- **Phone emulator:** the smoke PASSed. The first screenshot was hidden by "System UI isn't responding" (the emulator was overloaded), so after a cold reboot the lead opened `zilar://settings/stickers` on this build: Cats, Moods and Space cats (@marta) all show. Tiles are blank because mock images stay blank by design.
- **Accepted:**
  - `gifMediaUrl` stays per app, because web and phone resolve against different origins;
  - `deletePackSticker` now returns void, since no caller used the flag.
