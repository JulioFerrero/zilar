---
id: T-1130
title: "Size split: apps/mobile/src/store/real-store.ts (693) — chat-row mapping, the closure's helpers, initial state and teardown move into store/effects/ modules; the message-pipeline tests stay green unedited"
status: todo
milestone: M5
branch: task/T-1130-split-mobile-real-store
model: auto
effort: default
depends_on: [T-1128]
estimate: 0.4 day
---

# T-1130: Split the mobile chat store

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11, chose "finish the leftovers", which includes the held-back 400-line splits. `apps/mobile/src/store/real-store.ts` has 693 lines. It is the **message pipeline** (a crucial area), so this split must change no behaviour. Six tests guard it: `apps/mobile/src/store/real-store.{history,incoming,ledger,lifecycle,send,sign-out}.test.ts`.

**What the lead read:**
- **Before the closure:**
  - `isUpdateStanza` (`:56`), `summaryFor` (`:64`) and `summariesFor` (`:95`, exported, calls `summariesForTopicsEntry` from `../lib/topics`);
  - `EMPTY_MESSAGES` and `createRealChatStore` (`:114`).
- **The closure** (`createAtomStore((set, get) => { … })`, from `:132`):
  - mutable locals (`:133-186`: `core`, `lastRead`, `cursors`, `pendingOutgoing`, `groupIds`, `groupDetails`, the role maps, `chatPrefRows`, `groupMembers`, the loading sets, `pendingOpenChatId`, `groupsJoined`, `pinsPollEnabled`), with `mediaToken`, `mediaTrustedHosts`, `pendingUploads` and `pendingVoices` just above (`:122-130`);
  - `s: StoreState` (`:188`);
  - helpers (`:254-485`: `isVisible`, `ledger`, `clearAttachmentFailure`, `markVoiceFailed`, `rememberGroupIds`, `groupIdForChat`, `rememberTopicRoles`, `rememberMembers`, `mentionMembersFor`, `setChatMessage`, `coreApi`, `corePorts`, `coreCtx`, `nick`);
  - `ctx: StoreCtx` (`:489`), then the `make*` modules (`:567-572`);
  - `initialUserState` (`:577`), `teardown` (`:624`) and the returned state and actions (`:659`).
- **The pattern already in use:** `store/effects/` (`lifecycle.ts`, `history.ts`, `send.ts`, `groups.ts`, `events.ts`, `pins.ts`) take a `StoreCtx`.
- **Do not dedup `summariesFor` with the core one.** `packages/client-core/src/store/chat-rows.ts:161` adds fields (visibility, handle, group avatar, background, channel) that the mobile rows do not have today, so swapping it would change the rows.

### What to build
1. **A new `apps/mobile/src/store/effects/chat-rows.ts`** holds `isUpdateStanza`, `summaryFor` and `summariesFor`, moved byte-for-byte. `real-store.ts` re-exports `isUpdateStanza` and `summariesFor`.
2. **A new `apps/mobile/src/store/effects/locals.ts`:** `createStoreLocals()` returns **one object** holding every mutable local listed above.
   - The `let` values become properties, for example `locals.core` and `locals.pinsPollEnabled`.
   - The closure creates it once and uses `locals.x` wherever it used `x`.
   - Keep the comments that explain each local next to its property.
3. **A new `apps/mobile/src/store/effects/helpers.ts`:** the helper functions from `:254-485` become `makeStoreHelpers({ locals, s, set, get, ports, … })`, which returns them, with each **body unchanged** apart from `x` → `locals.x`.
   - `coreApi`, `corePorts` and `coreCtx` may stay in `real-store.ts` if moving them would need more than renames.
4. **A new `apps/mobile/src/store/effects/user-state.ts`** holds `initialUserState` and `teardown`, parameterised the same way, with bodies unchanged apart from the renames.
5. **`real-store.ts`** keeps `createRealChatStore`: it wires `locals`, the helpers, `ctx` and the `make*` modules, and returns the state and actions exactly as today. **The public exports of `real-store.ts` do not change.**
6. **No behaviour change.**
   - The order of side effects inside each helper, action and teardown stays the same.
   - No new state, no removed state.
   - No other file in `apps/mobile` changes, except importers of a moved name, if any (`grep -rn "store/real-store'" apps/mobile/src`). Prefer re-exports.
7. **Tests:** run the six `real-store.*.test.ts` files and `apps/mobile/src/store/effects/send.test.ts`. **Do not edit any test.** Paste the results.
8. **Line counts:** every file stays at most 400 lines. Paste `wc -l` in the Report.

### Read first
`AGENTS.md`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/ports.ts`, `apps/mobile/src/store/effects/runtime.ts`, one existing module (`apps/mobile/src/store/effects/pins.ts`), and the six tests.

### Allowed files
`apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/chat-rows.ts`, `apps/mobile/src/store/effects/locals.ts`, `apps/mobile/src/store/effects/helpers.ts`, `apps/mobile/src/store/effects/user-state.ts`, `apps/mobile/src/store/effects/runtime.ts`, `work/T-1130-split-mobile-real-store.md`.

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/store/real-store.history.test.ts src/store/real-store.incoming.test.ts src/store/real-store.ledger.test.ts src/store/real-store.lifecycle.test.ts src/store/real-store.send.test.ts src/store/real-store.sign-out.test.ts src/store/effects/send.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, with no test file edited.
- Every file is at most 400 lines.
- The lead's emulator check passes: sign in, chats load, send and receive, sign out.

---

## Report (written by the worker when done)

## Review (written by Claude)
