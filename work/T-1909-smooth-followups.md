---
id: T-1909
title: "Smooth app follow-ups from the T-1902/T-1903 reviews: web sessionGone also clears the message cache (zilar:messages), and the phone StoreFx.joinGroups declares the hooks parameter so effects/lifecycle.ts drops its function-type cast"
status: merged
milestone: M5
branch: task/T-1909-smooth-followups
model: auto
effort: default
depends_on: [T-1902, T-1903]
estimate: 20 min
---

# T-1909: Follow-ups from the T-1902 and T-1903 reviews

## Spec (written by Claude, do not edit)

### Why
These come from the pre-reviews of T-1903 (the web message cache) and T-1902 (history waits for its own room).
- **The session-expiry path:** when the session dies, sign-out clears the chat list cache but leaves the new message cache in localStorage until the next sign-in. That is data at rest that should go with the session.
- **The phone wiring** hides a wrong signature behind a function-type cast.

### Facts (read by the lead on 2026-10-17)
- **Web:**
  - `apps/web/src/lib/api/sessionGone.ts:53-54`: `sessionGone(goToLogin, storage?)` calls `clearChatListCache(storage === undefined ? defaultSessionGoneStorage() : storage)` (imported at `:10` from `@/store/chatListCache`);
  - `clearMessageCache(storage: StorageLike | null)` exists at `apps/web/src/store/messageCache.ts:203`;
  - there is a test file, `apps/web/src/lib/api/sessionGone.test.ts`.
- **Phone:**
  - `apps/mobile/src/store/effects/runtime.ts:241` declares `joinGroups(current: XmppCore, me: Me): Effect.Effect<void, never, Ports>`;
  - the real implementation (`apps/mobile/src/store/effects/groups.ts`) takes a third `hooks?: JoinGroupsHooks`;
  - `apps/mobile/src/store/effects/lifecycle.ts:223-234` bridges the two with a cast and a comment saying `StoreFx` has no hooks parameter yet;
  - `JoinGroupsHooks` is exported from `packages/client-core/src/store/ctx.ts`.

### Steps
1. **`sessionGone.ts`:** compute the storage once, then call both `clearChatListCache(s)` and `clearMessageCache(s)` (import from `@/store/messageCache`). Update the doc comment's list. In `sessionGone.test.ts`, extend the existing clear-cache test (or add one) to assert that `zilar:messages` is removed too.
2. **Phone `runtime.ts:241`:** `joinGroups(current: XmppCore, me: Me, hooks?: JoinGroupsHooks): Effect.Effect<void, never, Ports>`, importing the type the way `groups.ts` does.
3. **Phone `lifecycle.ts:223-234`:** `joinGroups: (core, me, hooks) => ctx.run(ctx.fx.joinGroups(core, me as Me, hooks))`, with no cast. Remove the "no hooks parameter yet" comment, and remove any import left unused.
4. **Nothing else changes.** Files stay at most 400 lines.

### Allowed files
- `apps/web/src/lib/api/sessionGone.ts`
- `apps/web/src/lib/api/sessionGone.test.ts`
- `apps/mobile/src/store/effects/runtime.ts`
- `apps/mobile/src/store/effects/lifecycle.ts`
- `work/T-1909-smooth-followups.md`

### Checks
```bash
pnpm --filter @zilar/web exec vitest run src/lib/api/sessionGone.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A dead session clears `zilar:messages`** as well as the chat list cache.
- **The phone's `joinGroups` type matches its implementation,** and there is no cast.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **Web (`sessionGone.ts`):** the target storage is now computed once into `target`, then `clearChatListCache(target)` and `clearMessageCache(target)` run, so a dead session leaves neither `zilar:chatList` nor `zilar:messages` in localStorage until the next sign-in. The doc comment lists the message cache among the clears.
- **Web test (`sessionGone.test.ts`):** added a test that calls `sessionGone` with a fake storage and asserts both `zilar:chatList` and `zilar:messages` are removed, and that it still navigates to login. `authClient` is mocked so no network runs.
- **Phone (`runtime.ts`):** `StoreFx.joinGroups` now declares `hooks?: JoinGroupsHooks`, importing the type from `@zilar/client-core/store` the same way `groups.ts` does.
- **Phone (`lifecycle.ts`):** the bridge is one line, `joinGroups: (core, me, hooks) => ctx.run(ctx.fx.joinGroups(core, me as Me, hooks))`; the function-type cast and the "no hooks parameter yet" comment are gone, and the now-unused `JoinGroupsHooks` import was removed.
- No other code changed. Changed source files are 76, 56, 290 and 342 lines (all ≤ 400).

### Checks run
- `pnpm install` — completed with no errors.
- `pnpm --filter @zilar/web exec vitest run src/lib/api/sessionGone.test.ts --reporter=dot` — 1 file passed, 5 tests passed.
- `pnpm gate` (first run) — GATE FAIL: `@zilar/mobile:typecheck` reported `lifecycle.ts(222,70): error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'Me'`, because the core hook type declares `me: unknown`. Fixed by using the spec's exact bridge expression, `me as Me` (the removed cast was the function-type one, not this narrowing), then reran the gate.
- `pnpm gate` (final) — GATE PASS:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/mobile  (4.2s)
  PASS  tests @zilar/web  (18.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- **Spec nuance:** step 3 asks for "no cast" but its own code sample contains `me as Me`, and removing it does not typecheck because `StoreAppHooks.joinGroups` in `packages/client-core/src/store/ctx.ts:126` declares `me: unknown`. I kept `me as Me` from the sample; the removed cast is the function-signature cast. If you want the narrowing gone too, the core hook type needs `me: Me`, which is outside this task's Allowed files.
- No open questions, no security-relevant behavior changed beyond clearing additional local cache data at sign-out.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `286d432ea`.
- **Web:** `sessionGone` now clears `zilar:messages` beside the chat list cache, with a test asserting both removals.
- **Phone:** `StoreFx.joinGroups` declares `hooks?: JoinGroupsHooks`, and the cast in `effects/lifecycle.ts` is gone.
- **Live result of T-1902/T-1903** (`8e87ff0`): a cold reload of "cards test" now has its LCP, the card photo, at 184 ms (it was 1360 ms). The `card-media` requests start at 128 ms, before the XMPP token (297 ms).

