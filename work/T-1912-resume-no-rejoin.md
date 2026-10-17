---
id: T-1912
title: "Smooth app task 10a: a resume whose XMPP stream was resumed (stream management kept the session) does not rejoin every group room; only a rebound (a fresh session) or a core without wake() rejoins, as today"
status: merged
milestone: M5
branch: task/T-1912-resume-no-rejoin
model: auto
effort: default
depends_on: [T-1909]
estimate: 30 min
---

# T-1912: Coming back to the app doesn't rejoin every room when nothing was lost

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/smooth-app.md` §2 item 4 and §5 task 10.** Every return to the app rejoins every group and topic room, one after another, even when the stream-management resume kept the session and all its rooms. That is one round trip per room on every resume, for nothing. When ejabberd resumes the session (`resumed`), the room occupancy and the queued stanzas survive, so no rejoin is needed. A `rebound` is a fresh session and still rejoins.

### Facts (read by the lead on 2026-10-17)
- **`packages/client-core/src/store/online.ts:32-47`:** `wakeAndResend(ctx, current): Effect.Effect<void, unknown>`:
  - without `current.wake` it returns `fromPromise(() => current.connect())`;
  - otherwise it runs `wake()`, marks the outbox when the outcome is `'rebound'`, then `Effect.asVoid`.
- **`WakeOutcome = 'resumed' | 'rebound'`** (`packages/xmpp-core/src/types-suspend.ts:8`, exported from `packages/xmpp-core/src/types.ts:25`). The core's wake reports `'resumed'` only when the stream-management id is unchanged (`packages/xmpp-core/src/core-effect/suspend.ts:91-107`).
- **The resume path** in `packages/client-core/src/store/lifecycle.ts:171-191`: `wakeAndResend(ctx, current).pipe(Effect.andThen(...))` sets `online`, runs `flushOnline(ctx)`, then always calls `ctx.fx.joinGroups(current, me, { first, onJoined })`, then sets `ctx.groupsJoined = true` and `flushPending(ctx)`.
- **The only caller** of `wakeAndResend` is `lifecycle.ts:171`.
- **The tests** are in `packages/client-core/src/store/lifecycle.test.ts`: the `describe('resume gate (R8)')` block at `:204`, including the "wakes a stale-online core…" case.

### Steps
1. **`online.ts`:** `wakeAndResend` returns `Effect.Effect<WakeOutcome | 'unknown', unknown>`:
   - the outcome from `wake()`;
   - `'unknown'` on the `connect()` fallback.

   Keep the rebound outbox marking. Update its doc comment.
2. **`lifecycle.ts` resume path:** take the outcome, and call `joinGroups` only when it is not `'resumed'`. Everything else stays in the same order: `online`, `flushOnline`, `groupsJoined = true`, `flushPending`. Add a one-line comment saying why.
3. **Tests** (the message pipeline), two new cases in `lifecycle.test.ts` next to the F1 case:
   - a core whose `wake` resolves `'resumed'` → `joinGroups` is not called;
   - `'rebound'` → it is called once.

   Use the existing `lifecycleCtx` helper and the `fx` spy pattern the F1 case uses.
4. **Size:** source files stay at most 400 lines.

### Allowed files
- `packages/client-core/src/store/online.ts`
- `packages/client-core/src/store/lifecycle.ts`
- `packages/client-core/src/store/lifecycle.test.ts`
- `work/T-1912-resume-no-rejoin.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/lifecycle.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A resumed stream** skips the room rejoin.
- **A rebound, or a core without `wake`,** rejoins as before.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `packages/client-core/src/store/online.ts`: `wakeAndResend` now returns the `wake()` outcome (`Effect.Effect<WakeOutcome | 'unknown', unknown>`) instead of `void`. The `connect()` fallback resolves `'unknown'` (via `Effect.as('unknown')`); the rebound outbox marking is unchanged. The doc comment says what the outcome is for.
- The `WakeOutcome` type is not re-exported from the `@zilar/xmpp-core` package root (only `packages/xmpp-core/src/types.ts` has it, not `index.ts`), and `xmpp-core` is outside the Allowed files, so `online.ts` derives it locally: `type WakeOutcome = Awaited<ReturnType<NonNullable<XmppCore['wake']>>>`. Behaviour and type are the core's own.
- `packages/client-core/src/store/lifecycle.ts`: the resume path takes the outcome and calls `fx.joinGroups` only when `outcome !== 'resumed'`. Everything else keeps its order: `online`, `flushOnline`, `joinGroups`, `groupsJoined = true`, `flushPending`. One comment says a resumed stream kept the room occupancy, so only a fresh session (or a core without `wake`) rejoins.
- `packages/client-core/src/store/lifecycle.test.ts`: added `me?: { id: string }` to the local `LifecycleState` (the default stays unset, so the F1 case still skips the join), and two cases after F1 in the `resume gate (R8)` block:
  - `'resumed'` → `fx.joinGroups` not called, `groupsJoined` still set;
  - `'rebound'` → `fx.joinGroups` called once with the core, `me` and the hooks object.
- Source files stay well under 400 lines (`lifecycle.ts` 251, `online.ts` 55).

### Checks run
- `pnpm install --frozen-lockfile`: Done in 18.4s.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/lifecycle.test.ts`: 15 passed (1 file), including the two new cases. Run twice (before and after the `WakeOutcome` type fix), both green.
- `pnpm --filter @zilar/client-core exec tsc --noEmit`: no output (clean). Run while fixing the missing export; the final `pnpm gate` typecheck also passed.
- `pnpm gate` from the repo root — summary:
  - `gate: 4 changed file(s) against main`
  - `PASS  install (frozen)  (3.3s)`
  - `PASS  format  (1.4s)`
  - `PASS  lint  (2.2s)`
  - `PASS  typecheck  (3.5s)`
  - `PASS  effect  (1.3s)`
  - `PASS  tests @zilar/client-core  (10.5s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Notes for the lead
- One deviation: the spec asks `wakeAndResend` to return `Effect.Effect<WakeOutcome | 'unknown', unknown>`, and it does, but the type is derived from `XmppCore['wake']` because the package root does not export `WakeOutcome`. If you prefer the named export, a one-line re-export in `packages/xmpp-core/src/index.ts` would let `online.ts` import it; that file was outside my Allowed files.
- The first `pnpm gate` failed on typecheck for exactly that missing export; the final run (pasted above) is the one that passed.
- No other paths call `wakeAndResend`, so the return-type change has no other fallout.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `880347040`.
- **The change:**
  - `wakeAndResend` returns the wake outcome (`'unknown'` on the `connect()` fallback), and still marks the outbox on a rebound;
  - the resume path rejoins only when the outcome is not `'resumed'`;
  - the order of `online`, `flushOnline`, `groupsJoined` and `flushPending` is unchanged.
- **Tests:** resumed means no rejoin; rebound means one rejoin.
- **Not done (minor cleanup):** the nit (no test for the `'unknown'` path) and the follow-up (re-export `WakeOutcome` from the xmpp-core root).

