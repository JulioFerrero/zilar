---
id: T-2206
title: "Store phase 3 T3a: the phone store keeps history load as the core's `historyState` ('ready', not 'loaded'); the two state adapters go and the history context uses bridgeLocals; no behaviour change"
status: merged
milestone: M5
branch: task/T-2206-phone-history-state
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2206: One history-load shape on the phone (store phase 3, T3a)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/store-phase3-plan.md` step T3. Julio said go on 2026-10-19. The core store keeps each chat's history load in `historyState: Record<string, HistoryLoad>`, with `HistoryLoad = 'loading' | 'ready' | 'error'` (`packages/client-core/src/store/history.ts:19`), and the web uses it as is.

The phone names the same thing `historyLoad`, with `'loaded'` instead of `'ready'`. So it converts the whole state on every core read and every core write, in two places:
- `apps/mobile/src/store/effects/history.ts:29-65`;
- `apps/mobile/src/store/effects/lifecycle.ts:107-135` (used at `:277-285`).

Using the core's shape deletes both adapters.

### Facts (the lead read these on 2026-10-19)
1. The phone's `historyLoad` is declared in `apps/mobile/src/store/types.ts:202` as `Record<string, LoadState>`, with `LoadState = 'loading' | 'loaded' | 'error'` at `:134`.
2. Where the phone reads or writes `historyLoad`:
   - `apps/mobile/src/store/real-store.ts:59`, `:88` and `:408-411`;
   - `apps/mobile/src/components/chat/message-list.tsx:425` and `:560`;
   - tests: `apps/mobile/src/store/real-store.history.test.ts`, `real-store.sign-out.test.ts` and `offline-cache.test.ts`.
3. `messagesListView(load, count)` (`apps/mobile/src/store/types.ts:164-175`) checks only `'loading'` and `'error'`, so it works unchanged with `HistoryLoad`. `LoadState` stays for `chatsLoad`.
4. `makeHistoryCtx` (`apps/mobile/src/store/effects/history.ts:66-100`) writes getter/setter pairs for `core`, `lastRead`, `groupsJoined` and `pendingOpenChatId`. T-2204 added `bridgeLocals` to `packages/client-core/src/store/ctx.ts` for exactly this.

### Steps
1. Rename the phone store field `historyLoad` to `historyState`, typed `Record<string, HistoryLoad>` (import the type from client-core), and write `'ready'` where the phone wrote `'loaded'`. Update every place in fact 2, including the three tests (rename only; no new or removed cases).
2. Delete `toCoreLoad`, `toMobileLoad`, `asHistoryState`, `asMobilePatch` and the `historySet` wrapper in `history.ts` and `lifecycle.ts`. The history and lifecycle contexts use the store's `get` and `set` directly. Keep the "same object, skip the write" behaviour: if `set` returning the same state matters, keep that one check.
3. In `makeHistoryCtx`, replace the four getter/setter pairs with one `bridgeLocals(s, historyCtx, [...])` call.
4. Do not change `openChat`, history paging, unread or read-mark logic.
5. Report the line counts per file.

### Allowed files
- `apps/mobile/src/store/types.ts`
- `apps/mobile/src/store/real-store.ts`
- `apps/mobile/src/store/effects/history.ts`
- `apps/mobile/src/store/effects/lifecycle.ts`
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/store/real-store.history.test.ts`
- `apps/mobile/src/store/real-store.sign-out.test.ts`
- `apps/mobile/src/store/offline-cache.test.ts`
- `work/T-2206-phone-history-state.md`

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/store --reporter=dot
pnpm --filter @zilar/client-core exec vitest run src/store/history.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and the store tests pass with only the field renamed.
- `git grep -n "historyLoad\|toCoreLoad\|toMobileLoad" -- apps/mobile/src` finds nothing.
- Phone emulator, mock mode, checked by the lead: open a DM and a group topic, which show a skeleton then the messages; scroll up to load older messages; go back and reopen.
- Net at least −50.

---

## Report (written by the worker when done)

### What I did
- Renamed the phone store field `historyLoad` to `historyState`, typed `Record<string, HistoryLoad>` imported from `@zilar/client-core/store`; the phone now writes `'ready'` instead of `'loaded'`. `LoadState` stays for `chatsLoad`.
- Widened `messagesListView`'s parameter from `LoadState` to `HistoryLoad` (its body only checks `'loading'` and `'error'`, as the spec noted).
- Deleted `toCoreLoad`, `toMobileLoad`, `asHistoryState`, `asMobilePatch` and the `historySet` wrapper from `effects/history.ts` and `effects/lifecycle.ts`. Both contexts now use the store's `get` and `set` directly; the store's `Object.is` check already skips the write when the core returns the same state object.
- Replaced the four getter/setter pairs in `makeHistoryCtx` with one `bridgeLocals(s, historyCtx, ['core', 'lastRead', 'groupsJoined', 'pendingOpenChatId'])` call. The lifecycle context keeps its own accessors (its `core` setter has extra logic and the spec only asked for `bridgeLocals` in `makeHistoryCtx`).
- Renamed the field in `real-store.ts` (state key, initial state, `closeChat`), `message-list.tsx` (local variable too, since the acceptance grep covers the whole tree), and the three test files (rename only, `'loaded'` → `'ready'`; no cases added or removed).
- No changes to `openChat`, history paging, unread or read-mark logic.

### Files changed (line counts, after)
- `apps/mobile/src/store/types.ts` — 233 lines
- `apps/mobile/src/store/real-store.ts` — 452 lines
- `apps/mobile/src/store/effects/history.ts` — 275 lines
- `apps/mobile/src/store/effects/lifecycle.ts` — 334 lines
- `apps/mobile/src/components/chat/message-list.tsx` — 640 lines
- `apps/mobile/src/store/real-store.history.test.ts` — 313 lines
- `apps/mobile/src/store/real-store.sign-out.test.ts` — 170 lines
- `apps/mobile/src/store/offline-cache.test.ts` — 206 lines

Diff: 9 files changed, 31 insertions(+), 123 deletions(-), net −92.

### Checks run
- `pnpm --filter @zilar/mobile exec vitest run src/store --reporter=dot --maxWorkers=2`: 10 test files passed, 44 tests passed.
- `pnpm --filter @zilar/client-core exec vitest run src/store/history.test.ts --reporter=dot --maxWorkers=2`: 1 test file passed, 26 tests passed.
- `git grep -n "historyLoad\|toCoreLoad\|toMobileLoad" -- apps/mobile/src`: no matches (the only hits for the wider pattern are the `historySetup` test helper name, which the acceptance grep does not match).
- `pnpm gate`: GATE PASS. Summary: 9 changed files; PASS install (frozen), format, lint, typecheck, effect; SKIP build @zilar/server (no server/package/manifest change); PASS tests @zilar/mobile. Scope: every changed file inside Allowed files. WARN size for `message-list.tsx` (640, unchanged from main) and `real-store.ts` (452, unchanged from main), both under the 800 hard limit.

### Problems / deviations
- None functionally. The only signature change beyond a pure rename is `messagesListView(load: HistoryLoad, …)`, needed because `'ready'` is not part of `LoadState`.
- Not tested on the phone emulator (the task assigns that smoke check to the lead).

### Open questions
- None.


## Review (written by Claude)

Approved; the pre-review was clean (0 findings). Net −92.

**What changed:**
- The phone store keeps history load in the core's `historyState` (`'ready'`, not `'loaded'`).
- The two whole-state adapters in `effects/history.ts` and `effects/lifecycle.ts` are gone, along with `toCoreLoad`/`toMobileLoad`.
- The history context reads and writes the store directly. The "same object, skip the write" rule still holds, because `createAtomStore` skips an update that returns the same state (`Object.is`, `atom-store.ts:55`).
- The history context's getter pairs became `bridgeLocals`.

**Phone emulator smoke passed:**
- Ana's DM pages back to older days;
- Dev team › General opens with its messages and reopens fine.
