---
id: T-0918
title: "Store core T9: the mobile store on the core polling and lifecycle (boot, connect retry with backoff Q3, resume, stop then reset), tests first"
status: todo
milestone: M5
branch: task/T-0918-store-core-t9-mobile-lifecycle
model: auto
effort: default
depends_on: [T-0915, T-0917]
estimate: 1 day
---

# T-0918: Store core T9, mobile on the core polling and lifecycle

## Spec (written by Claude, do not edit)

### Why
This is task T9 of `docs/STORE_CORE_PLAN.md` (section 6, "T9: mobile on core polling and lifecycle (mobile), live"). Its risk is high: resume, reconnect and sign-out on the phone.

T-0915 (merged) moved polling and the lifecycle into the core, and the web store runs on them:
- `packages/client-core/src/store/lifecycle.ts`: `CONNECT_RETRY_DELAYS_MS` `:37`, `startStore` `:96`, `retryBoot` `:108`, `stopStore` `:118`, `reset` `:135`, `reconnect` `:157`;
- `packages/client-core/src/store/polling.ts`: `startChatsPolling` `:98`, `startPinsPolling` `:104`, the draft turn helpers `:110-130`.

The lead located the mobile code on main on 2026-10-10:
- `apps/mobile/src/store/effects/polling.ts` has 230 lines and `effects/lifecycle.ts` 273;
- `effects/ports.ts` (172 lines) has `AppStateLike` at `:20`;
- `effects/runtime.ts` has 295 lines;
- `apps/mobile/src/store/real-store.ts`: `initialUserState` `:664`, `teardown` `:711`, `ledger.reset()` `:738`, and `start` and `stop` at `:771-772`.

### What to build
1. **Tests first,** in a new file `apps/mobile/src/store/real-store.lifecycle.test.ts`, committed on the old code:
   - what must not change:
     - boot loads chats and contacts;
     - resume after the app comes back to the foreground reconnects and awaits an in-flight boot;
     - sign-out (`stop()`) clears every user-scoped field (T-0901's test in `real-store.sign-out.test.ts` must keep passing unedited);
     - `start()` twice does not boot twice;
   - then a failing commit: a rejected `connect()` retries after 2 s, then 5 s, and so on (Q3 is decided yes; plan section 8).
2. **The move:**
   - `effects/polling.ts` and `effects/lifecycle.ts` become bindings over the core;
   - `AppStateLike` becomes the core `visibility` port;
   - the `Life` adapter in `effects/runtime.ts` goes once nothing uses it;
   - `real-store.ts` start and stop use the core `startStore` and `stopStore`, then `reset`, so sign-out still clears everything;
   - mobile sets `flags.connectRetry: true` and `flags.reconnectOnResume: true`.
3. **T-0915's nit:** make the core `reset()` also clear the finished-turn set (`packages/client-core/src/store/lifecycle.ts:135`), with a core test.
4. **Unchanged:** the only behaviour change is the connect retry (R7, Q3). No existing test is edited.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use the `@/test/wait` helpers, never a raw `setTimeout(resolve, 0)`), `docs/STORE_CORE_PLAN.md` sections 2.3, 3, 6 (T9) and 8, the Reports of `work/T-0901-*.md`, `work/T-0915-*.md` and `work/T-0917-*.md`, `packages/client-core/src/store/{lifecycle,polling,ports,ctx}.ts`, and the mobile store.

### Allowed files
`apps/mobile/src/store/effects/polling.ts`, `apps/mobile/src/store/effects/lifecycle.ts`, `apps/mobile/src/store/effects/ports.ts`, `apps/mobile/src/store/effects/runtime.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `apps/mobile/src/store/real-store.lifecycle.test.ts`, `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/lifecycle.test.ts`, `packages/client-core/src/store/ports.ts` and `packages/client-core/src/store/ctx.ts` (only small additions mobile needs), `work/T-0918-store-core-t9-mobile-lifecycle.md`.

T-0919 moves pins, prefs and folders in parallel: do not touch `apps/mobile/src/store/effects/pins.ts` or `events.ts`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the mobile `src/store` tests 3 times. The lead runs the phone smoke.

### Acceptance
- The Checks pass, 3 runs.
- The test commits come before the move.
- No existing test is edited.
- The Report gives the lines per side and the flags mobile sets.
- Live check for Julio on the emulator: background then foreground, airplane mode on then off (the chat reconnects by itself within about a minute), and sign out then sign in as another user.

---

## Report (written by the worker when done)

## Review (written by Claude)
