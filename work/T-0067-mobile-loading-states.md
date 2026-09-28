---
id: T-0067
title: Mobile loading is not empty — chat list and chat history show skeletons until loaded, inline errors with Retry, and a reopened chat loads its history
status: todo
milestone: M2
branch: task/T-0067-mobile-loading-states
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0042, T-0056]
estimate: 1.5 days
---

# T-0067: Mobile loading states

## Spec (written by Claude, do not edit)

### Goal

T-0042 fixed two bugs on the web: a reloaded chat showed up empty, and "No chats yet" flashed before the real list arrived. The mobile app has the same class of bug (listed on the board as a follow-up):
- The chat list shows "No chats found" until the chats arrive, and forever if loading them failed.
- A chat opened before the XMPP core is ready may never load its history (`openHistory` returns silently when `core` or the chat is missing, and nothing retries).
- A chat with no messages yet looks the same as a chat still loading.

The rule to apply everywhere: **"loading", "error" and "empty" are three different states.** Show a quiet loading state until data has actually arrived, an inline error with **Retry** when loading failed, and an empty state only once you know it is empty.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0042-web-loading-states.md`, especially its **Review** (the live bugs the fakes hid: `core` assigned before `connect()` resolves, a MAM query sent while still connecting fails, skeleton flashes on fast loads) and the web implementation to port the ideas from (don't import from `apps/web`): `apps/web/src/store/realStore.ts` (`chatsLoad`, `historyLoad`, pending-open flushed on ready and reconnect), `components/Skeleton.tsx`, `ChatList.tsx`, `MessageList.tsx`
- Mobile: `src/store/types.ts` (`ChatStoreState`), `real-store.ts` (`openHistory` around line 860, `loadOlder`, `start`, `status`, how chats load), `chat-store.ts` (the mock store implements the same interface), `src/app/index.tsx` (the list and its empty component), `src/app/chat/[id].tsx`, `src/components/chat/message-list.tsx`
- `docs/design/ui-style.md` §5 (empty states) and §6 (motion; honor reduced motion)

### Allowed files (under `apps/mobile/`)
- `src/store/types.ts`, `real-store.ts`, `chat-store.ts`, plus their tests
- `src/app/index.tsx`, `src/app/chat/[id].tsx`
- `src/components/chat/message-list.tsx`, `skeleton.tsx` (new), `load-error.tsx` (new), plus tests
- `src/mock/**` (a slow-load and an error scenario for screenshots)
- `screenshots/T-0067/**`
- `work/T-0067-mobile-loading-states.md`

**Not allowed:** `message-bubble.tsx` and `chat-list-item.tsx` (another task, T-0064, edits them), `apps/web/**`, `apps/server/**`, `packages/**`, `docs/**`. No new dependencies.

### What to build

1. **Store state.** Add to `ChatStoreState`:
   - `chatsLoad: 'loading' | 'loaded' | 'error'` (the first chat-list load; `error` keeps any chats already shown), and `reloadChats(): void`;
   - `historyLoad: Record<string, 'loading' | 'loaded' | 'error'>` per chat id, and `retryHistory(chatId): void`.
   Both stores implement it. The mock store is `loaded` immediately, except in the mock scenarios below.
2. **Verify the causes first, with a failing test each:**
   - `openChat` called **before** the core is ready or before the chat exists in `chats` loads nothing today. Fix it the way the web did: remember the pending open, and flush it on `ready` and after a reconnect; never query MAM while the core is still connecting.
   - A failed history or chat-list request must land in `error`, not stay `loading` and not become "empty".
3. **Chat list (`app/index.tsx`).**
   - `loading` with no chats: 6 skeleton rows (52 px avatar circle, two text bars) in the well/hairline style; **no** skeleton for a load under ~250 ms (delay showing it, so a fast load doesn't flash).
   - `error` with no chats: a centered message "Couldn't load your chats" with a **Retry** key (the raised icon-button/segment recipe from `src/lib/depth.ts`); `error` with chats already shown: a thin inline banner with Retry above the list.
   - `loaded` and no chats: the existing empty text. A search with no matches keeps "No chats found" (that is a genuine empty result); the true empty state (zero chats at all) says "No chats yet" with the same style.
   - Pull-to-refresh calls `reloadChats`.
4. **Chat screen (`message-list.tsx`, `[id].tsx`).**
   - History `loading` with no messages: skeleton bubbles (alternating sides), same 250 ms delay.
   - `error`: inline "Couldn't load messages" + Retry (`retryHistory`).
   - `loaded` with no messages: a centered "No messages yet" in muted text (new; today an empty chat is just blank).
   - Older-page loading (`loadOlder`) keeps its current behavior; a small spinner at the top while it loads is welcome, but optional.
5. **Reduced motion:** the skeleton shimmer/pulse stops when the OS asks (use the same hook the other mobile animations use).
6. **Accessibility:** every Retry has an `accessibilityLabel` and `accessibilityRole="button"`; skeleton containers are `accessibilityElementsHidden`, with a single `accessibilityLabel="Loading chats"` / `"Loading messages"` live region.
7. **Mock scenarios** to screenshot: `?mock=1&load=slow`, `?mock=1&load=error`, `?mock=1&load=empty` (params read only through the existing mock gate `mockParamAllowed`, so production ignores them).

### Tests (Vitest, no network)
- Real store: open-before-ready flushes on ready; open-before-chat-exists flushes when the chat appears; a failed chats request → `error`, Retry → `loaded`; a failed history → `error`, `retryHistory` works; no MAM query while connecting; a reconnect re-flushes a pending open; `chatsLoad` never goes `loaded → loading` on a background refresh.
- **Make the fakes slow**: a deferred `connect()` and delayed API calls (playbook gotcha 19: instant fakes hid the web bug).
- Components: skeleton delay (fake timers: nothing before 250 ms, skeleton after, gone on load), error + Retry calls the store action, the three empty variants.

### Integration / visual check
- No host input automation. Do not touch Julio's simulators (`A3E0C081`, `DB167CD4`), Metro on 8081, or ports 3000/3188/5173. Use the `boot:ios` flow (`apps/mobile/README.md`) with its own Metro if you need a simulator, and stop it at the end.
- Screenshots (max ~8, downscaled with `sips -Z 900` before viewing; a session can hold at most 30 images): list skeleton, list error, list empty, chat skeleton, chat error, chat "No messages yet". Save to `screenshots/T-0067/`. If a simulator run is impossible, say so in the Report and do not fake screenshots.

### Acceptance criteria
- [ ] The cold-start list never shows "No chats yet" before the load finishes.
- [ ] A chat opened before the core is ready loads its history once it is.
- [ ] Load failures show Retry, and Retry recovers.
- [ ] Reduced motion stops the skeleton animation.
- [ ] No `any`, no `@ts-ignore`, no new dependencies.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Out of scope
- Web, server, the message bubble, list rows, pagination redesign, offline cache.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
