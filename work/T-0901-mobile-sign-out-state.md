---
id: T-0901
title: "Sign-out clears the user's chat state: no chats, contacts, messages or profile of the previous user survive into the next sign-in on the same device (mobile, check web)"
status: merged
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
`apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/lifecycle.ts`, `apps/mobile/src/store/effects/runtime.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `apps/mobile/src/store/real-store.sign-out.test.ts`, `apps/mobile/src/lib/**` (only for clearing user-scoped persisted caches), `apps/web/src/store/**` (only if web has the bug), `apps/web/src/store/signOut.test.tsx`, `apps/mobile/src/store/effects/events.test.ts`, `apps/mobile/src/store/effects/send.test.ts` and `apps/mobile/src/store/real-store.voice.test.ts` (lead, round 1: one test each now pins its intent instead of state that survives `stop()`), `apps/web/src/test/**`, `apps/web/src/**/*.test.ts`, `apps/web/src/**/*.test.tsx`, `apps/mobile/src/test/**`, `apps/mobile/src/**/*.test.ts`, `apps/mobile/src/**/*.test.tsx`, `apps/server/src/test-support/**`, `apps/server/src/**/*.test.ts` and `work/T-0899-test-wait-helpers.md` (lead, round 2: carried by the merge of T-0899), `work/T-0901-mobile-sign-out-state.md`.

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

**Status: review, but 3 existing tests are red and I could not edit them. The lead must decide (see "Blocked / needs a decision").**

### What I did
- Commit 1 `bbfca30b`: `apps/mobile/src/store/real-store.sign-out.test.ts` (2 tests), failing on the old code.
- Commit 2 `aa09aa37`: `real-store.ts` has one `initialUserState()` (the single source of the initial values). The returned state spreads it, and `teardown()` (called by `stop()`) sets it again. `teardown()` also clears the closure caches that hold user data: `cursors`, `lastRead`, `chatPrefRows`, `groupIds`, `groupMembers`, `loadingOlder`, `pendingOutgoing`, `pendingVoices`. `status` stays `offline`.
- Commit 3: `clearTranscripts()` in `lib/voice-transcripts.ts`, called from `chat-store-provider.tsx` when the session status is `guest`; new test `lib/voice-transcripts.clear.test.ts` (2 tests).

### What calls stop()
Only `chat-store-provider.tsx:84`, the cleanup of the effect that depends on `[store, status]`. It runs when the status leaves `authenticated` (sign-out) or the provider unmounts. The auth status goes `loading` -> `authenticated`/`guest` once at boot (`auth/session-store.ts:89-120,149-153`) and never back to `loading`. AppState resume/pause goes through `reconnect` (`lifecycle.ts`), not `stop()`, so a normal resume does not blank the screen. The resume tests in `real-store.test.ts` pass.

### Web verdict: no bug
`signOutStore` (`apps/web/src/store/effects/lifecycle.ts:122-182`) already resets chats, contacts, messages, me, folders, drafts and so on, clears the chat list cache (`clearChatListCache`, also keyed by userId in `chatListCache.ts:46-64`), the last-read key and the owner cache. Then `goToLogin()` does `window.location.assign('/login')` (`ports.ts:262`), a full page load, so the next user gets a fresh store. No web change, no `signOut.test.tsx`.

### Persisted caches on mobile
- Session token: SecureStore, cleared on sign-out (`auth/secure-session-storage.ts:29`, `session-store.ts:149`). OK.
- Voice transcripts: file `Paths.document/voice-transcripts.json`, keyed by message id, not by user (`lib/voice-transcripts.ts:33-43`). This leaked plain text after sign-out. Now cleared (`clearTranscripts`).
- Sticker and emoji recents: memory backends only (`lib/stickers-storage.ts:36`, `lib/emoji-data.ts:391`); nothing in the app calls `setRecentsBackend`. They die with the process; not cleared on sign-out (they hold sticker ids and emoji only).
- Chat list cache, drafts, prefs: no AsyncStorage/MMKV use in `apps/mobile/src` (grep); they are in memory only, and now reset by `stop()`.
- `Paths.cache` / `FileSystem.cacheDirectory` downloads (GIFs, attachments, voice temp: `attachment-native.ts:331,488`, `voice-transcribe-flow.ts:130`): OS-managed cache, not cleared. Not changed; the lead may want a follow-up.

### Tests
- New: `real-store.sign-out.test.ts` 2 passed (failed before the fix); `voice-transcripts.clear.test.ts` 2 passed.
- `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store`, 3 runs: 305 passed + 3 failed, 305 + 3, and once 304 + 4 (`real-store.general-only` timing flake under load; it passes 3 of 3 alone).
- `src/lib/voice-transcripts*`: 14 passed. Mobile `typecheck`: clean. Web `src/store`: 214 passed, web typecheck clean. prettier and oxlint clean on my files.
- I did not run `pnpm gate` (wave mode).

### Blocked / needs a decision
Three existing tests encode "state survives `stop()`", which is the opposite of the spec, so they fail with the fix and I did not edit them:
1. `effects/events.test.ts:81` "stop ends a pending typing timer": expects `typing[ANA]` still `{ names: ['Ana'] }` after `stop()`.
2. `effects/send.test.ts:75` "stop interrupts a send in flight": expects `messages(ANA)` to be the same array after `stop()`.
3. `real-store.voice.test.ts:281` "an offline failure ends failed with the network reason": calls `stop()` and then `sendVoice(ANA)`; `sendVoice` looks the chat up in `chats` (`effects/send.ts:621`), which is now empty after `stop()`.
Each can be fixed by a one-line change (assert the timer/ack changed nothing, or send before a re-boot). Please authorise edits to these three tests, or tell me to change the design (for example reset in `start()` instead of `stop()`, which would break the "immediately after `stop()`" rule).

### Round 1 (lead authorised three test edits)
The three tests are now green; the "Blocked" section above is resolved.
1. `effects/events.test.ts` "stop ends a pending typing timer": asserts `typing` is `{}` after `stop()`, then subscribes and expects zero store writes after advancing `TYPING_CLEAR_MS * 2`. Reason: the intent is that no timer writes after stop, not that the line survives.
2. `effects/send.test.ts` "stop interrupts a send in flight": asserts messages are empty after `stop()`, subscribes, resolves the late ack and expects zero writes and still no messages. Reason: same, the late ack must write nothing.
3. `real-store.voice.test.ts` "an offline failure ends failed with the network reason": goes offline with a failing `getXmppToken` (chats load, no core, status `offline`) instead of `stop()`. All assertions about the failed bubble and the `network` reason are unchanged. Reason: `stop()` is now sign-out and empties the chats.
Runs: `src/store` 3 times, 308 passed + 1 skipped each time, no general-only flake. Mobile typecheck, prettier and oxlint clean.

## Review (written by Claude)

**Lead, 2026-10-10: approved after round 1.**
- **The fix, tests first:** mobile `stop()` resets every user-scoped field from one `initialUserState()`, and clears the closure caches. Voice transcripts, a file with no user key, are cleared on sign-out.
- **Safety:** only the provider's sign-out cleanup calls `stop()`, and resume goes through `reconnect`, so a normal resume cannot blank the screen.
- **Web:** has no bug. It resets in `signOutStore` and then does a full page load (`apps/web/src/store/effects/lifecycle.ts:122-182`, `ports.ts:262`).
- **Round 1:** three tests that assumed state survives `stop()` now pin their intent: no write after `stop()`, and offline reached via a failed token.
- **Follow-up:** downloads under `Paths.cache` (GIFs, attachments) are not user-keyed.
- **Check:** the combined wave 6 check passes.
- **Live check for Julio:** sign out, then sign in as another user on the same phone.
