---
id: T-1085
title: "Mock H2-8 (mobile): the composer's sticker and GIF tabs load from @zilar/mock-backend through injected APIs instead of demo props; delete mock/stickers.ts and mock/gifs.ts"
status: merged
milestone: M5
branch: task/T-1085-mobile-composer-stickers-gifs-on-backend
model: auto
effort: default
depends_on: [T-1084]
estimate: 0.3 day
---

# T-1085: Mobile composer stickers and GIFs on the shared mock backend

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-sweep-status.md` §2 (T-1082): the mobile composer is the last screen that reads local mock data. The lead re-read main (2026-10-11).

**The demo props:** `apps/mobile/src/components/chat/chat-composer-dock.tsx:67-94` builds three of them when `NODE_ENV === 'test' || EXPO_PUBLIC_ZILAR_MOCK === '1'`:
- `demoPacks`, from `mockDemoStickerPacks()` (`mock/stickers.ts`);
- `demoAttachments`, from `mockDemoAttachments()` (`mock/attachments.ts`);
- `demoGifs`, from `mockDemoGifs()` (`mock/gifs.ts`).

They are passed to `Composer` and `ChannelComposerBar` (`:155-171`).

**The chain:**
- `components/chat/composer.tsx:40-44`, `:72-74`, `:129-130` and `components/chat/channel-composer-bar.tsx:44-48`, `:74-76`, `:106-108` pass `demoPacks` and `demoGifs` on to `useComposerSheet` (`components/chat/composer-sheet.ts:36-46`).
- **Stickers:** `composer-sheet.ts:81-94` uses `demoPacks` instead of loading. The real load is `loadStickerPacks()` at `:61`, which is `(api ?? createStickersApi()).listStickerPacks()` (`components/chat/sticker-panel.tsx:352-356`). That is a real `fetch` with no mock.
- **GIFs:** `composer-sheet.ts:99-103` builds `demoGifItems` (with a second `mockDemoGifs()` call) and probes `probeGifsAvailability()` at `:134`, which defaults to `createGifsApi()` (`components/chat/gif-paging.ts:44-56`). `composer.tsx:244` passes `mockGifItems` to `EmojiSheet` (`components/chat/emoji-sheet.tsx:54-55`, `:157`), which already accepts a `gifsApi` prop and passes `mockItems` and `api` to `GifPanel` (`components/chat/gif-panel.tsx:44-46`, `:57-66`).

**The APIs already exist:**
- `useStickersApi()` (`components/stickers/use-stickers-api.ts`) returns a mock-backed `api` in mock mode (T-1079) and the real one otherwise;
- `createGifsApi(getToken, fetchImpl, apiUrl)` (`lib/gifs-api.ts:95-99`) takes a fetch;
- the backend serves `/gifs` trending and search (`packages/mock-backend/src/domains/gifs/`) and the sticker panel.

### What to build
1. **Probe first,** with a throwaway script that you do not commit. Probe the GIF trending and search calls and `listStickerPacks` against `createMockBackend({ delayMs: 0 }).http(path, init)`. If any is not served, stop and report.
2. **`chat-composer-dock.tsx`:**
   - replace `demoPacks` with `stickersApi = useStickersApi().api`;
   - replace `demoGifs` with `gifsApi`: in mock mode, `createGifsApi(mockToken, mockFetch, API_URL)` from a guarded `require('@/mock/backend')` inside `__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK` (the machines pattern); otherwise `undefined`;
   - **keep `demoAttachments`** as it is. `mock/attachments.ts` stays, because it feeds the attach sheet's placeholders, not an API.
3. **The chain:** rename and plumb `demoPacks` to `stickersApi?: StickersApi` and `demoGifs` to `gifsApi?: GifsApi` through `composer.tsx`, `channel-composer-bar.tsx` and `composer-sheet.ts`.
   - `composer-sheet.ts` calls `loadStickerPacks(stickersApi)` and `probeGifsAvailability(gifsApi)`, and drops `demoGifItems` and its `mockDemoGifs` import. Mock mode now loads like real mode.
   - `composer.tsx` passes `gifsApi` to `EmojiSheet` instead of `mockGifItems`.
4. **Dead props:** remove `mockGifItems` from `emoji-sheet.tsx` and `mockItems` from `gif-panel.tsx`, if nothing else passes them (`grep` first).
5. **Delete** `apps/mobile/src/mock/stickers.ts` and `apps/mobile/src/mock/gifs.ts`, after `grep -rn` across `apps/mobile` confirms that nothing else imports them.
6. **Rules:** every file stays under 400 lines, no tests, and no other files change. Sticker and GIF images may still be blank on the device; that is §3 of the audit and a later slice.

The lead runs a phone smoke in mock mode:
- open a chat, then the emoji sheet;
- the Stickers tab lists Cats and Moods;
- the GIFs tab shows results;
- send a sticker.

### Read first
`AGENTS.md`, the files named in Why, `apps/mobile/src/components/machines/use-machines-api.ts`, and `docs/audit/mock-sweep-status.md` §2-§3.

### Allowed files
`apps/mobile/src/components/chat/chat-composer-dock.tsx`, `apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/components/chat/channel-composer-bar.tsx`, `apps/mobile/src/components/chat/composer-sheet.ts`, `apps/mobile/src/components/chat/emoji-sheet.tsx`, `apps/mobile/src/components/chat/gif-panel.tsx`, `apps/mobile/src/mock/stickers.ts`, `apps/mobile/src/mock/gifs.ts`, `work/T-1085-mobile-composer-stickers-gifs-on-backend.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the probe and the greps for the deleted files.

---

## Report (written by the worker when done)

### What I did

Replaced the composer's three demo-prop sources so the sticker and GIF tabs load
from `@zilar/mock-backend` through injected APIs in mock mode, exactly like real
mode, then deleted the two now-dead mock files.

- `chat-composer-dock.tsx`: dropped `demoPacks`/`demoGifs`. It now calls
  `useStickersApi()` once and passes `stickersApi` (the mock-backed adapter in
  mock mode, the real one otherwise) and derives `gifsApi` from the hook's
  `mock` flag: `createGifsApi(mockToken, mockFetch, API_URL)` behind the
  `__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK` literal guard (the machines
  pattern, `createMockGifs()`), else `undefined`. `demoAttachments` is unchanged
  (`mock/attachments.ts` stays).
- `composer.tsx`, `channel-composer-bar.tsx`: renamed the props to
  `stickersApi?: StickersApi` / `gifsApi?: GifsApi` and plumbed them through.
- `composer-sheet.ts`: `loadStickerPacks(stickersApi)` and
  `probeGifsAvailability(gifsApi)`; dropped `demoGifItems`, the second
  `mockDemoGifs()` call and its import. `loadPanel` no longer short-circuits on
  demo packs. `composer.tsx` now passes `gifsApi` to `EmojiSheet` (instead of
  `mockGifItems`).
- `emoji-sheet.tsx`: removed the now-dead `mockGifItems` prop; `GifPanel` gets
  `api={gifsApi}` only.
- Deleted `apps/mobile/src/mock/stickers.ts` and `apps/mobile/src/mock/gifs.ts`.

`gif-panel.tsx` was left unchanged: the spec makes removing `mockItems`
conditional on "nothing else passes them", and `gif-panel-sheet.tsx` (an exported
but unimported `GifSheet`, **not** in the Allowed files) still destructures and
forwards `mockItems`. Removing it would break that file's typecheck, so I kept it.
`mockItems` is now only reachable through that dead wrapper; the live composer
path never passes it.

### Probe (throwaway, not committed)

`createMockBackend({ delayMs: 0 }).http(path, init)`, run once and then deleted
(`packages/mock-backend/probe-t1085.test.ts`):
`GET /api/gifs/trending` → 200 (6 rows), `GET /api/gifs/search?q=a` → 200
(matching rows), `GET /api/sticker-packs` → 200 with packs "Cats" and "Moods".
One test passed.

### Greps for the deleted files

- `grep -rn "mock/stickers\|mock/gifs" apps/mobile` (excluding `node_modules`) →
  no matches (exit 1).
- `grep -rn "mockDemoGifs\|mockDemoStickerPacks" apps/mobile` → no matches; the
  only remaining hits repo-wide are `packages/mock-backend/src/domains/gifs/seed.ts`
  and `routes.ts`, which define the backend's own `mockGifItems` seed (unrelated).
- `grep -rn "demoPacks\|demoGifs\|mockGifItems\|demoGifItems" apps/mobile/src` →
  no matches.

### Files changed

`chat-composer-dock.tsx`, `composer.tsx`, `channel-composer-bar.tsx`,
`composer-sheet.ts`, `emoji-sheet.tsx`; deleted `mock/stickers.ts`,
`mock/gifs.ts`; this task file.

### Commands run

- `pnpm install` — done, up to date.
- Single probe test above.
- `pnpm gate` from the repo root:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

No tests were added (spec says none), and no test files were run apart from the
throwaway probe.

### Deviations / open questions

- Gating `gifsApi` on `useStickersApi().mock` (rather than re-deriving the
  `?mock=`/env gate): the two share the identical gate and no `useGifsApi` hook
  exists, so this keeps stickers and GIFs in agreement and avoids duplicating the
  gate. A dev build pointed at a real server therefore uses the real GIF client,
  the same as stickers.
- `gif-panel.tsx`'s `mockItems` is left in place for the typecheck reason above.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 follow-up.**
- **The change:**
  - the composer chain passes `stickersApi` (from `useStickersApi`) and `gifsApi` (`createGifsApi(mockToken, mockFetch, API_URL)` in mock mode) instead of `demoPacks` and `demoGifs`;
  - `composer-sheet.ts` loads like real mode;
  - `mock/stickers.ts` and `mock/gifs.ts` are deleted, and `demoAttachments` stays.
- **The lead's phone smoke** (mock, Marta's chat):
  - the emoji sheet's Stickers tab lists Recent, Cats and Moods from the backend;
  - the GIFs tab shows a results grid with Search GIFs and "Powered by Giphy". The images are blank, which is audit §3 and a later slice;
  - tapping the first Cats sticker sends it, and it shows as 🐱 with a tick.
- **The follow-up:** `mockItems` in `GifPanel` and `GifSheet` (`gif-panel-sheet.tsx`, outside this task's files) is now unused.
- **Check:** the gate passed.
