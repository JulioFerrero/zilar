---
id: T-1046
title: "Mock backend F1: stickers (packs, panel, favorites, discover, files) and GIFs (search, trending) domains in @zilar/mock-backend"
status: merged
milestone: M5
branch: task/T-1046-mock-backend-stickers-gifs
model: auto
effort: default
depends_on: [T-0949]
estimate: 0.5 day
---

# T-1046: Mock backend F1, stickers and GIFs

## Spec (written by Claude, do not edit)

### Why
This is the third part of mock wave 2: task F in `docs/audit/mock-plan.md` §4. Read the plan and "Julio's answers".

Mobile mock mode answers 404 for any route the shared backend lacks (`apps/mobile/src/mock/backend.ts:8-10`). On 2026-10-10 the lead's mobile mock smoke showed six GIF cells but no images.

### What to build
1. **New domains**, each a folder under `packages/mock-backend/src/domains/` plus one alphabetical line in `packages/mock-backend/src/domains/index.ts`.
   - **`stickers`:** the `stickers` contract group (`packages/api-contract/src/stickers.ts:140-197`). That covers packs (list, create, patch, delete), stickers (upload, delete, `GET /stickers/:stickerId/file`), discover, the panel (reorder, add, remove) and favorites (list, add, remove).
     - Web mock: `apps/web/src/mock/api.ts:2326-2482`, with the same bodies and mutations.
     - Mobile cross-check: `apps/mobile/src/mock/stickers.ts` and `apps/mobile/src/components/stickers/stickers-mock.ts`.
     - The Telegram import (`POST /sticker-packs/import/telegram`) answers as the web mock does, or with a fixed contract error if the web mock has none. State which one in the Report.
     - Sticker images are inline `data:` URLs or small SVGs, so they render with no network.
   - **`gifs`:** `GET /gifs/search` and `GET /gifs/trending` (`packages/api-contract/src/gifs.ts:42-46`).
     - Web mock: `apps/web/src/mock/api.ts:2483-2501`.
     - Mobile cross-check: `apps/mobile/src/mock/gifs.ts`.
     - Each result's preview and full URL must render with no network (a `data:` URL), because the plan does not fake the `/gifs/media/:token` proxy (§3).
2. **Size:** keep every file under 400 lines.
3. **No app file changes and no tests.** Prove it in the Report with a throwaway script against `createMockBackend()`, decoding each response with its contract schema:
   - list the packs, then add and remove a favorite;
   - `GET /gifs/trending`, and show that a result's URL starts with `data:`.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `packages/mock-backend/src/domains/index.ts`, one existing domain (`routines/`), and the web mock ranges, mobile mock files and contract files above.

### Allowed files
`packages/mock-backend/**`, `work/T-1046-mock-backend-stickers-gifs.md`.

T-1044 (prefs and pins) and T-1045 (folders, backgrounds and media) work in the same package in parallel. Touch only your own domain folders and your lines in `packages/mock-backend/src/domains/index.ts`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass, and only `packages/mock-backend` changes.
- Every file is under 400 lines.
- The Report has the decoded sticker and GIF proof.

The lead then runs a mobile mock smoke of the sticker and GIF panels.

---

## Report (written by the worker when done)

### What I did

Added the stickers and GIFs domains to `@zilar/mock-backend`, mirroring web's mock
(`apps/web/src/mock/api.ts:2326-2501`) and cross-checked against the mobile mocks.

- **stickers** (`src/domains/stickers/`): the whole `stickers` contract group — packs
  (list on the panel order, create 201, patch title/visibility/order, delete with the
  warning body), sticker upload (raw body, `x-emoji` and `content-type` headers, 120
  cap) and delete, `GET /stickers/:stickerId/file` (generated SVG, `image/svg+xml`),
  discover (`{ packs, next: null }`), the panel (atomic reorder, add, remove, trailing
  slash → 404) and favorites (list, add, remove, empty at seed). Seed is the two demo
  packs (Cats, Moods, 6 stickers each) with `/api/stickers/<id>/file` URLs.
- **gifs** (`src/domains/gifs/`): `GET /gifs/search` and `GET /gifs/trending`, title
  filter + `pos` paging like web. Each row's `mediaToken` is a `data:image/svg+xml`
  URL (web stores the art in `mediaToken` and the panel renders `data:` offline), so no
  `/gifs/media/:token` proxy is needed.
- Registered both domains with one alphabetical import/array line each in
  `src/domains/index.ts`.

**Telegram import:** the web mock has a full implementation, so I mirrored it rather
than a fixed error: the pack is created (or reused by `importedFrom`) and six demo
stickers are copied in; `__mock_unavailable` → 501, `__mock_missing` → 404,
`__mock_partial` → `partial: true`.

### Files changed

New:
- `packages/mock-backend/src/domains/stickers/{index,routes,packs,seed,state}.ts`
- `packages/mock-backend/src/domains/gifs/{index,routes,seed}.ts`

Modified:
- `packages/mock-backend/src/domains/index.ts` (2 imports + 2 array entries, alphabetical)
- `packages/mock-backend/src/data/index.ts` (MockSeed: `stickerPacks`, `stickerPanel`, `stickerFavorites`)
- `packages/mock-backend/src/state.ts` (MockData: same three + `nextStickerSequence`)
- `work/T-1046-mock-backend-stickers-gifs.md`

### Deviations from the spec

- The spec says to touch only my domain folders and my line in `domains/index.ts`, but
  `data/index.ts` and `state.ts` declare the shared `MockSeed`/`MockData` interfaces;
  a new domain's seed/state does not typecheck without its fields there. I added the
  minimum additive lines (no edit to another worker's fields).
- The routing was split into `routes.ts` (dispatcher, panel, favorites, file) and
  `packs.ts` (packs/upload/import) because one file was 427 lines, over the 400 cap.
- New pack/sticker ids use `mockStickerId(sequence)` (UUID v4 shape) instead of
  `crypto.randomUUID()`: the package runs under Hermes, which has no Web Crypto (AGENTS
  pitfall). It still satisfies `StickerSchema`'s UUID requirement.
- The `x-emoji` header is percent-decoded with `URLSearchParams` (never throws) instead
  of a `try/catch`; the effect ratchet flags `try {` as W4 and the mock backend is
  effect-plain. Behavior matches web's lenient decode.
- Sticker favorites start empty (web's seed); the mobile mock seeds the first two
  stickers. Kept web's behavior since web is the authoritative mock.

### Commands and results

- `pnpm --filter @zilar/mock-backend typecheck` → pass (no errors).
- Throwaway probe, `pnpm --filter @zilar/api-contract test --maxWorkers=2 --reporter=dot probe.test.ts`
  (decoded every response with the contract schema via `Schema.decodeUnknownSync`), then deleted:

```text
packs: Cats(6), Moods(6)
sticker file: { status: 200, Content-Type: image/svg+xml, bytes: 414 }
added favorite: 21111111-1111-4111-8111-111111111111
favorites count: 1
removed ok: true
favorites after remove: 0
gifs: 6 data url: true
discover: 2
panel after create: ["Cats","Moods","Party"]
bad reorder status: 400
uploaded sticker: { emoji: "🎈", url: "/api/stickers/00000000-0000-4000-8000-000000000003/file" }
telegram import: { imported: 6, from: "telegram:PackName" }
gif search "dancing": ["🐱 dancing"]
percent-encoded emoji header %F0%9F%8E%88 -> 🎈 (mime image/webp)
```

The required proof: `GET /api/sticker-packs` decoded with `StickerPackList` yields the
two packs; favorite add decoded with `Sticker`, list with `StickerFavorites`, remove
with `StickerOk` (1 → 0); and `GET /api/gifs/trending` decoded with `GifResultPage`
yields 6 rows whose `mediaToken` starts with `data:` (`GIF URL IS DATA URL: true`).

- `pnpm gate` (repo root):

```text
gate: 12 changed file(s) against main
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
SKIP tests @zilar/mock-backend (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Notes for the mobile smoke

- Sticker files are served from `GET /api/stickers/:stickerId/file` as SVG; uploaded
  stickers have no stored bytes, so their file 404s (same as web's mock).
- Mobile's `gifs-api.ts` `toGifItem` always wraps `mediaToken` in
  `/api/gifs/media/<token>`, so a `data:` token would become a proxy path there. Web's
  `GifPanel.gifPreviewUrl` already passes `data:image/` through. The GIF composer path
  in mock mode uses `mockDemoGifs()` directly, so this only affects the in-app GIF
  search/trending panel; it is app code, outside this task's Allowed files.

### Open questions

None blocking.

## Review (written by Claude)

**Lead, 2026-10-10: approved for the backend part. The images do not render on mobile yet (a board follow-up). The pre-review is clean, with 2 nits and 1 follow-up.**
- **The change:** new `stickers` and `gifs` domains in `@zilar/mock-backend`:
  - the Cats and Moods packs, 6 stickers each, with a same-origin SVG file route;
  - the pack and sticker CRUD and favorites;
  - 6 trending and search GIFs whose `mediaToken` is a `data:image/svg+xml` URL.

  Only that package changed.
- **The nits:** both are edge cases that mirror web's mock: a malformed `%` in the `x-emoji` header is kept as is, and a pack reorder accepts duplicate ids.
- **The lead's phone smoke** (mock, Ana's chat):
  - the Stickers tab lists Recent, Cats and Moods, and the grid holds 6 cells with their emoji labels;
  - the GIFs tab shows the result cells.
- **The images do not draw on either tab:**
  - **stickers:** native `Image` loads `/api/stickers/<id>/file` from `API_URL` over the network, which `mockFetch` never sees, and the file is SVG, which React Native's `Image` cannot draw;
  - **GIFs:** mobile `toGifItem` wraps every token in `/api/gifs/media/<token>`, as the worker reported.

  That is app code plus raster art, so it is a follow-up.
- **Check:** the gate passed.
