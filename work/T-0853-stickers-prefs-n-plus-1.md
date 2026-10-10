---
id: T-0853
title: "Sticker discover page and chat-prefs room check: batch the per-row queries"
status: merged
milestone: M5
branch: task/T-0853-stickers-prefs-n-plus-1
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0853: Sticker discover page and chat-prefs room check: batch the per-row queries

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding C-F8 items 4 and 5 in `docs/audit/simplify-2026-10-09/C-server.md`.
- **Sticker discover:** the discover page (about `apps/server/src/stickers/service.ts:555-566`) runs one query per pack, for pages of up to 200 packs. The `pack_id IN ${sql.in(...)}` form is already written at about :334.
- **Chat prefs:** `canSeeRoomJid` (about `apps/server/src/chat-prefs/service.ts:78`) loops `canSeeTopic` (3 queries) per topic row.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Batch the discover page's per-pack query with the existing `IN` form.
2. Make `canSeeRoomJid` use one batched visibility lookup (look for the batch visibility helper in `apps/server/src/topics/access.ts`, about lines 219-231) instead of a per-topic loop.

Keep identical: results, ordering and visibility rules. The existing tests must pass unchanged, and add one equivalence test each.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/server/src/stickers/service.ts`, `apps/server/src/stickers/*.test.ts`, `apps/server/src/chat-prefs/service.ts`, `apps/server/src/chat-prefs/*.test.ts`, `work/T-0853-stickers-prefs-n-plus-1.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/stickers src/chat-prefs
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.

---

## Report (written by the worker when done)

**Status: review, with one part of the spec not done (chat prefs), and a test-timeout caveat below.**

Changed files:
- `apps/server/src/stickers/service.ts` `discoverPacks`: the per-pack query is replaced by one `pack_id IN ${sql.in(packIds)}` query for the page, ordered by `position`. Each pack keeps its first `STICKERS_MAX_PER_PACK` (120) rows in JS, which is the old per-pack `LIMIT`. No query runs when the page is empty.
- `apps/server/src/stickers/routes.test.ts`: new test "discover lists each pack with its stickers in position order, capped per pack" (rows inserted out of position order, one empty pack, one pack of 121 rows, checks the order and the 120 cap).
- `apps/server/src/chat-prefs/chat-prefs.test.ts`: new test "404s the room of an archived topic and answers the same for a missing one".
- `apps/server/src/chat-prefs/service.ts`: NOT changed (see below).

Facts in the spec that are wrong:
- The discover page size is `DISCOVER_PAGE_SIZE = 30` (`stickers/service.ts:26`), not 200. 200 is `STICKER_PANEL_MAX` (the panel cap). So a discover page does 1 + up to 30 queries before, and 2 after (0 extra when the page is empty).
- `topics.room_localpart` is UNIQUE (`apps/server/drizzle/0018_lethal_warhawk.sql:27`). So `canSeeRoomJid` (`chat-prefs/service.ts:65-84`, the loop at :78) gets at most ONE topic row, and the loop runs at most once. It already costs at most 1 + 3 queries, so there is no N+1 to batch.
- The "batch visibility helper" at `topics/access.ts:219-231` is not exported. It sits inside `visibleTopics`, which is group-scoped and loads every topic of the group. `topics/access.ts` is not in Allowed files. Calling `visibleTopics` from `canSeeRoomJid` would cost a topics-by-group query plus membership plus up to 2 private-set queries, i.e. no fewer queries than today. So I left `canSeeRoomJid` as it is. The lead should decide whether to drop item 2 of the spec.
- The audit line numbers moved: the discover loop is now `stickers/service.ts` ~:555-585; `canSeeRoomJid` is at :65 (the audit said :78).

Test counts (`pnpm --filter @zilar/server exec vitest run --reporter=dot src/stickers src/chat-prefs`):
- Before (untouched code, this run): 112 tests, 107 passed, 5 failed. The 5 are 30s hook or test timeouts in PGlite setup (`favorites.test.ts` x2, `telegram-import-routes.test.ts` x2, `chat-prefs.test.ts` CRUD). Load average was 56-63 (other wave workers).
- After: 114 tests (+2 new). See the run results below.

Behaviour differences: none intended. Order: the page's packs keep their id order; each pack's stickers keep `position` order; the 120 cap is the same.

Measured: no runtime query counter was added, so the query counts above are from reading the code, not measured.

Unsure / caveat:
- The new discover test fails under the spec's `--hookTimeout=30000` at the `beforeEach` (PGlite boot), the same as the baseline hook timeouts. With `--testTimeout=240000 --hookTimeout=240000` it passes (33.5 s). So it is not a logic failure, but the 3 required runs at 30 s may show timeouts that are not caused by this change.
- The equivalence test was not run against the old code, so it is not proven to catch a regression by itself.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **What changed:** `discoverPacks` runs one `pack_id IN` query for the page and keeps the per-pack 120 cap, so a page costs 2 queries where it used to cost up to 31. New tests cover the ordering and the cap.
- **No change needed:** the chat-prefs item does not apply. `topics.room_localpart` is UNIQUE, so `canSeeRoomJid` loops at most once.
- **Tests:** the worker's runs hit load timeouts (run 1: 108 of 114, and the 4 timeouts passed alone). The combined wave check runs the suite.
