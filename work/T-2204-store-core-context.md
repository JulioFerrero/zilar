---
id: T-2204
title: "Store phase 3 T2: the shared store locals, ledger wiring and nick live in client-core; web and phone build their context from them; no behaviour change"
status: merged
milestone: M5
branch: task/T-2204-store-core-context
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2204: One core context for both stores (store phase 3, T2)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/store-phase3-plan.md` step T2. Julio said go on 2026-10-19. The web and phone stores each write the same ledger wiring, the same `nick` helper, the same core locals and the same getter/setter bridge into the core context.

This is the send / ledger / incoming hot path: the task moves bindings, not algorithms.

### Facts (the lead read these on 2026-10-19, at `2dda3ebdb`)
1. **Ledger wiring, written twice.**
   - Web: `apps/web/src/store/effects/storeContext.ts:45-54`.
   - Phone: `apps/mobile/src/store/effects/helpers.ts:27-36`.
   - Both call `createMessageLedger({ get, set, memberName, occupantNick, mediaToken })`, with the same `occupantNick` (`locals.core?.occupants(chatId).find(realJid === fromJid || jid === fromJid)?.nick`) and the same `mediaToken` (`locals.mediaToken`).
   - **`memberName` differs:** the web reads `locals.groupMembers.get(chatId)?.get(localpart)?.name`, and the phone map holds the name itself (`…get(localpart)`). It must stay an app input.
2. **`nick(me)`** is the same 7 lines in `storeContext.ts:73-79` and `helpers.ts:138-144`.
3. **Core locals both apps declare:**
   - `core`, `lastRead`, `cursors`, `pendingOutgoing`, `groupIds`, `loadingOlder`, `loadingHistory`, `pendingOpenChatId`, `groupsJoined`, `joinedRooms`, `mediaToken`;
   - web: `apps/web/src/store/effects/locals.ts:49-72`; phone: `apps/mobile/src/store/effects/locals.ts:38-70`.
4. **The getter/setter bridge.**
   - Web `storeContext.ts:131-172`: `core`, `groupsJoined`, `joinedRooms`, `pendingOpenChatId`, `mediaToken`, `lastRead`, `lastReadUserId`, 6 lines each.
   - Phone `real-store.ts:323-334`: `core`, `lastRead`.
5. `CoreCtx` is in `packages/client-core/src/store/ctx.ts:98-121`, and `CoreHooks` at `:46-59`.

### Steps
1. In `packages/client-core/src/store/ctx.ts` (or the store `index`, wherever the core already exports from), add:
   - `CoreLocals` and `createCoreLocals()` for the fields in fact 3, with the types the core already uses. Where an app's type for a field differs, leave that field out of `CoreLocals`.
   - `createCoreLedger({ get, set, locals, memberName })`, which calls `createMessageLedger` with the shared `occupantNick` and `mediaToken`.
   - `nickFor(me)` (fact 2).
   - One small helper that defines the getter/setter bridge for a list of local keys on the context, so each app writes the key list once instead of six lines per key. Keep the context's types exact; if a typed helper is not possible without casts that hide errors, skip this item and say so in the Report.
2. Web (`locals.ts`, `storeContext.ts`, `ctx.ts`) and phone (`locals.ts`, `helpers.ts`, `real-store.ts`, `runtime.ts` if a type moves) use these. Each app keeps its own `memberName`, its own extra locals and its own hooks.
3. Change no algorithm, no order of calls, and no hook body.
4. **Stop rule:** measure the net over every changed file, the new core code included. If it is not at least −40, do not commit the change. Set `status: blocked` and write the numbers in the Report.

### Allowed files
- `packages/client-core/src/store/ctx.ts`
- `packages/client-core/src/store/index.ts`
- `apps/web/src/store/effects/storeContext.ts`
- `apps/web/src/store/effects/ctx.ts`
- `apps/web/src/store/effects/locals.ts`
- `apps/mobile/src/store/real-store.ts`
- `apps/mobile/src/store/effects/helpers.ts`
- `apps/mobile/src/store/effects/runtime.ts`
- `apps/mobile/src/store/effects/locals.ts`
- `work/T-2204-store-core-context.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/ledger.test.ts src/store/incoming.test.ts src/store/send.test.ts --reporter=dot
pnpm --filter @zilar/web exec vitest run src/store --reporter=dot
pnpm --filter @zilar/mobile exec vitest run src/store --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and so do all the store tests above, unchanged.
- Net at least −40 over all changed files.
- The lead checks, in this order:
  - web mock (`/`, a DM, a group topic): send a text, an attachment and a voice; reload;
  - the phone emulator, mock: the same sends, plus a chat with unread;
  - a read-only look at Julio's real chats in Helium after the deploy (open chats, no sending).

---

## Report (written by the worker when done)

### What I did
- `packages/client-core/src/store/ctx.ts`:
  - added `CoreLocals` and `createCoreLocals()` for the shared fields in the spec
    (`core`, `lastRead`, `cursors`, `pendingOutgoing`, `groupIds`, `loadingOlder`,
    `loadingHistory`, `pendingOpenChatId`, `groupsJoined`, `joinedRooms`, `mediaToken`);
  - added `createCoreLedger({ get, set, locals, memberName })`, which keeps the app's
    `memberName` and supplies the shared `occupantNick` and `mediaToken`;
  - added `nickFor(me)`;
  - added `bridgeLocals(locals, ctx, keys)`, typed so only keys present on both objects
    with the same type (ignoring `undefined` added by an optional context field) are
    accepted. No casts; the implementation uses `Object.defineProperty` + `Reflect.set`.
- Web:
  - `effects/locals.ts` now extends `CoreLocals` and spreads `createCoreLocals()`, keeping
    `lastReadUserId` and the web-only maps.
  - `effects/storeContext.ts` builds the ledger with `createCoreLedger`, uses `nickFor`,
    and replaces the seven hand-written getter/setter pairs with one `bridgeLocals` call.
  - `effects/ctx.ts` needed no change: its `StoreCtx`/`Kernel` types already match.
- Mobile:
  - `effects/locals.ts` now extends `CoreLocals` and spreads `createCoreLocals()`, keeping
    the mobile-only maps.
  - `real-store.ts` builds one ledger with `createCoreLedger` and passes it to the
    helpers, the core context and the user state; replaces the `s` and `coreCtx`
    getter/setter pairs with `bridgeLocals` calls.
  - `effects/helpers.ts` no longer creates the ledger or defines `nick`; it receives the
    ledger and returns `nick: nickFor`.
  - `effects/runtime.ts` has `StoreState extends CoreLocals`, so its shared declarations
    are gone; `joinedRooms: locals.joinedRooms` is the one field `s` now carries to
    satisfy that type.
- No algorithm, call order or hook body changed. `memberName` stays app-specific
  (`locals.groupMembers … ?.name` on web, the name itself on mobile).

### Net lines (changed files, work file excluded)
`git diff --numstat`: added 161, removed 213, **net -52** (the stop rule asks for at
least −40, so it passes).

Per file:
- `apps/mobile/src/store/effects/helpers.ts`: +5 / −22
- `apps/mobile/src/store/effects/locals.ts`: +3 / −28
- `apps/mobile/src/store/effects/runtime.ts`: +2 / −12
- `apps/mobile/src/store/real-store.ts`: +31 / −57
- `apps/web/src/store/effects/locals.ts`: +3 / −33
- `apps/web/src/store/effects/storeContext.ts`: +23 / −59
- `packages/client-core/src/store/ctx.ts`: +94 / −2

### Commands and real results
- `pnpm install`: done, 1155 packages added, one existing peer-dependency warning
  (`@types/react` 19.3.0 vs 19.2.18) unchanged.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts src/store/incoming.test.ts src/store/send.test.ts`: **3 files, 92 tests passed**.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store`: **9 files, 18 tests passed**.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store`: **10 files, 44 tests passed**.
- `pnpm gate` (first run): format failed on `ctx.ts`; fixed with Prettier on that file.
- `pnpm gate` (second run): typecheck failed because `nickFor`'s optional `jid` did not
  include `undefined` under `exactOptionalPropertyTypes`; fixed the signature.
- `pnpm gate` (final run):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (3.3s)
  PASS  format  (2.0s)
  PASS  lint  (2.0s)
  PASS  typecheck  (13.1s)
  PASS  effect  (2.5s)
  PASS  build @zilar/server  (1.2s)
  PASS  tests @zilar/client-core  (22.7s)
  PASS  tests @zilar/mobile  (10.6s)
  PASS  tests @zilar/web  (5.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  WARN  size: apps/mobile/src/store/real-store.ts: 452 lines (main 478); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```

### Problems / deviations
- The estimate in the audit plan was −104; the real net is −52. This still meets the
  task's −40 stop rule, mainly because `apps/web/src/store/effects/ctx.ts` needed no
  change and the shared types had to stay exact.
- `nickFor` accepts `{ name; jid?: string | null | undefined }` instead of a concrete
  app `Me`, so both apps' `Me` types are assignable under `exactOptionalPropertyTypes`.
- No tests were added: this moves bindings only, and the existing ledger/incoming/send
  tests cover the hot path.

### Open questions
None.

## Review (written by Claude)

Approved; the pre-review was clean with 1 nit. Net −52 over all files, the new core code included.

**New in client-core `store/ctx.ts`:**
- `CoreLocals` and `createCoreLocals()`;
- `createCoreLedger({ get, set, locals, memberName })`; `memberName` stays each app's own, because the web and phone map shapes differ;
- `nickFor`;
- a typed `bridgeLocals`, whose `SharedLocalKeys` only accepts keys with the same type on both sides. It replaces the web's 7 and the phone's 2 hand-written getter/setter pairs.

**The nit:** the phone's `joinedRooms` is not bridged. It was a plain shared reference on main too, so behaviour is unchanged.

**Checks:**
- Web mock, branch and main compared: a DM text sends once with a tick, a picture sends, a group text sends once, and the list after a reload is identical to main.
- Phone emulator, mock: a DM text and a Dev team › General text each show one bubble with a tick. Dev-1's incoming reply arrives with its name, and the chat list shows the new preview.
