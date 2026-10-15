---
id: T-1524
title: "Phone sticker pack link page (approved Stickers canvas, PhonePack; twin of T-1497): /stickers/<packId> opens a screen with the name, count · @owner, the link with Copy, the sticker grid, Share and a full-width Add; Android App Links for /stickers/"
status: merged
milestone: M5
branch: task/T-1524-mobile-pack-link
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1524: Phone sticker pack link page

## Spec (written by Claude, do not edit)

### Why
Julio approved the Stickers design on 2026-10-15. Read `docs/design/mockups/stickers/README.md` ("Pack links") and `PhonePack.dc.html`.
- Every pack has a link, `https://chat.zilar.app/stickers/<packId>`, and anyone signed in who has it can open the pack and add it.
- The web page shipped as T-1497 (`apps/web/src/routes/StickerPackPage.tsx`, the reference for the states and texts).
- The phone must open the link in the app.

### Facts (the lead read them on main, 2026-10-15)
- **The contract:** `GET /api/sticker-packs/:id` (`packages/api-contract/src/stickers.ts:164-166`) returns `StickerPackDetail`, which is the pack fields plus `ownerHandle: string | null` and `inPanel: boolean` (`:115-121`). A missing or private pack answers 404.
- **Web's call:** `getStickerPack` (`apps/web/src/lib/api/stickers.ts:46-52`).
- **The phone's stickers API:** `apps/mobile/src/lib/stickers-api.ts` (292 lines):
  - `StickersApi` (`:156-185`) has `addStickerPanelPack` and `removeStickerPanelPack` but no get-one-pack call;
  - `parseStickerPack` is at `:86`;
  - the hook is `useStickersApi()` (`apps/mobile/src/components/stickers/use-stickers-api.ts:87`).
- **Sticker images:** `stickerImageSource(url, API_URL, token)` and `isSameOriginStickerUrl` in `apps/mobile/src/lib/stickers.ts` (`:70`, `:112`), rendered with `expo-image` as in `apps/mobile/src/components/stickers/pack-card.tsx:47-60`.
- **Share and copy:**
  - `Share.share({ message: url })` with a `WEB_HOST = 'https://chat.zilar.app'` constant (`apps/mobile/src/app/settings/contacts.tsx:28`, `:136-145`);
  - copy uses `expo-clipboard`, as in `apps/mobile/src/components/chat/invite-sheet.tsx`.
- **App links:**
  - Android intent filters are in `apps/mobile/app.json:22-35`, with no `/stickers/` prefix;
  - `apps/mobile/src/app/+native-intent.tsx` calls `webPathToAppPath` (`apps/mobile/src/lib/web-link.ts:97-109`);
  - `rewriteWebUrl` (`:72-95`) sends unknown web paths to `/`. `/invite/` and `/u/` pass through unchanged (`:83-85`).

### Steps
1. **`stickers-api.ts`:** add `getStickerPack(packId): Promise<StickerPackDetail>` (the phone type: `StickerPack & { ownerHandle: string | null; inPanel: boolean }`), calling `GET /api/sticker-packs/:id` the way the other calls do. A 404 rejects with `ApiError`. Add it to the mock path too if the hook's mock needs it.
2. **New route `apps/mobile/src/app/stickers/[packId].tsx`** (wrap it in the same auth guard the sticker settings use), after `PhonePack.dc.html`:
   - top row: a Back `IconButton` and, at the right, a Share `IconButton` (`Share2`, label "Share <name>") that shares the link;
   - the title (28 px, 600);
   - "N stickers · @handle" (handle when set) with a `Globe` icon when shared;
   - a well row with a `Link` icon, the mono link text (`chat.zilar.app/stickers/<id>`, truncated) and a Copy `IconButton` ("Copy link"; toast "Link copied");
   - a 4-column sticker grid (square tiles, 14 px radius, images through `stickerImageSource`);
   - at the bottom (safe area), a full-width primary key: "Add to my stickers" when not in the panel, or an outline "Remove from my stickers" when it is. It switches after success, and an error shows above it.
   - **States:** loading (`StateMessage`), and not found or not available (404): "This sticker pack is not available.", with Back.
3. **App links:**
   - `app.json` gains `{ "scheme": "https", "host": "chat.zilar.app", "pathPrefix": "/stickers/" }`;
   - `rewriteWebUrl` passes `/stickers/<id>` through unchanged (extend the `invite|u` pattern).
4. **The share link:** use one constant for the pack URL, `https://chat.zilar.app/stickers/<id>` (a small exported helper in `apps/mobile/src/lib/stickers.ts`).

### Not in scope
- web;
- the server;
- the My packs screen and its sheet (a later task adds Share there);
- iOS universal links (the app has none today).

### Tests
None new (UI). Keep `apps/mobile/src/lib/web-link*.test.ts` passing if it exists; add one case for `/stickers/` there only if that file exists.

### Allowed files
- `apps/mobile/src/lib/stickers-api.ts`
- `apps/mobile/src/lib/stickers.ts`
- `apps/mobile/src/lib/web-link.ts`
- `apps/mobile/src/lib/web-link.test.ts` (only if it exists)
- `apps/mobile/src/app/stickers/[packId].tsx` (new)
- `apps/mobile/app.json`
- `apps/mobile/src/components/stickers/use-stickers-api.ts` (only if the mock needs the new call)
- `work/T-1524-mobile-pack-link.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On the phone mock, `/stickers/<a seed pack id>` shows the pack page: name, count · @owner, link with Copy, grid, Share, and the Add/Remove key; Add puts the pack in the panel.
- A bad id shows "This sticker pack is not available."
- `https://chat.zilar.app/stickers/<id>` maps to `/stickers/<id>`.

---

## Report (written by the worker when done)

### What I did

- `apps/mobile/src/lib/stickers.ts`: added the phone `StickerPackDetail` type
  (`StickerPack` plus `ownerHandle: string | null` and `inPanel: boolean`) and the
  pack-link helpers `STICKER_PACK_HOST`, `stickerPackUrl(packId)`
  (`https://chat.zilar.app/stickers/<id>`) and `stickerPackUrlText` (the shown
  form without the scheme).
- `apps/mobile/src/lib/stickers-api.ts`: added `getStickerPack(packId)` to
  `StickersApi`, calling the contract `client.stickers.getPack` and mapping the
  reply through the new `toStickerPackDetail` (rejections, including 404, stay
  `ApiError`s). No `use-stickers-api.ts` change was needed: the mock builds the
  same `createStickersApi` over `mockFetch`, and the shared mock backend already
  answers `GET /sticker-packs/:id` (T-1495).
- `apps/mobile/src/app/stickers/[packId].tsx` (new): the pack link page, wrapped
  in `RequireStickersAuth`. Top row with Back and a `Share <name>` `IconButton`
  (system share of the pack link); the 28 px / 600 title; `N stickers · @handle`
  with a `Globe` when the pack is shared; the link well (`Link` icon, mono text,
  Copy `IconButton`, toast "Link copied"); the 4-column grid rendered through
  `stickerImageSource`; and the full-width Add/Remove key at the bottom (safe
  area) with the error line above it and a local in-panel switch after success.
  States: loading (`StateMessage`), 404 → "This sticker pack is not available."
  with Back, other failures → a fixed sentence with Retry.
- `apps/mobile/src/lib/web-link.ts`: extended the pass-through test to
  `/^\/(?:invite|u|stickers)\/.+$/`, so a full `https://chat.zilar.app/stickers/<id>`
  URL maps to `/stickers/<id>`.
- `apps/mobile/app.json`: added the Android intent filter
  `{ "scheme": "https", "host": "chat.zilar.app", "pathPrefix": "/stickers/" }`.

### Files changed

- `apps/mobile/src/lib/stickers.ts`
- `apps/mobile/src/lib/stickers-api.ts`
- `apps/mobile/src/lib/web-link.ts`
- `apps/mobile/src/app/stickers/[packId].tsx` (new)
- `apps/mobile/app.json`
- `work/T-1524-mobile-pack-link.md`

### Checks run

No new tests: this is UI, and `apps/mobile/src/lib/web-link*.test.ts` does not
exist, so no `/stickers/` case was added (per the spec).

`pnpm gate` (first run): FAIL on format only — `[warn] apps/mobile/src/app/stickers/[packId].tsx`,
"Code style issues found in the above file". Fixed with
`pnpm exec prettier --write "apps/mobile/src/app/stickers/[packId].tsx"`.

`pnpm gate` (second run): `GATE PASS`. Summary lines:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.6s)
PASS  lint  (1.0s)
PASS  typecheck  (4.6s)
PASS  effect  (1.0s)
PASS  tests @zilar/mobile  (2.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- Back uses `goBackOrHome` (not `router.back()`), so a page opened cold from an
  App Link lands on the chat list instead of a dead Back key — the same choice as
  `u/[handle].tsx` and `me.tsx`. Web falls back to `/settings/stickers`.
- For non-404 load failures I show a fixed sentence ("Could not load the pack.")
  with Retry instead of web's server sentence, per AGENTS.md ("fixed sentences,
  never raw server text").
- Web hides the Add/Remove key on your own packs (`isOwn`). This spec only asks
  for the key to follow `inPanel`, so it shows Remove on a pack already in your
  panel, including your own; I followed the spec.
- Not done (out of scope): web, the server, the My-packs share sheet, iOS
  universal links.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 2 nits, for head `aa792d5d9`.
- **Phone smoke (mock build, emulator):** both routes pass.
  - **The seed Cats pack:**
    - Back and Share keys, the title "Cats", "6 stickers" with the globe;
    - the link well with the mono link and Copy;
    - a 4-column grid of 6 tiles (blank in mock mode, as decided for mock images);
    - the full-width outline "Remove from my stickers".
  - **A bad id:** "This sticker pack is not available." with Back.
- **Links:** `app.json` gains the `/stickers/` App Link, and `rewriteWebUrl` passes `/stickers/<id>` through.
- **Follow-up (with the phone My packs task):** web hides Add/Remove on your own packs, but the phone shows Remove there; align both.
