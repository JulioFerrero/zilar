---
id: T-0805
title: "Small sweep: delete the spike apps/server/src/ai/integration.ts (decision D4), a marker for scripts/screenshots.ts, groups/events.ts listener isolation as an Effect"
status: merged
milestone: M5
branch: task/T-0805-small-sweep
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0805: Small sweep: delete the spike apps/server/src/ai/integration.ts (decision D4), a marker for scripts/screenshots.ts, groups/events.ts listener isolation as an Effect

## Spec (written by Claude, do not edit)

### Why
This is part of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09. It runs in **wave 1** of the batch mode Julio chose on 2026-10-09: the lead checks the whole wave once and sends every failure back. Plan rows S11 (D4, line 501: delete `ai/integration.ts`, since nothing references it) and the `groups/events.ts` follow-up.

### Verified facts (do not re-derive)
- **`apps/server/src/ai/integration.ts`** (220 lines) is a spike script. `git grep -ln "ai/integration"` outside `work/` and `docs/` finds only the file itself, and no `package.json` script runs it. **Delete it.**
- **`scripts/screenshots.ts`** (199 lines, H1 H2 H8 W4) is a dev script that drives a browser for screenshots (`node:child_process` at line 13). Give it the **marker** `// effect-plain: dev screenshot script, not shipped` in the first 15 lines; the format is at `apps/server/src/sandbox/ip-guard.ts:1`.
- **`apps/server/src/groups/events.ts`** (56 lines, W4): two notifiers, `emitGroupAi` (lines 19-28) and `emitTopicAi` (lines 48-56), each calling every listener inside `try { listener(event) } catch {}`, so that a listener never breaks group management. Emits are synchronous, and callers rely on that.

### What to build
1. Delete `ai/integration.ts`.
2. Add the marker to `scripts/screenshots.ts`.
3. In `groups/events.ts`, replace each try/catch with `Effect.runSync(Effect.forEach(listeners, (l) => Effect.try(() => l(event)).pipe(Effect.ignore), { discard: true }))` or an equivalent that is still synchronous and still isolates each listener. Add `apps/server/src/groups/events.test.ts`: a throwing listener does not stop the next one; an unsubscribe mid-emit works; the emit is synchronous.

Follow `docs/EFFECT_BRIEF.md` (the wave rules, the building blocks and the traps).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, `apps/server/src/groups/events.ts`, `scripts/screenshots.ts:1-20`.

### Allowed files
`apps/server/src/ai/integration.ts`, `scripts/screenshots.ts`, `apps/server/src/groups/events.ts`, `apps/server/src/groups/events.test.ts`, `work/T-0805-small-sweep.md`.

### Checks (wave mode: your own tests and your package typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/groups
pnpm --filter @zilar/server typecheck
```
Run the tests 3 times when the code has timers or concurrency. Run `pnpm exec prettier --write` on your changed files before committing.

### Acceptance
- Each listed source file is `effect` (or carries a valid marker where the task says so) in `pnpm effect:map`.
- Exported names, signatures, texts and behaviour are unchanged, or each difference is listed in the Report.
- Existing tests pass unchanged; new tests pass; the package typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

- `apps/server/src/groups/events.ts`: effect:map kind `effect` (was needs-effect: W4 try/catch). Both emitters now go through one helper, `notifyListeners`: `Effect.runSync(Effect.forEach(listeners, (l) => Effect.try(() => l(event)).pipe(Effect.ignore), { concurrency: 1, discard: true }))`. The exports and signatures are unchanged.
- `apps/server/src/groups/events.test.ts` (new): 5 tests. Throwing listener does not stop the next one (group and topic), unsubscribing a later listener mid-emit skips it, unsubscribing itself does not skip the next one, and delivery is synchronous. Not counted by effect:map (test file).
- `scripts/screenshots.ts`: marker `// effect-plain: dev screenshot script, not shipped` added as line 1. effect:map kind `exempt` (marker). No other change.
- `apps/server/src/ai/integration.ts`: deleted with `git rm`. Before deleting, `git grep` showed no import of it anywhere in apps, packages or scripts; the only hit was its own header comment. It is no longer in effect:map.
- Tests: `pnpm --filter @zilar/server exec vitest run --reporter=dot src/groups`: first run 82 passed, 4 failed. The 4 failures were 5s timeouts in the DB-backed visibility and groups tests (the package script uses 30s; I ran without it). The rerun passed 86/86. Before the change there were 81 tests in 2 files, and 86 in 3 files now (81 + 5 new).
- Typecheck: `pnpm --filter @zilar/server typecheck` exit 0.
- Behaviour differences: none in what the listeners receive or when. Sequential `forEach` walks the Set live (`concurrency: 1` is the default, and it uses the live iterator), so mid-emit unsubscribe and mid-emit additions behave as before. A throwing listener is still silently dropped (no log). A listener that returns a rejected Promise is still not awaited, as before.
- Unsure: the first groups run timed out under machine load, so the DB tests can be flaky at the default 5s timeout. That was not caused by this change; the rerun passed.

## Review (written by Claude)

**2026-10-09, lead (wave 1):** approved. The lead reviewed the Report. The wave 1 combined check (all 12 branches on one tree, by hand) passed the whole-repo typecheck and every package suite: web 1916, server 2279, mobile 2222, xmpp-core 245, runner 63, runner-tunnel 71, devtools 796 after the T-0799 fix, chat-core 174, protocol 174.
- Worker: Haiku 5.5. The `ai/integration.ts` spike is deleted (D4), `screenshots.ts` is marked, and `groups/events.ts` is a synchronous Effect with 5 new tests.
