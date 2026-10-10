---
id: T-0901
title: "Sign-out clears the user's chat state: no chats, contacts, messages or profile of the previous user survive into the next sign-in on the same device (mobile, check web)"
status: todo
milestone: M5
branch: task/T-0901-mobile-sign-out-state
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0901: Sign-out clears the user's chat state

## Spec (written by Claude, do not edit)

### Why
`docs/STORE_CORE_PLAN.md` section 7 flags this, and the lead confirmed it in the code on 2026-10-10. On mobile, signing out and signing in as a different user on the same phone can show the first user's data to the second:
- The provider keeps one store instance for the app's life (`apps/mobile/src/store/chat-store-provider.tsx:64-85`). It calls `start()` when the session becomes authenticated, and `stop()` in the effect cleanup.
- `stop()`'s `teardown()` (`apps/mobile/src/store/real-store.ts:1757-1773`) clears drafts, edits, reactions and the per-session maps. It keeps `chats`, `contacts`, `messagesByChat`, `me`, `historyComplete`, `historyLoad`, `activeChatId`, `typing`, `folders`, `ownedAis`, `editTarget`, `actionError` and the cursors.
- The next boot (`apps/mobile/src/store/effects/lifecycle.ts:95-112`) replaces `me`, `chats` and `contacts` only after the loads finish. Until then the first user's chat list is still in state.
- `messagesByChat` is keyed by chat id (the peer JID for DMs), so the second user's DM with the same peer would start from the first user's messages. History loads merge into that list (`apps/mobile/src/store/effects/history.ts:327,383`).

### What to build
1. **Tests first.** Add a new test file, `apps/mobile/src/store/real-store.sign-out.test.ts`, built on the existing store test fakes (see `apps/mobile/src/store/real-store.test.ts` and the T-0884 helpers). Commit it before the fix, failing:
   - user A boots, loads chats and contacts, and opens a DM with peer P (history loaded);
   - `stop()` runs;
   - immediately after `stop()`, the state holds none of A's user-scoped data: chats, contacts, messages, `me`, `currentUserId`, history flags, cursors, active chat, folders, owned AIs, typing, the edit target and the action error;
   - user B boots with a DM with the same peer P: B's state never contains A's messages with P, neither while loading nor after B's history loads.
2. **The fix:** `stop()` resets every user-scoped field to its initial value, the same values `createRealChatStore` starts with (`real-store.ts:1775-1800`), and clears the closure caches that hold user data (cursors, `lastRead`, chat-pref rows, group id caches). Keep one source of truth for the initial values, not a second hand-written copy. `status` stays `offline`.
   - **Check what else calls `stop()`.** If anything other than sign-out calls it (for example an AppState pause or a token refresh), the reset must not blank the screen during a normal resume. Prove it with the existing resume and lifecycle tests, and say what you found.
3. **Web:** check whether the same bug exists. Find what sign-out does on web: a full page navigation gives a fresh store, while an in-app route change keeps it. If web keeps the store, apply the same fix and add `apps/web/src/store/signOut.test.tsx`. If it cannot happen on web, say why in the Report, with `file:line`.
4. **Other caches:** check the mobile persisted caches (async storage: chat list cache, drafts, prefs) for the same leak, and clear user-scoped keys on sign-out if they are not already keyed by user. Report each with `file:line`.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0901/`), `docs/STORE_CORE_PLAN.md` sections 3 and 7, the mobile store (`apps/mobile/src/store/real-store.ts`, `effects/lifecycle.ts`, `chat-store-provider.tsx`), and the mobile sign-out flow (`apps/mobile/src/lib/auth.ts:136` and its callers).

### Allowed files
`apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/lifecycle.ts`, `apps/mobile/src/store/effects/runtime.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `apps/mobile/src/store/real-store.sign-out.test.ts`, `apps/mobile/src/lib/**` (only for clearing user-scoped persisted caches), `apps/web/src/store/**` (only if web has the bug), `apps/web/src/store/signOut.test.tsx`, `work/T-0901-mobile-sign-out-state.md`.

Do not edit the helpers at `real-store.ts:80-163` and `:924-1008`, or `apps/mobile/src/store/effects/polling.ts`: T-0902 moves them in parallel.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/web typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the mobile store tests 3 times, because they involve timers.

### Acceptance
- The new test fails before the fix and passes after, in two commits.
- No existing store test is edited.
- The Report says what calls `stop()`, the web verdict, and every persisted cache checked.
- Live check for Julio: sign out, then sign in as another user on the same phone, and see none of the first user's chats.

---

## Report (written by the worker when done)

## Review (written by Claude)
