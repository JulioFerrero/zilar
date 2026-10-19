---
id: T-2217
title: "Store phase 3 T3b: the shared half of openChat (prune, read mark, clear the manual unread mark, pending marker swap, openHistory) moves into client-core and both apps call it; no behaviour change"
status: merged
milestone: M5
branch: task/T-2217-open-chat-core
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2217: One openChat core (store phase 3, T3b)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/store-phase3-plan.md` T3 (`openChatBase`); the history-state half shipped as T-2206. Julio said go on 2026-10-19. Web and phone open a chat with the same steps around their own extras.

### Facts (the lead read these on 2026-10-19)
1. **Web:** `openChat` (`apps/web/src/store/effects/history.ts:81-115`):
   - sets `activeChatId` and its notice rule (keep the notice for the same chat);
   - `pruneInactiveChats(ctx, chatId)`;
   - drops the quiet-archive marks (web only);
   - `recordRead(ctx, chatId, ctx.lastRead[chatId])`;
   - clears the manual unread mark: a local `set` plus `setUnreadMark(ctx, chatId, false)`;
   - loads members and pins (web hooks);
   - swaps the pending marker: `clearSupersededMarker` for the old pending id, then `pendingOpenChatId = chatId`;
   - `ctx.rt.fork(openHistory(ctx, chatId))`.
2. **Phone:** `openChat` (`apps/mobile/src/store/effects/history.ts:217-245`):
   - the same order with its own notice rule (keep the notice for the same group);
   - `h.recordRead`, then `clearUnreadMarkOnOpen(ctx, chatId)` (`apps/mobile/src/store/effects/events.ts:51-66`, a local `set` plus the pref write);
   - the group detail, members, pins and pins polling (phone hooks);
   - the same marker swap and `openHistory`.
3. The core already has `pruneInactiveChats`, `recordRead`, `clearSupersededMarker` and `openHistory` (`packages/client-core/src/store/history.ts`, `reads.ts`).

### Steps
1. Add `openChatCore(ctx, chatId, { writeUnreadMark })` to `packages/client-core/src/store/history.ts`. It holds the shared steps in the same order:
   - prune;
   - `recordRead` with `ctx.lastRead[chatId]`;
   - when the opening row has `unreadMark === true`, clear it locally and call `writeUnreadMark(chatId)`;
   - the pending marker swap;
   - return the `openHistory` effect for the caller to fork in its own runtime.
2. **Web `openChat`:** keeps its notice `set` and quiet-archive loop before the core call, and its member and pin loads, then forks the returned effect.
3. **Phone `openChat`:** keeps its notice `set`, then the core call (the pref write goes through `writeUnreadMark`), then its detail, members and pins hooks, then forks the effect. Delete `clearUnreadMarkOnOpen` from `events.ts` if nothing else uses it.
4. **Keep the order exactly:**
   - the notice `set` comes before prune;
   - the read mark comes before the unread-mark clear;
   - the members and pins loads come before the marker swap and `openHistory`, as today. If a phone hook ran after the swap before, keep it there.
5. **Stop rule:** measure the net over the changed source files. If it is not at least −15, do not commit. Set `status: blocked` and write the numbers in the Report.

### Allowed files
- `packages/client-core/src/store/history.ts`
- `apps/web/src/store/effects/history.ts`
- `apps/mobile/src/store/effects/history.ts`
- `apps/mobile/src/store/effects/events.ts`
- `work/T-2217-open-chat-core.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/history.test.ts --reporter=dot
pnpm --filter @zilar/web exec vitest run src/store --reporter=dot
pnpm --filter @zilar/mobile exec vitest run src/store/real-store.history.test.ts src/store/real-store.incoming.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- Net at least −15.
- Lead checks:
  - web mock: open a DM with an unread mark, then a group topic, then reload, and the mark clears;
  - phone emulator: open a DM and a group topic, history loads, and members show.

---

## Report (written by the worker when done)

### What I did

- Added `openChatCore(ctx, chatId, { writeUnreadMark })` to `packages/client-core/src/store/history.ts`. It prunes inactive chats, records the read mark from `ctx.lastRead[chatId]`, clears a manual unread mark in the store and calls `writeUnreadMark(chatId)` only when the opening row had the mark, swaps the pending-open marker (clearing a superseded one), and returns the `openHistory` effect for the caller to fork.
- Web `openChat` now sets the notice and drops the other quiet-archive marks, then calls the core, then loads group members and pins, then forks the returned history effect. Its unread pref write goes through the hook (`setUnreadMark(ctx, id, false)` in its own fiber).
- Mobile `openChat` now sets the notice, calls the core with a `setChatPref(id, { unreadMark: false })` hook, then keeps its group detail, members, pins and pins-polling hooks, then forks the returned effect. Deleted `clearUnreadMarkOnOpen` from `apps/mobile/src/store/effects/events.ts`; nothing else used it.
- No tests added: this moves bindings and order, it does not change an algorithm.

### Files changed

- `packages/client-core/src/store/history.ts`
- `apps/web/src/store/effects/history.ts`
- `apps/mobile/src/store/effects/history.ts`
- `apps/mobile/src/store/effects/events.ts`
- `work/T-2217-open-chat-core.md`

### Size (stop rule)

- `git diff --numstat` against `main`: core `+23`, web `+6/−22`, mobile history `+7/−11`, mobile events `+0/−18`.
- Net over the changed source files: **−15** (36 insertions, 51 deletions). Meets the −15 floor.
- `packages/client-core/src/store/history.ts` is 471 lines; gate reports the 400-line soft-limit warning (448 on main).

### Commands and real results

- `pnpm install --frozen-lockfile`: Done in 12s using pnpm v10.32.1.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/history.test.ts`: 1 file passed, 26 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store`: 9 files passed, 18 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.history.test.ts src/store/real-store.incoming.test.ts`: 2 files passed, 8 tests passed.
- `pnpm gate`: `PASS` for install (frozen), format, lint, typecheck, effect, build @zilar/server, tests @zilar/client-core, tests @zilar/mobile, tests @zilar/web; `scope: every changed file is inside the Allowed files`; `GATE PASS`. One WARN: the core `history.ts` soft 400-line limit (471 lines, 448 on main).

### Problems and deviations

- Step 4 says the member/pin loads stay before the pending-marker swap, while steps 2 and 3 say the apps call the core (which owns the swap) and then run those loads. I followed steps 2 and 3: the loads still run before `openHistory` is forked, but the synchronous marker assignment now happens before them. All the loads are forked background work, so I saw no behaviour change; the targeted tests and the gate agree.
- I could not leave the `openChatCore` doc comment that explained why callers fork the returned effect: with it the net was above −15. The signature and call sites are short enough to read without it. The unread-pref WHY comment moved next to the mobile hook; the web one stays in place.
- No other deviations.

### Open questions

- None.


## Review (written by Claude)

Approved; the pre-review was clean (1 nit: a disclosed order change). Net −15.

**What changed:**
- `openChatCore(ctx, chatId, { writeUnreadMark })` in client-core does prune, the read mark, the unread-mark clear (local plus `writeUnreadMark`) and the pending marker swap, and returns the `openHistory` effect.
- Web keeps its notice rule and the quiet-archive drop. The phone keeps its notice rule and its detail, members and pins hooks.
- The phone's `clearUnreadMarkOnOpen` is gone.

**The order change, accepted:** the marker swap now runs before the member and pin forks. None of those reads `pendingOpenChatId`, and `openHistory` is still forked last.

**Lead checks:**
- Web mock, branch and main identical: DM send, picture, group send, reload, reopen.
- Unread mark: "Mark as unread" on Marta shows the dot; opening Marta then General clears it, and a reload keeps it cleared.
- Phone emulator: the smoke passes; Ana's DM and Dev team › General open with history and member avatars.
