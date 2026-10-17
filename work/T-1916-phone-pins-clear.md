---
id: T-1916
title: "Phone sign-out also clears the in-memory pins map, so the next user on the same install never sees the previous user's pins (a DM with the same peer has the same chat id)"
status: merged
milestone: M5
branch: task/T-1916-phone-pins-clear
model: auto
effort: default
depends_on: [T-1914]
estimate: 20 min
---

# T-1916: Sign-out clears the phone's pins

## Spec (written by Claude, do not edit)

### Why
**The T-1914 pre-review.** The phone keeps pins in a closure map (`pinsByChat`) that survives sign-out. The store is created once per app run (`apps/mobile/src/store/chat-store-provider.tsx:114-116`), and a DM's chat id is the peer's JID. So if user A signs out and user B signs in, B could see A's pins for a DM with the same peer until B's own pin load replaces them. Since T-1914, A's leftover entry also blocks B's cached pins from being seeded (`seedCachedPins` skips chats already in the map).

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/store/effects/pins.ts`** (181 lines): `makePins(ctx)` keeps `pinsByChat` and `pinsRevisionByChat` (`:58-60`) and returns `{ actions, loadPins }`.
- **`apps/mobile/src/store/effects/user-state.ts:81-114`** (117 lines): `teardown()` clears every per-session map and resets the user state on `stop()`. `makeUserState({ locals, s, set, ownedAis, ledger, events, … })` builds it.
- **`apps/mobile/src/store/real-store.ts`** (395 lines): `const pins = makePins(ctx)` (`:309`), then `userState = makeUserState({ … })` (`:312`). The core's teardown hook calls `userState.teardown()` (`:270`).

### Steps
1. **`pins.ts`:** `makePins` also returns `clear(): void`, which empties `pinsByChat` and `pinsRevisionByChat`. Leave the global revision counter alone, so selectors still see a change.
2. **`user-state.ts`:** `makeUserState` accepts an optional `clearPins?: () => void`, and `teardown()` calls it.
3. **`real-store.ts`:** pass `clearPins: () => pins.clear()` into `makeUserState`. The file must stay at most 400 lines, so keep it to the one property.
4. **Test** (auth and user isolation): in the existing real-store lifecycle test file `apps/mobile/src/store/real-store.lifecycle.test.ts`, one case. After pins were published for a chat, a stop or sign-out leaves `pins(chatId)` empty. Use the existing helpers in that file.

### Allowed files
- `apps/mobile/src/store/effects/pins.ts`
- `apps/mobile/src/store/effects/user-state.ts`
- `apps/mobile/src/store/real-store.ts`
- `apps/mobile/src/store/real-store.lifecycle.test.ts`
- `work/T-1916-phone-pins-clear.md`

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/store/real-store.lifecycle.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **After sign-out,** no pins of the previous user remain in memory.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/store/effects/pins.ts`: `makePins` now returns `clear(): void`, which empties `pinsByChat` and `pinsRevisionByChat`. The global `pinsRevision` counter is untouched, per the spec, so selectors still re-fire on the teardown `set()`.
- `apps/mobile/src/store/effects/user-state.ts`: `UserStateDeps` accepts an optional `clearPins?: () => void`; `teardown()` calls it right after disabling the pins poll.
- `apps/mobile/src/store/real-store.ts`: `makeUserState` gets `clearPins: () => pins.clear()` (one property; file is 396 lines, under the 400 limit).
- `apps/mobile/src/store/real-store.lifecycle.test.ts`: one new case, "stop() (sign-out) clears the pins of the previous user (T-1916)". It publishes a pin for the DM chat id (`ANA`, the peer's JID) through the existing `seedCachedPins` state action, asserts `pins(ANA)` has it, calls `stop()`, and asserts `pins(ANA)` is `[]`.

### Checks run
- `pnpm install --frozen-lockfile`: done, 18.1s.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.lifecycle.test.ts`: 1 file passed, 11 tests passed (10 existing + the new one).
- `pnpm gate` (from the repo root): GATE PASS. Summary lines:
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`, `PASS  effect`, `PASS  tests @zilar/mobile`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`

### Files changed
- `apps/mobile/src/store/effects/pins.ts`
- `apps/mobile/src/store/effects/user-state.ts`
- `apps/mobile/src/store/real-store.ts`
- `apps/mobile/src/store/real-store.lifecycle.test.ts`
- `work/T-1916-phone-pins-clear.md` (status and this report)

### Deviations from the spec
None.

### Round 2 (fix round)
Findings from `PREREVIEW.md`:

- **Finding 1 (should-fix) — fixed.** `apps/mobile/src/store/effects/pins.ts` now keeps a `pinsEpoch` that `clear()` bumps. A load (and a pin/unpin call) goes through `storeAt(pinsEpoch)`, a view of the `PinsStore` that drops `publish` and `setError` when the epoch moved on, so a response that lands after teardown cannot republish the previous user's pins or set a stale error. Detached loads are not cancelled by the scope close, which was the hole.
- **Finding 2 (nit) — fixed.** The `clear()` comment no longer claims selectors re-fire; it says `clear()` writes no state and the caller must follow with a `set()` (teardown resets the user state right after). This is the block I changed for finding 1.
- **Follow-up F1 — not fixed.** `hydrateOfflineCache` lives in `effects/lifecycle.ts`, outside the Allowed files; left as named by the pre-review.

Tests added: `apps/mobile/src/store/real-store.lifecycle.test.ts`, case "a pins load that lands after stop() does not republish them (T-1916)". It injects a `pinsApi` whose `listPins` promise is resolved manually, calls `refreshPins(ANA)`, asserts the load started, calls `stop()`, resolves the promise, then asserts `pins(ANA)` is `[]`. I confirmed the case catches the bug: stashing the `pins.ts` fix and running it gives `1 failed`; with the fix the file passes.

Commands and results (re-verified in the continuation session on 2026-10-17):
- `pnpm --filter @zilar/mobile exec vitest run src/store/real-store.lifecycle.test.ts --reporter=dot`: 1 file passed, 12 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.lifecycle.test.ts`: 1 file passed, 12 tests passed.
- Same file with `-t "lands after stop"` against the previous `pins.ts` (stash, then pop): 1 failed, 11 skipped — the new case fails without the fix.
- `pnpm gate` (repo root, re-run on 2026-10-17): GATE PASS.
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`, `PASS  effect`, `PASS  tests @zilar/mobile`
  - `scope: every changed file is inside the Allowed files`, `size: every changed source file is within 400 lines`

### Disagreements
None.

### Notes for the lead
- The test publishes pins through `seedCachedPins` (the T-1914 cold-start path) rather than a network load, since it is the same map and keeps the test free of API stubbing. A comment in the case names the shared-JID risk.

## Review (written by Claude)

Merged on 2026-10-17 at HEAD `20024e99e`. The NEEDS LEAD packet (21:33) predates the fix `c676306ed` (21:35) for its should-fix.
- **The change:**
  - sign-out runs `pins.clear()` through `teardown`;
  - a `pinsEpoch` bumped by `clear()` makes a load, pin or unpin that started before sign-out drop its `publish` and `setError`, so a late answer can't put the previous user's pins back.
- **Tests:** two lifecycle tests (stop clears the pins; a load landing after stop does not republish).

