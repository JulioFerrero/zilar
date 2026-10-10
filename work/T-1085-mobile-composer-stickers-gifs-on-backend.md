---
id: T-1085
title: "Mock H2-8 (mobile): the composer's sticker and GIF tabs load from @zilar/mock-backend through injected APIs instead of demo props; delete mock/stickers.ts and mock/gifs.ts"
status: todo
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

## Review (written by Claude)
