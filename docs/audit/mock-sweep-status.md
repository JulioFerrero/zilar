# Mock sweep status, round 2 (T-1082)

Read-only audit for T-1082, measured on `task/T-1082-mock-sweep-status-2`
(2026-10-11). No code was changed and the apps were not run. It supersedes the
T-1059 audit (`git log -- docs/audit/mock-sweep-status.md`). Paths are relative
to the repo root. "Backend" means `@zilar/mock-backend` (`packages/mock-backend`).
Line counts are `wc -l`; importers are `grep -rn` including `require(` forms.

## 1. What is left in each app's `mock/` folder

### Web `apps/web/src/mock/` (6 files)

| File | Lines | Importers (`file:line`) | Provides | Backend could provide? |
| --- | ---: | --- | --- | --- |
| `backend.ts` | 31 | `mock/load.ts:9,18` (dynamic `import('./backend')`) | the singleton `backend` and `dispatch(path, init): Promise<Response>` (`:25`) | it is the backend |
| `gate.ts` | 106 | `mock/gate.test.ts:2`, `auth/AuthProvider.tsx:8`, `components/StickerPanel.tsx:13`, `lib/effect/api-client.ts:19`, `lib/api/http.ts:3`, `store/ChatStoreProvider.tsx:5` | `resolveMockMode` (`:23`), `isMockMode` (`:92`), `isMockApiEnabled` (`:104`) | no — app switch, kept |
| `gate.test.ts` | 45 | self only | unit tests for `resolveMockMode` | n/a |
| `helpers.ts` | 45 | `components/StickerPanel.tsx:14` (`mockGifItems`) | `mockGifItems()` (`:28`), `MockGifItem` (`:1`), SVG `data:` art (`:15-26`) | yes — `packages/mock-backend/src/domains/gifs/seed.ts:31` + `routes.ts:11` serve the same six rows |
| `ids.ts` | 30 | `auth/AuthProvider.tsx:9` (`currentUserId`) | `currentUserId` (`:1`), plus `PEOPLE`/`ME`/`AI_JIDS`/`ROOMS` with no importer | partly — `currentUserId` maps to the backend's `data/people` `currentUser` |
| `load.ts` | 22 | `lib/effect/api-client.ts:20`, `lib/api/http.ts:4`, `store/ChatStoreProvider.tsx:6` | `loadMockRequest` (`:7`) and `loadMockXmpp` (`:16`), both behind the inline build condition | no — the build-conditioned seam, kept |

### Mobile `apps/mobile/src/mock/` (10 files)

| File | Lines | Importers (`file:line`) | Provides | Backend could provide? |
| --- | ---: | --- | --- | --- |
| `attachments.ts` | 39 | `components/chat/chat-composer-dock.tsx:9` | `mockDemoAttachments()` (`:11`): two `gradient:` images + one file row | no — UI placeholder; the send path is the fake XMPP slot (`packages/mock-backend/src/xmpp/core.ts:227`) |
| `backend.ts` | 44 | `store/chat-store-provider.tsx:65` and 13 `require('@/mock/backend')` hook/component call sites | `backend`, `mockFetch` (`:37`) | it is the backend |
| `dev-kit-screen.tsx` | 274 | `app/dev/kit.tsx:13` (`require`) | hidden component catalog, not mock data | no |
| `drafts.ts` | 62 | none | `readMockDraftPhase` (`:57`), `createMockDraftFinalMessage` (`:42`) | no — and now dead (no importer) |
| `gate.ts` | 59 | `auth/RequireAuth.tsx:7`, `store/chat-store-provider.tsx:13`, and 13 `use-*-api.ts`/`chat-search-results.tsx` hooks | `mockParamAllowed` (`:7`), `isMockMode` (`:31`), `mockToken` (`:48`), `ENV_MOCK`/`ENV_MOCK_SCENARIO`/`ENV_NODE_ENV`/`MOCK_ENV` (`:52-59`) | no — app switch, kept |
| `gifs.ts` | 43 | `components/chat/composer-sheet.ts:23`, `components/chat/chat-composer-dock.tsx:10` | `mockDemoGifs()` (`:34`): six SVG `data:` rows | yes — `packages/mock-backend/src/domains/gifs/seed.ts:31` |
| `load.ts` | 26 | none | `readMockLoadScenario` (`:19`), `MOCK_LOAD_DELAY_MS` (`:16`) | no — screenshot scenario, kept by plan, currently unimported |
| `stickers.ts` | 51 | `components/chat/chat-composer-dock.tsx:11` | `mockDemoStickerPacks()` (`:46`): two packs, `/api/stickers/:id/file` urls (`:36`) | yes — `packages/mock-backend/src/domains/stickers/seed.ts:132` |
| `time.ts` | 14 | `mock/drafts.ts:11` | `at` (`:4`), `hoursFromNow` (`:12`) | no |
| `uploader.ts` | 77 | `store/chat-store-provider.tsx:67` (`require`) | `createMockUploader()` (`:45`): no-network upload stand-in (T-1047) | no — kept |

Corrections to the task's grep: the mobile `lib/` callers of `./gifs`, `./stickers`
and `./attachments` resolve to `apps/mobile/src/lib/{gifs,stickers,attachments}.ts`,
not to `mock/`. The only importers of the mock demo files are the two files above
(`composer-sheet.ts`, `chat-composer-dock.tsx`). `app/settings/sticker-pack.tsx:16`
imports `./stickers` = `app/settings/stickers.ts`, also not a mock.

## 2. Remaining old-mock behaviour, per screen

- **Web StickerPanel, GIF tab.** The panel injects the local placeholders
  (`components/StickerPanel.tsx:13-14,111-116`) instead of the backend's
  `GET /gifs/trending` (`packages/mock-backend/src/domains/gifs/routes.ts:11-30`):
  `mockGifProps()` returns `mockGifItems()` when `isMockMode()` (`StickerPanel.tsx:294`).
- **Web session.** `MockAuthProvider` fabricates `you@zilar.test` from
  `mock/ids.ts` (`auth/AuthProvider.tsx:97-100,118`); no backend route is used.
- **Web store.** The real store runs, with the fake XMPP only:
  `loadMockXmpp()` feeds `createRealChatStore({ createXmpp })`
  (`store/ChatStoreProvider.tsx:23-40`).
- **Mobile chat composer.** `ChatComposerDock` builds demo packs, GIFs and
  attachments from the three mock files when
  `NODE_ENV === 'test' || EXPO_PUBLIC_ZILAR_MOCK === '1'`
  (`components/chat/chat-composer-dock.tsx:69-94`) and feeds them to `Composer`
  and the channel bar (`:155-171`). `composer-sheet.ts:101-103` has a second
  `mockDemoGifs()` path for the same env.
- **Everything else** goes through the backend: web via `dispatch`
  (`mock/backend.ts:25`) reached from `loadMockRequest` (`mock/load.ts:7`); mobile
  via `mockFetch` (`mock/backend.ts:37`) passed in
  `store/chat-store-provider.tsx:73-79` and by the 13 API hooks.

No other screen reads local mock data. `mock/load.ts` (mobile), `mock/drafts.ts`
and `mock/ids.ts`'s second half are unimported.

## 3. The blank images

### 3.1 Web stickers

Load path: the backend sticker rows carry a relative url
`/api/stickers/<id>/file` (`packages/mock-backend/src/domains/stickers/seed.ts:92,124`);
`StickerPanel` maps a row to a choice (`components/StickerPanel.tsx:216-225`,
`toChoice :56-77`); `StickerThumb` checks `isPanelStickerUrl` →
`isSameOriginStickerUrl` (`apps/web/src/lib/stickers.ts:93-112,120`) and, true for
that path, renders `<img src={sticker.url}>` (`components/sticker/StickerThumb.tsx:27-35`).
Message stickers do the same (`components/StickerMessage.tsx:29-40`).

Why it fails: an `<img>` is fetched by the browser, not by the `fetch`-shaped
`dispatch`, so it never reaches the shared backend. The relative `/api/...` goes
to the Vite dev server, which proxies `/api` to `ZILAR_API_URL` (default
`http://localhost:3000`, `apps/web/vite.config.ts:14-19`); mock mode runs no
server there, so the image 404s/errors. `StickerThumb` has no `onError`, so the
panel tile is blank; `StickerMessage` falls back to the emoji tile on error
(`StickerMessage.tsx:20-26,38-45`).

Fixes:

1. **Vite dev middleware (dev-only).** Files: `apps/web/vite.config.ts` plus a
   new `apps/web/src/mock/dev-middleware.ts`. A `configureServer` hook answers
   `/api/stickers/:id/file` (and `/api/gifs/media/:token`, `/api/avatars/:id`,
   `/api/files`) from a `createMockBackend()` instance
   (`packages/mock-backend/src/index.ts`). Production: no runtime path (the hook
   runs only in the Vite dev server); the same-origin sticker check is untouched.
2. **Raster seed art** (below), so the bytes the middleware serves decode.

### 3.2 Web GIFs

`mockGifItems()` returns `mediaToken` = `data:image/svg+xml,…`
(`apps/web/src/mock/helpers.ts:25,28`); `gifPreviewUrl` returns that value as-is
(`components/GifPanel.tsx:105-107`) and `GifCell` renders it in `<img>` (`:172`).
Web `<img>` renders SVG, so web GIF placeholders are **not** blank today and need
no fix; if the art moves to the backend route later, §3.1 applies.

### 3.3 Mobile stickers

Load path: `mockDemoStickerPacks()` (`apps/mobile/src/mock/stickers.ts:46-50`) →
`demoPacks` (`components/chat/chat-composer-dock.tsx:69-75`) → the grid choices
(`components/chat/sticker-panel.tsx:122-133`) → `StickerThumb`
(`sticker-panel.tsx:286-311`). `isPanelStickerUrl` = `isSameOriginStickerUrl(url, API_URL)`
(`apps/mobile/src/lib/stickers.ts:70-94`); the pack url is relative
`/api/stickers/:id/file` (`mock/stickers.ts:36`), so it is trusted and renders
`<Image source={stickerImageSource(...)}>` with `uri = API_URL + '/api/stickers/...'`
(`lib/stickers.ts:112-121`).

Why it fails: React Native's `Image` fetches the URL itself and never calls
`mockFetch` (`mock/backend.ts:37`); `API_URL` (`lib/auth.ts:14-16`) has no server
in mock mode. Secondarily, the backend file route returns SVG
(`domains/stickers/seed.ts:74-88`, `routes.ts:122`), which native image loaders do
not decode without an SVG renderer.

Fixes: (2) raster PNG art below, plus (3) a mock-gated url allowance so a
`data:image/png` mock url loads in the grid. Production keeps the
`/api/stickers/.../file` same-origin rule (`lib/stickers.ts:70-94`).

### 3.4 Mobile GIFs

`mockDemoGifs()` row `url` = `data:image/svg+xml,…` (`mock/gifs.ts:28-30,34-42`).
`GifCell` lets `data:image/` bypass `isPanelGifUrl` and passes it to `expo-image`
(`components/chat/gif-cells.tsx:30-62`); the SVG payload is the failure (PNG bytes
would decode). The backend GIF seed also returns SVG `data:` tokens
(`domains/gifs/seed.ts:27,35`). Fix: (2) raster art.

### 3.5 Attachments (web and mobile)

Load path: a send asks the fake XMPP slot for a url; `requestUploadSlot` returns
`{ putUrl, getUrl }` both `data:${contentType};base64,` with no bytes
(`packages/mock-backend/src/xmpp/core.ts:227-231`).
- Web: `defaultAttachmentPort.upload` PUTs the file to `putUrl` and returns
  `getUrl` (`apps/web/src/lib/attachments.ts:190-204,220-224`); `ImageMessage`
  renders `<img src=…>` and on error shows "Image unavailable"
  (`components/ImageMessage.tsx:20-26,31-45`). The returned `data:` url carries no
  payload, so the image never decodes.
- Mobile: the mock uploader skips the PUT and the port returns `slot.getUrl`
  (`mock/uploader.ts:45-68`; `store/effects/ports.ts:187-198`). That `data:` url
  fails `isTrustedMediaUrl` (`packages/chat-core/src/media.ts:82-88`), so
  `AttachmentImage` falls back to the file row "Not loaded: untrusted address"
  (`components/chat/attachment-message.tsx:70-75,120-128,212`).

Fixes:

1. **A usable mock slot url.** Add a `files` domain to the shared backend
   (`PUT`/`GET /files/:id`) and return an http(s) url on the API origin for both
   `putUrl` and `getUrl`, served by the §3.1 middleware (web) or `mockFetch`
   (API calls). Production trust checks stay.
2. **Mobile local uri.** Have the mock uploader/port return the picked file's
   local uri (or a `data:` url the mock-gated check allows) so the sent image
   renders from the device. Files: `mock/uploader.ts`, `store/effects/ports.ts`.

Neither fix relaxes `isTrustedMediaUrl` (`media.ts:82`) or the sticker checks;
each is gated to mock mode, so production behaviour is unchanged.

## 4. Proposed slices

Each slice is a single diff of at most about 800 changed lines, in dependency
order. Full repo paths.

1. **Web dev middleware (~150).** `apps/web/vite.config.ts`,
   `apps/web/src/mock/dev-middleware.ts`. Serves sticker/GIF/avatar/file bytes
   from `createMockBackend()` in the dev server only. Depends on nothing.
2. **Raster seed art (~250).** `packages/mock-backend/src/domains/stickers/seed.ts`,
   `packages/mock-backend/src/domains/gifs/seed.ts`,
   `apps/mobile/src/mock/gifs.ts`, `apps/mobile/src/mock/stickers.ts`,
   `apps/web/src/mock/helpers.ts`. Replace SVG art with base64 PNG so native
   `Image`/`expo-image` decode it. Depends on nothing.
3. **Mock-gated image allowance (~200).** `apps/mobile/src/lib/stickers.ts`,
   `apps/mobile/src/components/chat/sticker-panel.tsx`. Load the raster `data:`
   sticker art in the grid in mock mode only. Depends on slice 2.
4. **Attachment bytes (~300).** `packages/mock-backend/src/xmpp/core.ts`,
   new `packages/mock-backend/src/domains/files/{routes,state,index}.ts`,
   `packages/mock-backend/src/domains/index.ts`,
   `apps/mobile/src/mock/uploader.ts`, `apps/mobile/src/store/effects/ports.ts`,
   `apps/web/src/lib/attachments.ts`. Depends on slice 1 (web) and slice 2's
   raster bytes (mobile).

## 5. Doc fixes in `docs/audit/mock-plan.md` (listed, not edited)

- `:28-30` — web switch line numbers: `gate.ts` now has `resolveMockMode :23`,
  `isMockMode :92`, `isMockApiEnabled :104`.
- `:31-33` — `load.ts:8` imports `./backend`, not `mock/api.ts` (deleted).
- `:37-39` — the three raw-body `mockRequest` uploads in `lib/api.ts` are gone;
  uploads route through `loadMockRequest`/`dispatch` (`lib/api/http.ts:34,83`).
- `:42-44` — `ChatStoreProvider.tsx:22` no longer picks `createChatStore()`; it
  builds `createRealChatStore()` (`store/ChatStoreProvider.tsx:25-40`), and
  `store/mockStore.ts` is deleted.
- `:45-46` — the `vite.config.ts` alias to `mock/storeStub.ts:7` is gone;
  `storeStub.ts` is deleted and `vite.config.ts` has no alias.
- `:50-52` — mobile `mock/gate.ts` line numbers: `mockParamAllowed :7`,
  `isMockMode :31`, `ENV_MOCK :52`.
- `:53-55` — `chat-store-provider.tsx:43 createMockStore` is gone; the provider
  builds the real store with `mockStoreDeps()` (`:63-79`).
- `:56-60` — the `use-*-api.ts` hooks no longer pick old mocks; they pass
  `mockFetch` to the real factories, and the cited `(tabs)/index.tsx` /
  `chat/[id].tsx` mock locations have moved.
- `:61-64` — `EXPO_PUBLIC_ZILAR_MOCK_SCENARIO` now lives at `gate.ts:53`; the
  `drafts.ts:57` and `load.ts:19` references still hold.
- `:66-69` — the mobile mock store (`store/chat-store.ts`) is deleted, so its
  no-op `start()` no longer exists.
- §1.2 table `:75-87` — files and counts are wrong: `api.ts`, `chats.ts`,
  `topics.ts`, `groups.ts`, `members.ts`, `messages.ts`, `index.ts`,
  `storeStub.ts` and `store/mockStore.ts` are deleted; `helpers.ts` is 45 (not
  223), `load.ts` 22 (not 14), `gate.ts` 106 (not 45); `backend.ts` (31) is new.
- §1.2 `:89-102` (route ranges) and `:104-107` (`/media` at `mockStore.ts:252`)
  — `mock/api.ts` and `mockStore.ts` are deleted; `/media` is now a backend domain
  (`packages/mock-backend/src/domains/media/routes.ts`).
- §1.3 table `:113-140` — most files are deleted; `mock/` now holds 10 files
  (§1 here). The five component `*-mock.ts` files (`:147-151`) are deleted.
- §1.3 `:154-160` — `store/chat-store.ts` and the module total are gone.
- §1.4 duplication table `:166-187` — nearly every cell cites a deleted file; the
  duplication is resolved by the one backend seed.
- §2.6 `:348-373` — describes the G/H cutovers as future; both are merged
  (`store/ChatStoreProvider.tsx`, `mock/load.ts`;
  `store/chat-store-provider.tsx:63-98`).
- §4 `:429-452` (budget and A–H) and `:482-499` (I–R2) — A–S and I–R2 are done
  except the leftovers in §1; the changed-line budget is historical.
- §5 `:522-526` (R1 cites `chat-store.ts:1587`), `:530-535` (R2/R3; R4 still
  holds) — the cited mock store and its tests no longer exist.
- §5 `:554-573` (open questions Q1–Q3 and Julio's answers) — all resolved; the
  split they describe is complete.
