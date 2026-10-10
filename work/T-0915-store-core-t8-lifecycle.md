---
id: T-0915
title: "Store core T8: polling, drafts and lifecycle (boot, connect with retry, resume, stop/reset) in packages/client-core, the web store on them, tests first"
status: todo
milestone: M5
branch: task/T-0915-store-core-t8-lifecycle
model: auto
effort: default
depends_on: [T-0912]
estimate: 1.5 day
---

# T-0915: Store core T8, polling, drafts and lifecycle

## Spec (written by Claude, do not edit)

### Why
This is task T8 of `docs/STORE_CORE_PLAN.md` (section 6, "T8: polling, drafts and lifecycle in core (core + web), live"). Follow it. Its risk is high: connect, reconnect and resume.

The lead re-checked the web lines on main on 2026-10-10:
- `apps/web/src/store/effects/lifecycle.ts` has 355 lines:
  - the `pagehide` listener is at `:92-93`;
  - `retryBoot` at `:99`;
  - `signOutStore` at `:122`;
  - the retry delay pick at `:244-245`, using `CONNECT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000]` (`apps/web/src/store/effects/constants.ts:12`);
  - the XMPP attempt Scope `Scope.fork(session.scope)` at `:321`;
  - `connect()` at `:336`.
- `apps/web/src/store/effects/polling.ts` has 199 lines, `effects/ports.ts` 326 and `realStore.ts` 500.

T-0907 and T-0912 already created `packages/client-core/src/store/ctx.ts`, `ports.ts`, `incoming.ts`, `actions.ts`, `reads.ts` and `history.ts`.

### What to build
1. **Tests first,** in a new file `apps/web/src/store/realStore.lifecycle.test.tsx`, committed on the old code:
   - a rejected `connect()` that retries on the delay ladder (nothing covers the reject branch after `:336` today);
   - `start()` called twice without `stop()`;
   - sign-out still resets and reloads, as T-0901 verified for web.
2. **Core:** new `packages/client-core/src/store/polling.ts` and `lifecycle.ts` with tests, plus their lines in a T8 section of `index.ts`. `ports.ts` gains `visibility`, `drafts`, `notifications` and `flags`, as plan section 4 sketches.
   - The XMPP attempt Scope stays.
   - Mobile's "await the in-flight boot on resume" joins behind `flags.reconnectOnResume`.
   - `start()` becomes idempotent (R9).
   - `stop()` keeps the ledger and `reset()` clears it (R10). Check this against T-0901's mobile sign-out fix, which made mobile `stop()` reset all user state. The core must let mobile keep that behaviour: mobile can call `stop()` then `reset()` on sign-out. Say how in the Report.
   - `flags.connectRetry` defaults to true (Q3 is decided yes, plan section 8).
3. **Web:**
   - `effects/polling.ts` and `effects/lifecycle.ts` become bindings. `signOutStore`, the cached paint and `pagehide` stay as adapter code.
   - `effects/ports.ts` gains the focus/visibility adapter.
   - `realStore.ts` start and stop go through the core.
   - Facades stay.
4. **Behaviour on web:** R9 and R10 only, each listed in the Report. Nothing else changes.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0915/`; use `@/test/wait` helpers), `docs/STORE_CORE_PLAN.md` sections 2.3, 3, 4, 6 and 8, the Reports of `work/T-0901-*.md`, `work/T-0907-*.md` and `work/T-0912-*.md`, `packages/client-core/src/store/*`, and the web store.

### Allowed files
`packages/client-core/src/store/polling.ts`, `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/ports.ts`, `packages/client-core/src/store/ctx.ts`, `packages/client-core/src/store/*.test.ts` (new files or new cases), `packages/client-core/src/store/index.ts` (T8 section only), `apps/web/src/store/effects/polling.ts`, `apps/web/src/store/effects/lifecycle.ts`, `apps/web/src/store/effects/ports.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/effects/constants.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.lifecycle.test.tsx`, `work/T-0915-store-core-t8-lifecycle.md`.

T-0914 changes mobile files and may add small cases to core `ctx.ts` and `ports.ts`. Keep your edits there additive.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the `realStore*.test.tsx` files, `reload.test.tsx` and `effects/runtime.test.ts` 3 times.

### Acceptance
- The Checks pass, 3 runs.
- The tests-first commit comes before the move.
- No existing test is edited.
- The Report gives the lines per side, R9 and R10, and how mobile keeps its sign-out reset.
- Live check for Julio on web: AI drafts streaming, a network drop and its reconnect, a tab hidden and then shown, and sign-out.

---

## Report (written by the worker when done)

## Review (written by Claude)
