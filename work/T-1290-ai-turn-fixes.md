---
id: T-1290
title: "AI turn fixes: the 120 s turn cap bounds each model call (AI-14); group mentions from different people aren't merged into one turn (AI-9); a failed room turn tells the asker plainly and DMs the owner the real reason once a day per room (AI-10)"
status: todo
milestone: M5
branch: task/T-1290-ai-turn-fixes
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1290: AI turn fixes

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ai-features-audit.md`:
- **AI-14** (P2, `:116`): `TOOL_TURN_WALL_CLOCK_MS` (120 s) is checked only before each round (`apps/server/src/agents/dm-tool-turn.ts`). Each model call has its own 90 s timeout (`apps/server/src/agents/tool-loop.ts`), and the closing call adds another, so a slow provider holds the turn (and every later owner message) for about 5 minutes.
- **AI-9** (P2, `:197`): group mentions merge into one turn whose trigger is the last item (`apps/server/src/agents/gateway/group-turn.ts`), and the reply tags only that sender (`apps/server/src/agents/group-turn.ts`). The audit's fix is in `apps/server/src/agents/gateway/group-ingest.ts`: don't merge items from different senders.
- **AI-10** (P2, `:203`): a failed room turn sends `@asker <mapFailureToReply>` (`gateway/group-turn.ts`). That text asks the asker to fix the **owner's** key or budget, and the owner never hears of it.

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **AI-14:** each `requestCompletion` in a tool turn (rounds and the closing call) gets `timeoutMs: max(5 000, remaining)`, where remaining is the turn's wall-clock budget.
2. **AI-9:** in `group-ingest.ts`, merge queued mentions only when they come from the same sender. A different sender starts a new turn that runs after the current one, keeping order.
3. **AI-10:**
   - **in rooms**, the asker gets "I can't answer right now. My owner has been told.";
   - **the owner** gets a DM from the AI with the real reason (the existing `mapFailureToReply` text), at most once per day per room. Use the `dailyLimitNotices` pattern in `apps/server/src/agents/gateway/budget.ts` (cite it);
   - DM turns keep today's text.
4. **Tests,** up to 3, in `apps/server/src/agents/gateway-group.test.ts` (the nearest; cite another if better):
   - two senders' mentions make two turns;
   - a room failure sends the generic line plus one owner DM, and a second failure the same day sends no second DM;
   - for AI-14, a test only if a fake clock makes it simple.

### Read first
`AGENTS.md`, `docs/audit/ai-features-audit.md` (`:39-53`, `:116`, `:197-210`), and the files above.

### Allowed files
`apps/server/src/agents/**/*.ts`, `work/T-1290-ai-turn-fixes.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. Every file stays at most 400 lines.

---

## Report (written by the worker when done)

## Review (written by Claude)
