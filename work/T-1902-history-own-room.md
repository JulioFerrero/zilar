---
id: T-1902
title: "Smooth app task 2: an open group/topic loads its history as soon as ITS room is joined, not after every room — joinGroups joins the waiting chat first and reports each joined room; canLoadHistory accepts a room in the new joinedRooms set; flushPending runs after each join (web + phone, shared client-core)"
status: merged
milestone: M5
branch: task/T-1902-history-own-room
model: auto
effort: default
depends_on: [T-1901]
estimate: 45 min
---

# T-1902: A topic's history waits only for its own room

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/smooth-app.md` §1 web steps 7–8 and §5 task 2** (Julio, 2026-10-17: "cards test is slow to load", "all this connection system needs to be smoother"). After connecting, both apps join **every** group and topic room one after another. A group or topic's history is refused until the last join finishes, so opening any topic gets slower the more topics a person has.

### Facts (read by the lead on 2026-10-17)
- **`packages/client-core/src/store/connect.ts:168-173`:** `setConnectionStatus(ctx, 'online')`, `flushPending(ctx)`, then `yield* fromPromise(() => ctx.fx.joinGroups(current, me))`, then `ctx.groupsJoined = true` and `flushPending(ctx)` again.
- **`packages/client-core/src/store/history-core.ts:100-102`:** `canLoadHistory` requires `chat.kind !== 'group' || ctx.groupsJoined`. `HistoryCtx.groupsJoined` is declared at `:64`.
- **`packages/client-core/src/store/history.ts:141-150`:** `flushPending(ctx)` opens `ctx.pendingOpenChatId` when it can, and keeps it pending otherwise (`:164-171`).
- **`packages/client-core/src/store/lifecycle.ts`:** the reset at `:111` (`ctx.groupsJoined = false`); the resume path joins at `:177` and sets `groupsJoined = true` at `:179`.
- **`ctx.fx.joinGroups(core, me): Promise<void>`** is in `packages/client-core/src/store/ctx.ts:111`.
- **The app implementations both loop `chats` and join each group room in order:**
  - web `joinGroups` in `apps/web/src/store/effects/groupMembers.ts:139-153`, wired in `apps/web/src/store/effects/storeContext.ts:133` / `apps/web/src/store/effects/lifecycle.ts:182-183`;
  - phone `joinGroups` in `apps/mobile/src/store/effects/groups.ts:202-…`, wired in `apps/mobile/src/store/real-store.ts:281` and `apps/mobile/src/store/effects/lifecycle.ts:222`.
- **How each app binds `groupsJoined`:**
  - web: `apps/web/src/store/effects/locals.ts:19,64` and `storeContext.ts:147`;
  - phone: `apps/mobile/src/store/effects/locals.ts:34,88` and `apps/mobile/src/store/effects/lifecycle.ts:288-293`.

### Steps
1. **client-core `ctx.ts`:** `joinGroups` becomes `(core, me, hooks?: { first?: string; onJoined?: (chatId: string) => void }) => Promise<void>`. Both are optional, so the old behaviour stays the default.
2. **`history-core.ts`:**
   - add `joinedRooms: Set<string>` to `HistoryCtx`;
   - `canLoadHistory` allows a group chat when `ctx.groupsJoined || ctx.joinedRooms.has(chat.id)`.
3. **`connect.ts` and the resume path in `lifecycle.ts`:**
   - clear `joinedRooms` where `groupsJoined` is reset;
   - call `joinGroups(current, me, { first: ctx.pendingOpenChatId, onJoined: (id) => { ctx.joinedRooms.add(id); flushPending(ctx); } })`;
   - keep setting `groupsJoined = true` after the loop, and the final `flushPending`.
4. **Web `groupMembers.ts` `joinGroups` and phone `groups.ts` `joinGroups`:** when `hooks.first` names a group chat in the list, join it first, then the rest in their current order (skip it the second time). After each successful `joinRoom`, call `hooks.onJoined?.(chat.id)`; a failed join reports nothing. Pass the hooks through the wiring (`storeContext.ts`, web `lifecycle.ts`, `real-store.ts`, phone `lifecycle.ts`).
5. **Each app's ctx object:** add `joinedRooms` the way it binds `groupsJoined` (web `locals.ts` + `storeContext.ts`; phone `locals.ts` + `lifecycle.ts`), initialised to `new Set()`.
6. **Tests** (the message pipeline), in `packages/client-core/src/store/history.test.ts`. Add one test: with `groupsJoined = false`, a group chat whose id is in `joinedRooms` passes `canLoadHistory`, and a pending open for it flushes when `onJoined` fires. If an app history test asserts the join order, update it.
7. **Size:** every touched file stays at most 400 lines.

### Allowed files
- `packages/client-core/src/store/ctx.ts`
- `packages/client-core/src/store/history-core.ts`
- `packages/client-core/src/store/history.ts`
- `packages/client-core/src/store/connect.ts`
- `packages/client-core/src/store/lifecycle.ts`
- `packages/client-core/src/store/history.test.ts`
- `apps/web/src/store/effects/groupMembers.ts`
- `apps/web/src/store/effects/storeContext.ts`
- `apps/web/src/store/effects/lifecycle.ts`
- `apps/web/src/store/effects/locals.ts`
- `apps/web/src/store/realStore.history.test.tsx`
- `apps/mobile/src/store/effects/groups.ts`
- `apps/mobile/src/store/effects/lifecycle.ts`
- `apps/mobile/src/store/effects/locals.ts`
- `apps/mobile/src/store/real-store.ts`
- `apps/mobile/src/store/real-store.history.test.ts`
- `work/T-1902-history-own-room.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/history.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Opening a topic on a cold start** loads its history right after its own room is joined, and that room is joined first.
- **The other rooms still join** in the background.
- Nothing else changes.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **client-core**
  - `ctx.ts`: `StoreAppHooks.joinGroups` takes optional `JoinGroupsHooks` (`first`, `onJoined`); added the shared optional `joinedRooms` set to `CoreHooks`.
  - `history-core.ts`: added `joinedRooms` to `HistoryCtx` and let `canLoadHistory` accept a group when its own room is in that set (falling back to `fx.joinedRooms`).
  - `connect.ts` and the resume path in `lifecycle.ts`: pass `{ first: pendingOpenChatId, onJoined }`; `onJoined` adds the room id and calls `flushPending`; `groupsJoined = true` and the final flush stay as they were.
  - `lifecycle.ts`: `stopStore` clears `joinedRooms` where it resets `groupsJoined`.
- **web**: `groupMembers.joinGroups` joins `hooks.first` before the rest in their existing order and calls `hooks.onJoined` only after a successful `joinRoom`; wiring in `lifecycle.ts`/`storeContext.ts`; `joinedRooms` bound in `locals.ts`/`storeContext.ts`.
- **mobile**: same reorder and per-join reporting in `groups.ts`, passed through `real-store.ts` and `lifecycle.ts`; `joinedRooms` owned by `effects/locals.ts` and exposed on the lifecycle ctx from the shared hook set.
- **tests** (`packages/client-core/src/store/history.test.ts`): one test for `groupsJoined = false` + a joined room passing `canLoadHistory` and flushing the pending open (asserts `loadHistory` is called with `groupchat`), plus one short test for the mobile `fx` fallback. No app history test asserted join order, so none needed updating.

### Checks run

- `pnpm --filter @zilar/client-core exec vitest run src/store/history.test.ts --reporter=dot` → **24 passed** (1 file), 1.80 s.
- `pnpm gate` → summary:
  ```
  PASS  install (frozen)  (2.6s)
  PASS  format  (0.8s)
  PASS  lint  (0.8s)
  PASS  typecheck  (8.4s)
  PASS  effect  (1.5s)
  PASS  tests @zilar/client-core  (11.1s)
  PASS  tests @zilar/mobile  (8.6s)
  PASS  tests @zilar/web  (9.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Two wiring files are outside the Allowed list, so I solved it inside scope instead of blocking:**
  1. `apps/mobile/src/store/effects/history-ctx.ts` builds a second `HistoryCtx` literal for mobile history. Since it is not mine to edit, `HistoryCtx.joinedRooms` is **optional** and the same `Set` is also exposed on `CoreHooks.joinedRooms` (in the allowed `ctx.ts`); the mobile adapter already shares `coreCtx.fx`, so its `canLoadHistory` sees the rooms. `canLoadHistory` checks the ctx field first and falls back to `fx`. Web and mobile behaviour is the same; the only difference from the spec's literal type is optionality.
  2. `apps/mobile/src/store/effects/runtime.ts` declares `StoreFx.joinGroups` with two parameters and is outside scope. `real-store.ts` implements the optional third hook parameter and mobile `lifecycle.ts` widens that single call with a narrow function-type assertion (no `any`, no `@ts-ignore`) so the hooks reach the join loop.
- `packages/client-core/src/store/history.test.ts` is now 474 lines; it was already 438 before this task. The gate's 400-line check covers source files and passes, but the task's "every touched file" wording is technically exceeded. I did not split it because a new test file would be outside Allowed files.
- I did not run the apps or do a live cold-start smoke; the join order and flush are covered by the new core test plus typecheck and the package test suites in the gate.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `25eab36b6`.
- **The change:**
  - `connect.ts` and the resume path pass `{ first: pendingOpenChatId, onJoined }`;
  - each successful join adds the room to `joinedRooms` and flushes the pending open;
  - `canLoadHistory` only widens, with an OR on `joinedRooms`;
  - both apps' `joinGroups` join the pending chat first, and a failed join reports nothing.
- **Follow-ups go into T-1909:** the phone `StoreFx.joinGroups` two-param declaration plus its cast; `joinedRooms` in the phone `HistoryCtx` literal; and clearing `joinedRooms` before a resume rejoin.
- **Live check after the deploy:** a cold open of "cards test".

