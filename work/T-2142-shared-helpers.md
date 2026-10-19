---
id: T-2142
title: "Share (web + phone): the small sticker, GIF and duration helpers both apps keep their own copy of move into chat-core/client-core; phone contacts uses useApi so the old useMockableApi goes; one stale comment fixed — no behaviour change"
status: merged
milestone: M5
branch: task/T-2142-shared-helpers
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2142: One copy of the small helpers both apps keep

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: web and phone share code; fewer lines. The lead found these same-named helpers in both apps at `d2ebd6afd`:

| Helper | Phone | Web | Already shared? |
| --- | --- | --- | --- |
| `stickerPackUrl`, `stickerPackUrlText` | `apps/mobile/src/lib/stickers.ts:82,86` | `apps/web/src/components/sticker/pageActions.ts:36,40` | no |
| `isSameOriginStickerUrl` | `apps/mobile/src/lib/stickers.ts:57` | `apps/web/src/lib/stickers.ts:65` | `packages/chat-core/src/sticker-recents.ts:87` has `isStickerFileUrl` |
| `isPanelStickerUrl` | `apps/mobile/src/components/chat/sticker-panel.tsx:55` | `apps/web/src/lib/stickers.ts:74` | no |
| `readRecentStickers` | `apps/mobile/src/lib/stickers.ts:92` | `apps/web/src/lib/stickers.ts:21` | `parseRecentStickers` in `packages/chat-core/src/sticker-recents.ts:48` |
| `readStoredRecents` | `apps/mobile/src/lib/stickers-storage.ts:48` | `apps/web/src/components/sticker/StickerThumb.tsx:58` | as above |
| `gifsAvailability` | `apps/mobile/src/lib/gifs.ts:42` | `apps/web/src/components/GifPanel.tsx:44` | no |
| `isGifVideoAttachment` | `apps/mobile/src/lib/attachments.ts:80` | `apps/web/src/components/GifMessage.tsx:65` | no |
| `formatDuration` | `apps/mobile/src/components/chat/attach/gallery-grid.tsx:14` (seconds, `h:mm:ss` past an hour) | `apps/web/src/components/media/mediaModel.ts:25` (ms or `undefined` → `''`) | `packages/chat-core/src/format.ts:52` (ms → `m:ss`) |
| `useBlockedJids` | `apps/mobile/src/lib/blocked-users.ts:66` | `apps/web/src/lib/blockedJids.ts:78` | no |

### Steps
1. **Compare each pair.** Where the logic is the same apart from storage or transport, move the pure part into `packages/chat-core/src/` (no React, no I/O), or into `packages/client-core/src/` if it is a hook. Use an existing file (`sticker-recents.ts`, `stickers.ts`, `format.ts`) before adding one. Both apps then import it.
2. **Platform differences stay.** The storage call, `localStorage` vs the phone's storage, stays in the app; only the parsing or rule is shared.
3. **Skip** a pair whose logic really differs, and say why in the Report. For example, keep the phone's `h:mm:ss` duration unless the shared one can take an option without making the sum longer.
4. **Phone contacts on `useApi`.** Make `apps/mobile/src/components/contacts/use-contacts-api.ts` use `useApi` from `apps/mobile/src/lib/use-mockable-api.ts`, the way T-2134 did for the other areas:
   - `createContactsApi` in `apps/mobile/src/lib/contacts-api.ts:44` becomes a module-level `make` function, for example `makePhoneContactsApi(call)`;
   - callers keep `useContactsApi()` or call `useApi(...)` directly, whichever is fewer lines;
   - then delete `useMockableApi`, which has no other user, from `apps/mobile/src/lib/use-mockable-api.ts`.
5. **One stale comment.** `apps/web/src/components/ApprovalCard.tsx:336` says "The id or the reset key changed", but the reset key no longer exists. Make it say the request id changed.

### Rules
- No behaviour change: the same URLs, the same stored keys, the same text.
- No new tests. Existing tests of moved helpers move with them (for example, into `packages/chat-core/src/*.test.ts`) and keep their cases.
- Product lines go down by at least 40.

### Allowed files
- `apps/mobile/src/lib/stickers.ts`
- `apps/mobile/src/lib/stickers-storage.ts`
- `apps/mobile/src/components/chat/sticker-panel.tsx`
- `apps/mobile/src/lib/gifs.ts`
- `apps/mobile/src/lib/attachments.ts`
- `apps/mobile/src/components/chat/attach/gallery-grid.tsx`
- `apps/mobile/src/lib/blocked-users.ts`
- `apps/mobile/src/lib/contacts-api.ts`
- `apps/mobile/src/components/contacts/use-contacts-api.ts`
- `apps/mobile/src/lib/use-mockable-api.ts`
- `apps/web/src/components/sticker/pageActions.ts`
- `apps/web/src/lib/stickers.ts`
- `apps/web/src/components/sticker/StickerThumb.tsx`
- `apps/web/src/components/GifPanel.tsx`
- `apps/web/src/components/GifMessage.tsx`
- `apps/web/src/components/media/mediaModel.ts`
- `apps/web/src/lib/blockedJids.ts`
- `apps/web/src/components/ApprovalCard.tsx`
- `packages/chat-core/src/sticker-recents.ts`
- `packages/chat-core/src/stickers.ts`
- `packages/chat-core/src/format.ts`
- `packages/chat-core/src/index.ts`
- `packages/chat-core/src/gifs.ts` (new, only if needed)
- `packages/client-core/src/blocked-jids.ts` (new, only if `useBlockedJids` is shared)
- `packages/client-core/src/index.ts`
- `packages/chat-core/src/sticker-recents.test.ts`
- The importers below may change only an import line:
- `apps/mobile/src/app/(tabs)/index.tsx`
- `apps/mobile/src/app/(tabs)/settings.tsx`
- `apps/mobile/src/app/settings/blocked.tsx`
- `apps/mobile/src/app/settings/contacts.tsx`
- `apps/mobile/src/app/settings/requests.tsx`
- `apps/mobile/src/app/settings/sticker-pack.tsx`
- `apps/mobile/src/app/settings/stickers.tsx`
- `apps/mobile/src/app/stickers/[packId].tsx`
- `apps/mobile/src/app/u/[handle].tsx`
- `apps/mobile/src/components/chat/attachment-body.tsx`
- `apps/mobile/src/components/chat/chat-list-item.tsx`
- `apps/mobile/src/components/chat/chat-rows.tsx`
- `apps/mobile/src/components/chat/composer-sheet.ts`
- `apps/mobile/src/components/chat/gif-panel.tsx`
- `apps/mobile/src/components/chat/media-bubble.tsx`
- `apps/mobile/src/components/chat/media-rows.tsx`
- `apps/mobile/src/components/chat/media-sheet.tsx`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/components/chat/request-rows.tsx`
- `apps/mobile/src/components/chat/topic-row.tsx`
- `apps/mobile/src/components/chat/voice-message-bars.tsx`
- `apps/mobile/src/components/stickers/pack-card.tsx`
- `apps/mobile/src/components/stickers/pack-grid.tsx`
- `apps/mobile/src/components/stickers/pack-sheet.tsx`
- `apps/web/src/components/chatList/GroupHeaderRow.tsx`
- `apps/web/src/components/ChatListItem.tsx`
- `apps/web/src/components/composer/ComposerControls.tsx`
- `apps/web/src/components/ContactPanel.tsx`
- `apps/web/src/components/media/MediaBody.tsx`
- `apps/web/src/components/message/bubbleFlags.ts`
- `apps/web/src/components/MessageList.tsx`
- `apps/web/src/components/sticker/PackRows.tsx`
- `apps/web/src/components/StickerMessage.tsx`
- `apps/web/src/components/StickerPanel.tsx`
- `apps/web/src/components/VoiceMessage.tsx`
- `apps/web/src/routes/StickerPackPage.tsx`
- `work/T-2142-shared-helpers.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down by at least 40.
- The Report lists each pair: shared (lines saved) or skipped (why).
- **Lead check:**
  - web mock: the sticker panel (recents), a sticker pack's share link, the GIF panel, a GIF message, shared media durations, a blocked person's messages hidden;
  - phone smoke: the same plus `/settings/contacts`.

---

## Report (written by the worker when done)

### What I did

Shared the helpers both apps kept, keeping storage, transport and platform triggers in the app:

| Pair | Result |
| --- | --- |
| `stickerPackUrl`, `stickerPackUrlText` | Skipped. Only the path template is common; web builds it from `window.location.origin`/`host` and phone from the fixed `chat.zilar.app` host, so a shared builder plus two wrappers would add lines, not remove them. |
| `isSameOriginStickerUrl` | Shared. Both apps already used `isStickerFileUrl`; web's extra wrapper (with its own `window.location` resolution and fallback) is deleted and `StickerMessage`, `StickerThumb` and `StickerPanel` call the shared rule with `window.location.origin`. Phone keeps its 3-line wrapper because it resolves `API_URL` through `parseUrl`. |
| `isPanelStickerUrl` | Shared. Deleted both local copies: web calls `isStickerFileUrl(url, window.location.origin)`, phone calls its existing `isSameOriginStickerUrl(url, API_URL)`. |
| `readRecentStickers` | Skipped. Web reads `localStorage` and parses; phone parses a raw string and adds the default sticker size. The parsing is already shared in `parseRecentStickers`, and the storage call belongs to the app. |
| `readStoredRecents` | Skipped, same reason: browser `localStorage` is synchronous, the phone storage backend is async (and wrapped in `Effect`). |
| `gifsAvailability` | Shared in the new `packages/chat-core/src/gifs.ts` (get/set/reset over one module cache). Phone's `lib/gifs.ts` re-exports it for existing importers; `GifPanel` uses it instead of its own copy. |
| `isGifVideoAttachment` | Shared in `chat-core/src/gifs.ts`. The shared rule keeps the browser's extra trust for a relative `/api/` path behind `allowApiPath` (web passes `true`, phone keeps the default `false`), so neither app's rule changed. |
| `formatDuration` | Shared. Web's media model keeps its `undefined`/non-finite guard and delegates to the existing `chat-core` `formatDuration(ms)`. Phone's gallery calls the same function with the new `{ hours: true }` option, so `h:mm:ss` past an hour is unchanged. |
| `useBlockedJids` | Shared as `makeBlockedJidsStore` in `packages/client-core/src/blocked-jids.ts` (module set, once-only load, last-good-set on failure, `useSyncExternalStore`). Web supplies `listBlockedUsers` + window focus; phone supplies `ContactsApi.listBlockedUsers` + `AppState`. `filterBlockedMessages` stays phone-only. |

Also:
- `apps/mobile/src/components/contacts/use-contacts-api.ts` now uses `useApi(makePhoneContactsApi)`. `createContactsApi` became the module-level `makePhoneContactsApi(call)` in `apps/mobile/src/lib/contacts-api.ts`, and `useMockableApi` was deleted from `apps/mobile/src/lib/use-mockable-api.ts` (it had no other user).
- `apps/web/src/components/ApprovalCard.tsx:336` now says "The request id changed".
- Product lines: +215 / −328 on source and package files, net −113 (excluding the task file).

Files changed: the mobile lib/component files, web lib/component files, `packages/chat-core/src/{gifs.ts,format.ts,index.ts}`, `packages/client-core/src/{blocked-jids.ts,index.ts}` and this task file, all inside Allowed files.

### Checks run

Single test files while working:
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/sticker-recents.test.ts src/media.test.ts src/format-duration.test.ts` → 3 files, 14 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/attachments.test.ts` → 1 file, 4 tests passed.

`pnpm gate` (23 changed files against main):
```text
PASS  install (frozen)  (2.0s)
PASS  format  (0.7s)
PASS  lint  (0.7s)
PASS  typecheck  (4.8s)
PASS  effect  (1.5s)
PASS  build @zilar/server  (0.5s)
PASS  tests @zilar/chat-core  (2.8s)
PASS  tests @zilar/client-core  (6.3s)
PASS  tests @zilar/mobile  (2.8s)
PASS  tests @zilar/web  (7.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
WARN  size: apps/web/src/components/ApprovalCard.tsx: 411 lines (main 411); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
WARN  size: apps/web/src/components/StickerPanel.tsx: 531 lines (main 530); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Notes for the lead

- No UI smoke run by me (no simulator/browser session); the acceptance checks are yours. The web mock paths touched are the sticker panel recents/thumbnails, pack share links, GIF panel/messages, media durations and blocked messages; phone additionally `/settings/contacts`.
- `readStoredRecents` is still defined in both apps because it is the storage boundary; if you want that gone too, it needs a shared storage interface, which the spec put out of scope.
- `resetBlockedJidsForTests` and `blockedJidsSnapshot` have no callers on this branch; I kept them on the shared store instead of deleting public test helpers.

## Review (written by Claude)

Approved; the pre-review was clean (3 nits). Net −113. What moved into the packages:
- The sticker URL rule and the GIF helpers (`gifsAvailability`, `isGifVideoAttachment` with `allowApiPath` for web) now live in chat-core.
- One `formatDuration` with a `{hours}` option.
- One `makeBlockedJidsStore` in client-core, which each app feeds with its own API and refresh trigger.
- Phone contacts is on `useApi`, and `useMockableApi` is gone.

**Skips:** the four skips are sound (storage that differs per app, and host-specific pack URLs).

**Nits:** the dead re-exports `resetGifsAvailability` and `blockedJidsSnapshot` go in the next dead-export task.

**Web mock:**
- The sticker tab shows 19 images, and the GIF tab shows "Powered by Giphy".
- Media → Voice shows 0:12.
- Block flips to Unblock.
- Blocking hides nothing in a group, which is the same on main.

**Phone emulator:**
- The smoke passed: Ana's chat, `/settings/blocked`, `/settings/contacts`, `/settings/stickers`.
- The sticker panel lists packs, and GIFs shows search.
- The gallery shows video durations.
- Blocking Marta shows Unblock on the profile and puts Marta in the blocked list.
