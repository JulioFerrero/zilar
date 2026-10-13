---
id: T-1294
title: "Mobile cold start: the chat list paints from a saved cache before /api/chats answers, and the root no longer blocks on every font (PERF-12); list images set a recyclingKey so a recycled row never flashes the previous image (PERF-15)"
status: merged
milestone: M5
branch: task/T-1294-mobile-cold-start
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1294: Mobile cold start and image recycling

## Spec (written by Claude, do not edit)

### Why
`docs/audit/performance-audit.md`:
- **PERF-12** (P2, `:135`): on a cold start the root waits for five fonts (`apps/mobile/src/app/_layout.tsx`, `return null` until loaded). The store then boots with no chat-list cache: `apps/mobile/src/store/effects/lifecycle.ts` has `saveChatList: () => {}`, so the first list paint waits for `/api/chats`. Web paints from `apps/web/src/store/chatListCache.ts`.
- **PERF-15** (P3, `:151`): list images (`expo-image` in the message bubble content and the GIF cells) have no `recyclingKey`, so a recycled row briefly shows the previous image.

**First recheck both findings on main.** If one is already fixed, say so with `file:line` and skip it.

### What to build
1. **The chat-list cache:**
   - implement mobile `saveChatList` and a load at boot, the same shape as web's cache (`apps/web/src/store/chatListCache.ts`), stored with the storage the app already uses for small data (cite it; no new dependency);
   - clear it on sign-out;
   - never store message bodies beyond the preview the web cache stores.
2. **Fonts:** render the app as soon as the primary text font is loaded (or after a 1 s cap). Secondary fonts load in the background. Cite which font is primary.
3. **PERF-15:** set `recyclingKey` to the message or image id on list images.
4. **No tests** (UI and boot).

### Read first
`AGENTS.md`, `docs/audit/performance-audit.md` (`:135-155`), `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/store/effects/lifecycle.ts` and `apps/web/src/store/chatListCache.ts`.

### Allowed files
`apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/store/**/*.ts`, `apps/mobile/src/lib/*.ts`, `apps/mobile/src/components/chat/*.tsx`, `work/T-1294-mobile-cold-start.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator mock:** a second cold start shows the chat list at once.

---

## Report (written by the worker when done)

### Findings recheck (against main, before editing)
- **PERF-12: confirmed.** `apps/mobile/src/app/_layout.tsx:56-77` gated the root on all five Geist faces with `return null` until `fontsLoaded`; `apps/mobile/src/store/effects/lifecycle.ts:166` had `saveChatList: () => {}` (no mobile cache).
- **PERF-15: confirmed.** No `recyclingKey` on any `expo-image` in `apps/mobile/src`.
- Line drift vs the audit: `message-bubble-content.tsx:143` is now the `DraftCaret`, not an `expo-image`. Today the message-list image is drawn by `attachment-message.tsx` (`AttachmentImage` → `expo-image`) and by the album tiles in `album-grid.tsx`; the named GIF cells are `gif-cells.tsx`. I set `recyclingKey` on those (plus the link-preview thumbnail, also rendered in the message list).

### What I did
1. **Chat-list cache (PERF-12).** New `apps/mobile/src/lib/chat-list-cache.ts`, the mobile twin of web's `apps/web/src/store/chatListCache.ts`: same schema (`version`/`userId`/`chats`), same passthrough decode, same dropped live fields (`online`, `onlineCount`, `lastSeenAt`), and the same `MAX_CACHED_CHATS = 200`. It stores only the chat summary and the message preview the web cache stores, never message bodies.
   - **Storage cited:** one JSON file at `<documents>/zilar-chat-list.json` via `expo-file-system/legacy`, the storage the app already uses for small per-device JSON (`lib/composer-drafts.ts:33-57`, `lib/voice-transcripts.ts:41-59`). No new dependency.
   - `lifecycle.ts` now wires it: `saveChatList` calls a local `saveChatListNow()` (writes only a fully `loaded` list), which the core calls after a connect (`lifecycle.ts:397`) and the AppState `background` hook calls too, the mobile twin of web's `pagehide`. `prepareStart` starts an async `readChatListCache()` and paints the chats + `chatsLoad: 'loaded'` before `/api/chats` answers, setting `cachedUserId`; the boot then replaces it with fresh data.
   - **Sign-out:** `stop()` (the mobile sign-out path; `chat-store-provider.tsx:129`) now calls `clearChatListCache()`, so one user's list never paints as another's.
2. **Fonts (PERF-12).** `_layout.tsx` now gates the first paint on the **primary text font `Geist_400Regular`** (`font-sans`, `apps/mobile/tailwind.config.js:72`; the body font, `components/ui/text.tsx:9`) or a 1 s cap (`FONT_READY_CAP_MS`). `Geist_500Medium`, `Geist_600SemiBold`, `GeistMono_400Regular`, `GeistMono_500Medium` are loaded by a second `useFonts` call in the background; the splash still hides when the root is ready.
3. **Image recycling (PERF-15).** `recyclingKey` set on the `expo-image` in `attachment-message.tsx` (`localUri ?? attachment.url`), `album-grid.tsx` (`photo.messageId`), `link-preview-card.tsx` (`image`) and `gif-cells.tsx` (`item.url`).
4. **No tests** written, as the spec says (UI and boot).

### Files changed (8, all inside Allowed files)
- `apps/mobile/src/lib/chat-list-cache.ts` (new)
- `apps/mobile/src/store/effects/lifecycle.ts`
- `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/components/chat/attachment-message.tsx`
- `apps/mobile/src/components/chat/album-grid.tsx`
- `apps/mobile/src/components/chat/link-preview-card.tsx`
- `apps/mobile/src/components/chat/gif-cells.tsx`
- `work/T-1294-mobile-cold-start.md`

### Commands and real results
- `pnpm install` → `Done in 25.9s` (added `turbo`, `typescript`, `vitest` per lockfile).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.lifecycle.test.ts src/store/real-store.sign-out.test.ts` → **2 files, 10 tests passed**.
- `pnpm gate` (repo root):

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (2.5s)
PASS  format  (1.0s)
PASS  lint  (1.6s)
PASS  typecheck  (6.1s)
PASS  effect  (1.9s)
PASS  tests @zilar/mobile  (4.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Deviations / notes
- Sign-out clearing lives in `lifecycle.stop()` (`.ts`). The app's other "forget user files on sign-out" hook is `chat-store-provider.tsx`, which is `.tsx` and outside Allowed files (`apps/mobile/src/store/**/*.ts`), so I did not touch it.
- I added `recyclingKey` to `album-grid.tsx` and `link-preview-card.tsx` beyond the two audit citations because they are the same kind of message-list `expo-image`; the two cited components no longer hold the image (`message-bubble-content.tsx` delegates to them).
- Could not verify the emulator acceptance (second cold start paints the list at once) here; that is the lead's emulator check. The gate covers types/lint/tests only.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 nit).**
- **Lead's check on the emulator mock:** the smoke passes. Mock mode serves chats locally, so the cache's speed-up can't be seen there; it shows only against the live server.
- **Lead's review of the diff:**
  - the cache is one JSON file through `expo-file-system/legacy`, holding chat summaries plus the preview only;
  - it paints only while `chats` is empty, and `/api/chats` replaces it;
  - it's saved on connect and when the app goes to the background, and cleared on sign-out;
  - list images get a `recyclingKey`.
- **Lead's checks after the rebase:** mobile tsc: 0 errors. `lifecycle.ts` is 307 lines.
- **Live check for Julio's phone:** a second cold start should show the chat list at once.
