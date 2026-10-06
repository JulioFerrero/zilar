---
id: T-0436
title: "Media gallery 3 (mobile): a header button opens a media sheet with Media / Files / Links / Voice tabs from GET /api/media"
status: merged
milestone: M5
branch: task/T-0436-mobile-media-sheet
model: auto
effort: low
depends_on: [T-0431]
estimate: 0.5 day
---

# T-0436: chat media sheet (mobile)

## Spec (written by Claude, do not edit)

### Why
This is Task 3 of `docs/audit/media-gallery-plan.md` §4. T-0431 (merged) serves `GET /api/media?chat&type&before&limit`, which returns `{ items, next }`; the item shape is in `apps/server/src/media/routes.ts`. Web gets the same panel in T-0434.

### Verified facts (do not re-derive)
- **Server item:** `messageId`, `chat`, `at` (ISO), `senderName`, `kind` (`image|file|gif|voice|link`), plus optional `url`, `name`, `size`, `mime`, `width`, `height`, `durationMs`, `waveform`, `linkUrl` and `linkHost`. `type` is `media|files|links|voice`; `next` is a string or null.
- **API client pattern:** `apps/mobile/src/lib/pins-api.ts`:
  - type guards instead of zod (`parsePin`, lines ~38-60);
  - a `request(apiUrl, …, fetchImpl)` helper;
  - a `createPinsApi(getSessionToken, fetch, API_URL)` factory.
- **Store injection pattern:** `apps/mobile/src/store/real-store.ts`:
  - `RealStoreDeps.pinsApi?: PinsApi` (line 170);
  - `pinsApi2(deps)` (lines 203-208) falls back to `createPinsApi(getSessionToken, fetch, API_URL)`;
  - add `mediaApi?` the same way. It is optional, so no test double breaks.
- **Trusted media:** the real store keeps `mediaToken` (`real-store.ts:373`, set at `:3038`). `trustedMediaHosts` and `isTrustedMediaUrl` are in `apps/mobile/src/lib/attachments.ts:122,147`. The sheet must never load an image from an untrusted host. Server-relative URLs (`/api/...`) must be resolved against `API_URL`; this is a pitfall in `AGENTS.md`.
- **ChatStore implementations:** `apps/mobile/src/store/types.ts` (interface), `store/chat-store.ts` (mock) and `store/real-store.ts`. These are the only ones (`grep -rln "retrySticker:" apps/mobile/src`).
- **Header:** `apps/mobile/src/components/chat/chat-header.tsx`:
  - props at lines 17-29;
  - the search `IconButton label="Search in chat"` at about line 121, with icons from `lucide-react-native` and `iconColor`.
  - Add an optional `onOpenMedia?: () => void` that renders an `IconButton label="Media, files and links"` with the `Images` icon, just before Search.
- **Chat screen:** `apps/mobile/src/app/chat/[id].tsx`:
  - `ChatHeader` is rendered at lines ~478, ~625 and ~768;
  - the jump pattern is `jumpToPin` (lines 339-348): if the id is in `loadedMessageIds`, then `setJumpToMessageId(id)`, else `setJumpError('Message not found')`.
  - **T-0435 is also editing this file** (the forward sheet). Keep your edits to: the state line, the `onOpenMedia` prop on the three headers, and one sheet render per layout. Do not reformat other code.
- **Kit:**
  - `BottomSheet` (`components/ui/bottom-sheet.tsx:9-17`);
  - `SegmentedControl` (`components/ui/segmented-control.tsx`);
  - `StateMessage` (`components/ui/state-message.tsx`: `kind`, `title`, `hint?`, `action?: { label, onPress }`, `size?`);
  - `Button` (labels inside `<Text>`).
- **Mobile tests** render static markup with mocks: `apps/mobile/src/components/ais/ai-activity.test.tsx:20-41`. API tests follow `apps/mobile/src/lib/pins-api.test.ts`.

### What to build
1. **New `apps/mobile/src/lib/media-api.ts`:** types `MediaTab`, `MediaItem` and `MediaPage`, a guard `parseMediaItem` (drops malformed rows), and `createMediaApi(getSessionToken, fetchImpl, apiUrl)` → `listChatMedia({ chat, type, before?, limit? })`.
2. **Store:**
   - `types.ts`: `loadChatMedia: (chatId: string, tab: MediaTab, before?: string) => Promise<MediaPage>`;
   - **real store:** call the injected `mediaApi`. Resolve relative `url`s against `API_URL`. Then drop the `url` of `image` and `gif` items unless they are trusted (with no token, drop it);
   - **mock store:** build the pages from the mock messages of that chat (image → media, files → files, voice → voice, `https?://` in text → links), newest first, with `next: null`.
3. **New `apps/mobile/src/components/chat/media-sheet.tsx`:** export `MediaSheet({ chatId, title, onClose, onJump })` on `BottomSheet`, with the title "Media, files and links".
   - A `SegmentedControl` with Media, Files, Links and Voice; it loads on open and when the tab changes.
   - **Media:** a 3-column grid of `Image` thumbnails for items with a `url`; an item with no `url` shows a file row.
   - **Files:** name, size and date. **Links:** host and URL; tapping opens it with `Linking.openURL`, http(s) only. **Voice:** duration, sender and date.
   - Each row has a "Show in chat" action → `onJump(messageId)`, then `onClose()`.
   - A "Load more" Button uses `next`.
   - **States:** `StateMessage` loading; error with Retry; and an empty message per tab ("No media yet", "No files yet", "No links yet", "No voice messages yet").
   - Also export pure helpers for tests: `formatMediaSize(bytes)` and `formatDuration(ms)`, unless chat-core already exports one; then reuse it.
4. **`chat-header.tsx`:** the optional `onOpenMedia` button.
5. **`[id].tsx`:** `const [mediaOpen, setMediaOpen] = useState(false)`. Pass `onOpenMedia={() => setMediaOpen(true)}` to the three headers, and render `<MediaSheet … onJump={jumpToMessage} />` while it is open. `jumpToMessage` is the same logic as `jumpToPin`, applied to an id; reuse it by extracting a small `jumpTo(messageId)` that `jumpToPin` also calls.
6. **Tests:**
   - **new `apps/mobile/src/lib/media-api.test.ts`:** the query string, the parsing, and malformed rows dropped;
   - **new `apps/mobile/src/components/chat/media-sheet.test.tsx`:** the static render of each tab's empty state; the helpers;
   - **new `apps/mobile/src/store/real-store.media.test.ts`:** an untrusted image URL is dropped, a trusted one is kept, and a relative URL is resolved;
   - **`apps/mobile/src/store/chat-store.test.ts`:** the mock returns an image item for the Ana chat.

### Read first
`AGENTS.md`, `docs/audit/media-gallery-plan.md` §3b and §4 Task 3, `apps/server/src/media/routes.ts`, `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/pins-api.test.ts`, `apps/mobile/src/lib/attachments.ts:110-160`, `apps/mobile/src/store/real-store.ts:160-210` and `:365-380`, `apps/mobile/src/components/chat/chat-header.tsx`, `apps/mobile/src/app/chat/[id].tsx:150-170` and `:335-350` and `:470-500`.

### Allowed files
`apps/mobile/src/lib/media-api.ts`, `apps/mobile/src/lib/media-api.test.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/store/chat-store.test.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/real-store.media.test.ts`, `apps/mobile/src/components/chat/media-sheet.tsx`, `apps/mobile/src/components/chat/media-sheet.test.tsx`, `apps/mobile/src/components/chat/chat-header.tsx`, `apps/mobile/src/app/chat/[id].tsx`, `work/T-0436-mobile-media-sheet.md`. Added by the lead, mocks only: `apps/mobile/src/lib/chat-header.test.tsx`.

If a test outside these breaks through an import (for example a chat-header test missing the `Images` icon mock), stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot media-api media-sheet real-store.media chat-store.test
pnpm gate
```

### Acceptance
- The header button opens the media sheet in every chat.
- Each tab lists its items, pages with Load more, and jumps to a loaded message (or shows "Message not found").
- No untrusted image is ever loaded.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

- **`apps/mobile/src/lib/media-api.ts`** (new): `MediaTab`, `MediaKind`, `MediaItem`, `MediaPage`, `MediaApi`, `MediaApiError`, `parseMediaItem` (drops malformed rows and only copies optional fields of the right shape) and `createMediaApi(getToken, fetchImpl, apiUrl)` → `listChatMedia({ chat, type, before?, limit? })`. It pages `GET /api/media` exactly like the server expects (`chat`, `type`, `before`, `limit`); malformed rows are filtered, `next` is a string or `null`.
- **Store**:
  - `types.ts`: added `loadChatMedia(chatId, tab, before?) => Promise<MediaPage>` to `ChatStoreState`.
  - `chat-store.ts` (mock): builds a page from the chat's own messages, newest first — image (or image attachment) → media, file attachment → files, voice payload → voice, each `http(s)` URL in a text body (via chat-core `splitLinks`) → one link row; `next` is always `null`. Retracted messages are skipped.
  - `real-store.ts`: added the optional `mediaApi` dep plus `mediaApi2` (falls back to `createMediaApi(getSessionToken, fetch, API_URL)`), resolves a server-relative `url` against `API_URL`, and drops the `url` of `image`/`gif` rows whose host is not in `mediaTrustedHosts` (no token → nothing is trusted). Files and voice keep their URL. Done through a `sanitizeMediaItem` helper inside the store, reusing the existing `isTrustedMediaUrl`.
- **`apps/mobile/src/components/chat/media-sheet.tsx`** (new): `MediaSheet({ chatId, title?, onClose, onJump })` on `BottomSheet` (title "Media, files and links"). It owns the load (on mount and on tab change, ignoring stale results), a `SegmentedControl` (Media/Files/Links/Voice), a 3-column `Image` grid (no-url rows fall back to a file row), Files/Links/Voice rows, a "Show in chat" action per row (jump then close), a "Load more" button using `next`, and the loading/error-with-Retry/per-tab-empty states. Links open with `Linking.openURL` only for `http(s)`. It also exports the pure `MediaSheetContent`, `formatMediaSize`, the reused `formatDuration` (from `@zilar/chat-core`) and `MEDIA_EMPTY_TEXT` for tests.
- **`chat-header.tsx`**: optional `onOpenMedia` renders an `Images` `IconButton` labelled "Media, files and links" just before Search.
- **`app/chat/[id].tsx`**: added `mediaOpen` state, passed `onOpenMedia` to all three headers, rendered `MediaSheet` once per layout while open, and extracted `jumpTo(messageId)` so `jumpToPin` and the sheet share the same jump logic.
- **Tests**: `media-api.test.ts` (query string, parsing, malformed rows dropped, 401), `media-sheet.test.tsx` (per-tab empty states, loading, a file row, Load more visibility, size/duration helpers), `real-store.media.test.ts` (untrusted dropped, trusted kept, relative resolved, cursor/paging, file URL kept), and a new case in `chat-store.test.ts` for the mock page builder.

### Commands and real results

- `pnpm install` — done (only a pre-existing `@types/react` peer warning).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot media-api media-sheet real-store.media chat-store.test` — **4 files passed, 54 tests passed**.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot lib/chat-header` — **1 file passed, 4 tests passed** (the new optional `Images` icon does not break it: the button only renders when `onOpenMedia` is passed).
- `pnpm gate` (final) — summary lines:
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (15.5s)
  PASS  lint  (0.5s)
  PASS  typecheck  (8.3s)
  PASS  tests @zilar/mobile  (5.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (The timings are from the last full run; the final confirmation run after the Report edit is identical apart from minor timing.)

### Deviations from the spec

- The spec's mock test bullet said "the mock returns an image item for the Ana chat". The `ana` mock messages (`apps/mobile/src/mock/messages.ts`) carry no image, voice or link, and that file is **not** in the Allowed files, so I could not add one. I tested the real image/voice/link data instead (the `viernes` chat for the image and voice, `marketing-ai` for the link) and asserted Ana's tabs are empty. This is the only deviation; the mock builder itself matches the spec.
- `formatDuration` already exists in `@zilar/chat-core`, so per the spec I reused it and re-exported it from `media-sheet.tsx`; only `formatMediaSize` is new.

### Notes / open questions

- None. Trusted-host handling lives in the store (as specified), so the sheet never even receives an untrusted image URL.
- The connected `MediaSheet` follows the `AiActivity` effect pattern (async setState only) to satisfy the repo's `react(set-state-in-effect)` lint rule; `MediaSheetContent` is the pure, tested view.

## Review (written by Claude)

Approved (lead, 2026-10-06). The chat header opens a media sheet with Media / Files / Links / Voice tabs fed by GET /api/media (lib/media-api.ts, the store's loadChatMedia with the trust drop for untrusted image URLs, real and mock). It has paging, retry and per-tab empty states; tapping a row shows the message in the chat. Not checked on the emulator yet (smoke skips [id]); queued for QA. Nits for a later pass: the grid renders <Image> for any item with a url (mock gradient: URIs, non-image kinds), rowKey can repeat when one message links the same URL twice, and parseMediaItem keeps an invalid at date.
