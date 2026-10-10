---
id: T-0887
title: "Server: cut the loop-driven slow tests (600 real requests for a 429, 200 sticker uploads) without weakening them"
status: merged
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

Code commit: `0bf09cc6` (T-0887: cut loop-driven slow tests). Report commit: this file, on the same branch.

**Files changed (all Allowed):**
- `apps/server/src/files/api.ts`: new optional `rateLimitMax` dep (default still `FILES_RATE_LIMIT_MAX` = 600). Three lines, nothing else. This is the minimal api.ts touch the spec allowed (lead rebases vs T-0867).
- `apps/server/src/files/routes.test.ts`: the 429 test now uses a limit of 3 (3 x 200, then 429 `rate_limited`). The `filesApp` helper takes an optional third argument. Renamed the title to "answers 429 after the per-minute limit" (was "after 600 requests a minute"). Same boundary and error code.
- `apps/server/src/stickers/favorites.test.ts`: new `seedStickers(userId, count)` helper, which inserts `sticker_packs`, `user_sticker_packs` and `stickers` rows with the same columns as the upload route (service.ts:382-384, :883). Used by the three 200-sticker tests. Imports: `randomUUID`, `Effect`, `SqlClient`, `testSql`, `STICKERS_MAX_PER_PACK`.

**Spec facts that differ from the audit:**
- The spec says "three tests". Four tests in favorites.test.ts had 200-sticker HTTP loops: the cap test (was :201), "re-stars ... at the cap" (was :251), "lists 200 favorites" (was :336), plus the 201st uploads. I converted the three that loop 200 uploads; the 201st upload is seeded too in the cap test. I did not convert any other test.
- The 429 test is no longer 600 real requests. `FILES_RATE_LIMIT_MAX` (600) is still the production default and is not asserted by any test now.
- Each test keeps the same assertions: 200 for each favorite PUT, then `favorites_full` (400) on the 201st, and `re-stars` 200 at the cap. The `lists 200 favorites` test keeps its query-count bound.

**Lines removed (measured with `git show 0bf09cc6 --stat`):** 3 files, 54 insertions, 100 deletions. `favorites.test.ts` alone: 141 lines changed (97 deleted, the rest added, including the seed helper). `routes.test.ts`: 9 lines changed. `api.ts`: 4 lines changed.

**Durations (machine shared; `uptime` load in brackets).** The per-test time is mostly fixture setup (fresh PGlite per test, 20-40 s under load), so per-test numbers are noisy:
- Before (HEAD, one run of both files, verbose): 429 test 33.5 s [load 67]; cap 38.3 s; re-star 30.1 s; lists-200 41.3 s; total 466 s [load 75].
- After (same two files, verbose, one run): 429 test 24.3 s [load 65]; cap 25.0 s; re-star 23.4 s; lists-200 26.1 s; total 417 s [load 52].
- Before, first full run of `src/files` + favorites: 238.9 s total [load 116].
- After, three post-commit Checks runs: 108.7 s [load 72], 61.6 s [load 86], 353.7 s [load 57]. The spread is machine load, not the tests, so I do not claim a clean speed-up number from these.

**Checks:**
- `vitest run ... src/files src/stickers/favorites.test.ts` (wave command): 26 passed in each of 3 runs (26/26 x3). Test files 2 passed.
- `pnpm --filter @zilar/server typecheck` (`tsc --noEmit`): no errors.
- `oxlint` on the 3 changed files: clean. Prettier: unchanged.
- Did not run `pnpm gate` or the full suite (wave mode).

**Unsure:**
- The "lists 200 favorites" test (`toEqual(ids)`) relies on the seeded star order, and the listing query does not read sticker files on disk. Both pass; I did not inspect the list path for file reads beyond that.
- Temporary copies of the HEAD files were created for the baseline run (`zz-baseline-*.test.ts`) and deleted before the commit. Nothing else was created in the repo.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **What changed:** the files 429 test uses an injected limit of 3 instead of 600 real requests, and the three 200-sticker tests seed the stickers with direct SQL. The assertions are the same.
- **Timing:** load hid the saving.
- **Overlap:** `files/api.ts` also gets T-0867's sweep, and the combined check merges them.
- **Check:** the combined wave 4 check passes.
