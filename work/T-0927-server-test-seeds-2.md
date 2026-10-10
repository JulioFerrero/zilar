---
id: T-0927
title: "Server tests: actions/ and agents/ use the shared seed module from T-0925 (simplify plan 5.4, F-F4, part 2)"
status: blocked
milestone: M5
branch: task/T-0927-server-test-seeds-2
model: auto
effort: default
depends_on: [T-0925]
estimate: 0.5 day
---

# T-0927: Shared server test seeds, part 2

**Cancelled (lead, 2026-10-10):** under Julio's minimal-test rule, T-0931 deletes most of these test files. Not to be launched.

## Spec (written by Claude, do not edit)

### Why
T-0925 (merged) added `apps/server/src/test-support/seed.ts`, with `seedUser`, `seedAi` (returns `{ aiId, jid }`) and `seedGroup` (returns `{ groupId, generalTopicId }`), and moved `approvals/` and `tools/` onto it. Read its Report.

This task moves the local copies in `actions/` and `agents/`. The lead listed them on main on 2026-10-10:
- `apps/server/src/actions/demo.test.ts`: `seedUser` `:41`, `seedAi` `:53`, `seedGroup` `:74`
- `apps/server/src/actions/flow.e2e.test.ts`: `seedAi` `:162`
- `apps/server/src/actions/gateway.test.ts`: `seedUser` `:77`, `seedAi` `:90`, `seedGroup` `:111`
- `apps/server/src/agents/delegation/service.test.ts`: `seedAi` `:55`, `seedGroup` `:75`
- `apps/server/src/agents/gateway.groups.test.ts`: `seedGroup` `:82`
- `apps/server/src/agents/gateway.listener.test.ts`: `seedGroup` `:86`
- `apps/server/src/agents/listener/score.test.ts`: `seedAi` `:29`, `seedGroup` `:51`
- `apps/server/src/agents/memory/cleanup.test.ts`: `seedAi` `:28`, `seedGroup` `:151`
- `apps/server/src/agents/memory/compactor.test.ts`: `seedAi` `:19`
- `apps/server/src/agents/memory/store.test.ts`: `seedAi` `:35`

### What to build
1. **Move each file above onto the shared helpers.** Pass overrides wherever a copy's defaults or columns differ. If a copy needs a column the shared helper lacks, add it to `seed.ts` as an override with the old default, and extend `seed.test.ts` to cover it.
2. **T-0925's nits:**
   - `seedGroup` skips the member insert when `members` is empty;
   - add one test for that.
3. **Keep each file's test count and assertions.** A copy that does far more than the shared helper (extra tables, or a different shape) may stay local; list it in the Report with the reason.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the Report of `work/T-0925-server-test-seeds.md`, `apps/server/src/test-support/seed.ts` with its test, and the 10 files above.

### Allowed files
`apps/server/src/test-support/seed.ts`, `apps/server/src/test-support/seed.test.ts`, `apps/server/src/actions/demo.test.ts`, `apps/server/src/actions/flow.e2e.test.ts`, `apps/server/src/actions/gateway.test.ts`, `apps/server/src/agents/delegation/service.test.ts`, `apps/server/src/agents/gateway.groups.test.ts`, `apps/server/src/agents/gateway.listener.test.ts`, `apps/server/src/agents/listener/score.test.ts`, `apps/server/src/agents/memory/cleanup.test.ts`, `apps/server/src/agents/memory/compactor.test.ts`, `apps/server/src/agents/memory/store.test.ts`, `work/T-0927-server-test-seeds-2.md`.

T-0928 moves the other server directories onto the same module in parallel. Add new overrides to `seed.ts` only at the end of each helper's overrides type, to keep the merge simple.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/test-support src/actions src/agents
pnpm --filter @zilar/server typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```

### Acceptance
- The Checks pass.
- Each moved file keeps its test count.
- No production file changes.
- The Report lists the differing defaults, any copy kept local, and the lines removed.

---

## Report (written by the worker when done)

## Review (written by Claude)
