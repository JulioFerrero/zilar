---
id: T-0887
title: "Server: cut the loop-driven slow tests (600 real requests for a 429, 200 sticker uploads) without weakening them"
status: todo
milestone: M5
branch: task/T-0887-slow-loop-tests
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0887: Server: cut the loop-driven slow tests (600 real requests for a 429, 200 sticker uploads) without weakening them

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding F-F2 in `docs/audit/simplify-2026-10-09/F-tests.md`.
- **Rate-limit test:** `apps/server/src/files/routes.test.ts` "answers 429 after 600 requests a minute" makes 600 real requests (10.5 s).
- **Sticker cap tests:** `apps/server/src/stickers/favorites.test.ts:201-226` uploads 200 stickers over HTTP in three tests (7-8 s each). The upload limiter is already injectable (`uploadLimiter: { allow: () => true }` at about :211).

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Give the files limiter an injectable limit (the way stickers already injects its limiter), and assert the same 429 boundary with a small limit.
2. Seed the 200 stickers with direct SQL instead of HTTP uploads, keeping the cap assertion.
3. Each test keeps asserting the same behaviour. Report the before and after durations, with `uptime`.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`apps/server/src/files/routes.test.ts`, `apps/server/src/files/*.ts`, `apps/server/src/stickers/favorites.test.ts`, `work/T-0887-slow-loop-tests.md`.

apps/server/src/files/api.ts belongs to sweep T-0867: if the limit option must go into api.ts, add it there minimally and say so (the lead will rebase).

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/files src/stickers/favorites.test.ts
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.

---

## Report (written by the worker when done)

## Review (written by Claude)
