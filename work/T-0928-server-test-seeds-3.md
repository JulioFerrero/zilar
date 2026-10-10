---
id: T-0928
title: "Server tests: ais/, audit/, chat-prefs/, groups/, roles/, routines/ and topics/ use the shared seed module from T-0925 (simplify plan 5.4, F-F4, part 3)"
status: todo
milestone: M5
branch: task/T-0928-server-test-seeds-3
model: auto
effort: default
depends_on: [T-0925]
estimate: 0.5 day
---

# T-0928: Shared server test seeds, part 3

## Spec (written by Claude, do not edit)

### Why
T-0925 (merged) added `apps/server/src/test-support/seed.ts`, with `seedUser`, `seedAi` (returns `{ aiId, jid }`) and `seedGroup` (returns `{ groupId, generalTopicId }`). Read its Report.

This task moves the remaining local copies. The lead listed them on main on 2026-10-10:
- `apps/server/src/ais/usage.test.ts`: `seedAi` `:37`
- `apps/server/src/audit/routes.test.ts`: `seedAi` `:34`
- `apps/server/src/audit/service.test.ts`: `seedAi` `:48`, `seedGroup` `:66`
- `apps/server/src/chat-prefs/chat-prefs.test.ts`: `seedAi` `:91`
- `apps/server/src/groups/groups.test.ts`: `seedAi` `:118`
- `apps/server/src/groups/visibility.test.ts`: `seedAi` `:803`
- `apps/server/src/roles/roles.test.ts`: `seedAi` `:139`
- `apps/server/src/routines/scheduler.effect.test.ts`: `seedUser` `:44`
- `apps/server/src/routines/scheduler.test.ts`: `seedAi` `:51`
- `apps/server/src/routines/service.test.ts`: `seedAi` `:31`, `seedGroup` `:49`
- `apps/server/src/topics/topics.test.ts`: `seedAi` `:710`

### What to build
1. **Move each file above onto the shared helpers.** Pass overrides wherever a copy's defaults or columns differ. If a copy needs a column the shared helper lacks, add it to `seed.ts` as an override with the old default, and extend `seed.test.ts`.
2. **Keep each file's test count and assertions.** A copy that does far more than the shared helper may stay local; list it in the Report with the reason.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the Report of `work/T-0925-server-test-seeds.md`, `apps/server/src/test-support/seed.ts` with its test, and the 11 files above.

### Allowed files
`apps/server/src/test-support/seed.ts`, `apps/server/src/test-support/seed.test.ts`, `apps/server/src/ais/usage.test.ts`, `apps/server/src/audit/routes.test.ts`, `apps/server/src/audit/service.test.ts`, `apps/server/src/chat-prefs/chat-prefs.test.ts`, `apps/server/src/groups/groups.test.ts`, `apps/server/src/groups/visibility.test.ts`, `apps/server/src/roles/roles.test.ts`, `apps/server/src/routines/scheduler.effect.test.ts`, `apps/server/src/routines/scheduler.test.ts`, `apps/server/src/routines/service.test.ts`, `apps/server/src/topics/topics.test.ts`, `work/T-0928-server-test-seeds-3.md`.

T-0927 moves `actions/` and `agents/` onto the same module in parallel, and adds an empty-`members` guard to `seedGroup`. Add new overrides to `seed.ts` only at the end of each helper's overrides type, to keep the merge simple.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/test-support src/ais src/audit src/chat-prefs src/groups src/roles src/routines src/topics
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
