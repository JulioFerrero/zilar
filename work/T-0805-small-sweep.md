---
id: T-0805
title: "Small sweep: delete the spike apps/server/src/ai/integration.ts (decision D4), a marker for scripts/screenshots.ts, groups/events.ts listener isolation as an Effect"
status: todo
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

## Review (written by Claude)
