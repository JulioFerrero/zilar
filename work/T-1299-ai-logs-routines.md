---
id: T-1299
title: "AI failure logs carry a failure class and no provider free text (AI-22); routines: the tick no longer blocks while runs are in flight, a run more than 1 h late is skipped instead of firing, and a post that fails during a reconnect is retried once (AI-18); tested"
status: todo
milestone: M5
branch: task/T-1299-ai-logs-routines
model: auto
effort: default
depends_on: [T-1290]
estimate: 0.4 day
---

# T-1299: AI failure classes; routine timing

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ai-features-audit.md`:
- **AI-22** (P2, `:321`): failure logs carry `toRedactedError(err)` (`apps/server/src/agents/gateway/dm-turn.ts`, `apps/server/src/agents/dm-turn.ts`), whose message holds the provider's error text (`apps/server/src/agents/tool-loop.ts`). Some provider errors quote parts of the request, and there's no `kind` field to count failures by.
- **AI-18** (P2, `:287`):
  - a tick claims at most 5 routines and runs them 2 at a time, and it skips the next tick while busy (`apps/server/src/routines/scheduler.ts`);
  - after an outage, an overdue routine runs once on start even when it's 8 hours late;
  - a post during the AI's reconnect returns false and the run is `skipped`.

**First recheck both findings on main.** If one is already fixed, say so with `file:line` and skip it.

### What to build
1. **AI-22:**
   - failure logs carry a `kind` (the existing `mapFailureToReply` classes: key rejected, budget, rate limited, timeout, provider error, other; cite them) and the HTTP status if there is one;
   - **no** provider free text. Keep the free text out of logs entirely, or keep only its first 80 characters after redaction, and say which in the Report.
2. **AI-18:**
   - the tick claims and starts due runs without waiting for the previous tick's runs (keep the concurrency limit of 2, through a queue);
   - a run more than 1 hour past its scheduled time is marked `missed` (or the existing status that fits; cite it) and its next run is scheduled, with no post;
   - a post that fails because the AI's session is reconnecting is retried once after 30 s before being marked `skipped`.
3. **Tests,** up to 3, in the nearest routines or agents tests (cite them):
   - an 8-hour-late run is marked missed with no post;
   - a failed post is retried once;
   - a failure log has `kind` and no provider text.

### Read first
`AGENTS.md`, `docs/audit/ai-features-audit.md` (`:287-300`, `:321-330`), `apps/server/src/routines/scheduler.ts`, `apps/server/src/agents/tool-loop.ts` and the dm-turn files above.

### Allowed files
`apps/server/src/routines/*.ts`, `apps/server/src/agents/**/*.ts`, `work/T-1299-ai-logs-routines.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines src/agents --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. Every file stays at most 400 lines. No migration.

---

## Report (written by the worker when done)

## Review (written by Claude)
