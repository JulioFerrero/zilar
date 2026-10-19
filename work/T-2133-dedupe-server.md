---
id: T-2133
title: "Clean-up (server): remove duplicated blocks the clone scan found (routine support vs routine adapters, row mappers, group member helpers, ffmpeg runner, web-tools fetch) — each block lives once, no behaviour change"
status: merged
milestone: M5
branch: task/T-2133-dedupe-server
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2133: One copy of each duplicated server block

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead ran a clone scan at `d2fde6e4e` (windows of 6 normalised lines, ignoring imports, blanks and comments). It covers `apps/server/src`, excluding `agents/` and the files T-2129 holds tonight. These pairs share code:

| # | File A (lines) | File B (lines) | Shared lines |
| --- | --- | --- | ---: |
| 1 | `apps/server/src/routines/support.ts` (30-42, 99-106, 126-153) | `apps/server/src/tools/routine-adapters.ts` (44-56, 68-75, 89-116) | 19 |
| 2 | `apps/server/src/db/rows-agents.ts` (213-231) | `apps/server/src/media/indexer.ts` (16-34) | 8 |
| 3 | `apps/server/src/groups/ais.ts` (215-222, 267-275, 290-296) | `apps/server/src/groups/members.ts` (32-39, 76-81, 93-99) | 7 |
| 4 | `apps/server/src/groups/member-roles.ts` (62-69) | `apps/server/src/groups/members.ts` (169-178) | 7 |
| 5 | `apps/server/src/db/rows-agents.ts` (105-111, 131-140) | `apps/server/src/tools/service.ts` (80-87, 114-123) | 7 |
| 6 | `apps/server/src/stickers/convert.ts` (192-202, 240-245) | `apps/server/src/voice/engine.ts` (92-102, 144-149) | 7 |
| 7 | `apps/server/src/web-tools/feed.ts` (106-116) | `apps/server/src/web-tools/search.ts` (159-169) | 6 |

### Steps
For each pair, read both copies:
1. **Same code:** keep one copy where the concept lives (for example, the row mapper in `db/rows-agents.ts`) and make the other file import it.
2. **Genuinely different behaviour:** leave the pair and say why in the Report.
3. **Keep the sum smaller:** a shared helper must save more lines than it adds; otherwise skip the pair.

### Rules
- No behaviour change: same SQL, same limits, same log fields.
- Do not touch `apps/server/src/agents/**` or any `api.ts` file.
- No new tests.

### Allowed files
- `apps/server/src/routines/support.ts`
- `apps/server/src/tools/routine-adapters.ts`
- `apps/server/src/db/rows-agents.ts`
- `apps/server/src/media/indexer.ts`
- `apps/server/src/groups/ais.ts`
- `apps/server/src/groups/members.ts`
- `apps/server/src/groups/member-roles.ts`
- `apps/server/src/tools/service.ts`
- `apps/server/src/stickers/convert.ts`
- `apps/server/src/voice/engine.ts`
- `apps/server/src/web-tools/feed.ts`
- `apps/server/src/web-tools/search.ts`
- `apps/server/src/web-tools/shared.ts`
- `work/T-2133-dedupe-server.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and the server tests it runs pass.
- Product lines go down by at least 35.
- The Report lists each pair: done, with lines saved, or skipped, and why.

---

## Report (written by the worker when done)

### What I did

Deduplicated five of the seven pairs; two are left as they are because the shared helper would not save lines or would force a wrong dependency direction.

- **Pair 1 — routines/support.ts ↔ tools/routine-adapters.ts (done, −5 lines net).** Moved the shared chat-pair/title/schedule validation to `parseRoutineBasics` in `routines/support.ts`, and the shared insert tail (unique-card handling, empty-result error) to `insertRoutineRow`. Both routine kinds now call them; same SQL, same error strings, same audit fields.
- **Pair 2 — db/rows-agents.ts ↔ media/indexer.ts (done, −19 lines net).** `indexer.ts` now imports `MediaItemRow` from `db/rows` and defines `MediaItemInsertRow = Omit<MediaItemRow, 'createdAt'>`; the duplicate 21-line interface and the import of `MediaKind` it carried are gone. Same columns, and the insert still leaves `created_at` to the database default.
- **Pair 3 — groups/ais.ts ↔ groups/members.ts (done in part, −10 lines net).** The four copies of the "A group has at most N members" 400 became `groupLimitError()` in `ais.ts` (which `members.ts` already imports). The permission check and the transaction/advisory-lock prologue are unchanged: extracting the permission check saves about 3 lines net, and the lock prologue must stay inside each caller's transaction to keep the lock held.
- **Pair 4 — groups/member-roles.ts ↔ groups/members.ts (skipped).** The shared block is the open transaction + per-group lock + locked actor read. A helper would have to accept the caller's follow-up effect to keep the lock held; the generic wrapper costs more lines than the 7 it removes, so rule 3 says skip.
- **Pair 5 — db/rows-agents.ts ↔ tools/service.ts (done, −13 lines net).** Added `ToolIdentity` in `db/rows-agents.ts`; `AiToolRow` and `PublicTool` both extend it, and `PublicToolRun` is now `AiToolRunRow` (identical shape). `ToolRow` in `tools/queries.ts` was already `AiToolRow`, so this matches the existing pattern.
- **Pair 6 — stickers/convert.ts ↔ voice/engine.ts (skipped).** The duplicates are the ffprobe/ffmpeg argument prefixes. Sharing them needs a shared ffmpeg helper module (not in Allowed files); exporting them from `voice/engine.ts` would make `stickers/` depend on `voice/` for two constants. Saves about 10 lines, not worth the dependency, so rule 3/“where the concept lives” says skip.
- **Pair 7 — web-tools/feed.ts ↔ web-tools/search.ts (done, −3 lines net).** Added `decodeNamedEntity` to `search.ts` (the lower-level parser, which `shared.ts` already imports) and `feed.ts` uses it before its numeric-entity fallback. Named/numeric decoding behaviour and the `&nbsp;` handling are unchanged.

Product lines: 2 760 before → 2 710 after, **−50**. No `agents/**` or `api.ts` files touched; no new tests or dependencies.

### Checks run

- `pnpm install --frozen-lockfile` — Done in 17s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/prompt-routines.test.ts src/tools/routine-schedule-prompt.test.ts` — 12 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/ais.test.ts src/media/indexer.test.ts src/web-tools/adapters.test.ts` — 33 passed.
- `pnpm gate` — `GATE PASS`. Summary lines:
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS build @zilar/server`, `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
  - WARN size (existing soft-limit warnings): `groups/ais.ts` 460 (main 461), `media/indexer.ts` 410 (main 429), `tools/routine-adapters.ts` 428 (main 450).

### Notes for the lead

Pair 1 is line-positive but only just (−5): the two routine create paths share the insert tail and validation, while the file that holds the helpers grew. I kept it because each block now lives once; it can be reverted alone if you prefer the pair skipped under rule 3.


## Review (written by Claude)

Approved; the pre-review was clean (0 nits). Net −50 on the server; five of seven clone pairs share one copy now:
- the routine validation and insert tail (`parseRoutineBasics`, `insertRoutineRow`);
- the media row type from `db/rows`;
- `groupLimitError()`;
- `ToolIdentity`;
- `decodeNamedEntity`.

**Skipped, with sound reasons:** the member-roles lock prologue (a wrapper costs more than it saves) and the ffmpeg argument prefixes (sharing them would make `stickers/` depend on `voice/`). The gate ran the server suite and it passed. Same SQL and error strings, per the worker report and the pre-review.
