---
id: T-0936
title: "Audit (no code): a 400-line file limit and duplicated code: measure clones, plan a split for every source file over 400 lines, and plan a lint rule"
status: merged
milestone: M5
branch: task/T-0936-size-dup-audit
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0936: File size and duplication plan (audit)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-10: "I also see 1000+ line files! ... we need to find a way to reduce the number of lines in files, reuse code". He picked a **400-line limit**.

The lead measured `apps/*/src` and `packages/*/src`, without tests, `.d.ts` files or `routes.expected.ts`:
- 194,219 source lines;
- **87 files over 500 lines**, and **19 over 1,000**. The biggest:
  - mock code: `apps/web/src/mock/api.ts` 4,297, `apps/mobile/src/store/chat-store.ts` 1,595, `apps/web/src/store/mockStore.ts` 1,294, `apps/web/src/mock/messages.ts` 1,148;
  - `apps/web/src/lib/api.ts` 1,792;
  - server: `apps/server/src/agents/reply.ts` 1,585, `groups/service.ts` 1,583, `ais/service.ts` 1,390, `stickers/service.ts` 1,388, `tools/service.ts` 1,200, `topics/service.ts` 1,127, `actions/gateway.ts` 1,036, `approvals/service.ts` 1,030;
  - packages: `xmpp-core/src/core-effect.ts` 1,206, `client-core/src/store/ledger.ts` 1,176, `xmpp-core/src/stanza.ts` 1,078, `devtools/src/lead/policy.ts` 1,111;
  - UI: `apps/web/src/components/Composer.tsx` 1,145, `apps/mobile/src/app/chat/[id].tsx` 1,118.

The mock files are planned separately (T-0935), so leave them out.

### What to build
One document, `docs/audit/size-plan.md`, covering:
1. **Duplicated code:**
   - run a clone detector over `apps/*/src` and `packages/*/src`, excluding tests and mocks. `pnpm dlx jscpd@4` with a minimum of about 30 lines or 150 tokens works, or anything already in the repo;
   - list the clone groups, largest first, with their files and lines;
   - group them into web↔mobile copies (which go to `packages/chat-core` or `packages/client-core`), server copies (which go to a shared server helper), and others;
   - for each group, say where the one copy should live.
2. **Every non-mock source file over 400 lines:** a split plan with the new file names (by feature or responsibility, not "part 1 and 2"), what moves where, and what shared code removes lines rather than just moving them. Order them: files over 1,000 first, then over 600, then over 400.
3. **The lint rule:** whether oxlint (`.oxlintrc.json`) supports `max-lines`, and the exact config:
   - a warning at 400 lines for source files;
   - off for tests, mocks and generated files.

   Should it start as a warning and become an error once the splits land?
4. **The task split:** ordered tasks of at most about 800 changed lines each, every one with its files, `file:line` anchors and the expected line delta. **No behaviour change, and no new tests** (Julio's minimal-test rule in `AGENTS.md`). Each task is checked by typecheck, lint and the remaining tests.
5. **The totals:** the lines expected to be removed by deduplication, separate from the lines that are only moved.

Change no code.

### Read first
`AGENTS.md`, `.oxlintrc.json`, `docs/audit/simplify-plan.md`, `docs/STORE_CORE_PLAN.md`, and the files above.

### Allowed files
`docs/audit/size-plan.md`, `work/T-0936-size-dup-audit.md`.

### Checks
```bash
pnpm exec prettier --check docs/audit/size-plan.md
```

### Acceptance
- `docs/audit/size-plan.md` exists, with the clone list, a split plan for each file over 400 lines, the lint config, the ordered tasks and the totals, each claim with `file:line`.
- No code changes.

---

## Report (written by the worker when done)

**What I did.** Read `AGENTS.md` (pitfalls included), the task, `.oxlintrc.json`, `docs/audit/simplify-plan.md` and `docs/STORE_CORE_PLAN.md`. Measured every non-mock source file over 400 lines in `apps/*/src` and `packages/*/src` (119 files, 78,831 lines), ran a clone detector over the same scope, verified oxlint's `max-lines` support, and wrote `docs/audit/size-plan.md`: the clone list, a split plan for each file, the lint config, 91 ordered tasks and the totals. No code changed. (Round 2 re-split §4.4 to one file per task, so the count is now 131; see "Round 2" below.)

**Files changed.** `docs/audit/size-plan.md` (new), `work/T-0936-size-dup-audit.md` (status + this Report). Nothing else.

**Commands ran (real results).**

- `pnpm install` — done, 1,172 packages; one pre-existing peer warning (`@types/react-dom` 19.3.0 wants `@types/react` ^19.3.0, found 19.2.18).
- `pnpm dlx jscpd@4 apps packages --min-tokens 30 --min-lines 30 --ignore '…'` — 1,106 files, **26 clone pairs, 1,320 duplicated lines** (0.08%).
- `pnpm dlx jscpd@4 apps packages --min-tokens 150 --min-lines 5 --ignore '…'` — **12 pairs**; the union of the two runs is **33 pairs**, used in §1.
- `node_modules/.bin/oxlint -c <cfg> <450-line file>` — `warning eslint(max-lines): File has too many lines (450). help: Maximum allowed is 400.`, exit 0.
- `pnpm exec prettier --check docs/audit/size-plan.md` — `All matched files use Prettier code style!`.
- `pnpm gate` — ran once from the repo root:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.9s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.3s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Per-file split plans.** Written from a read of each file (batched by area); every entry carries the `file:line` ranges it moves. The one generated-data file (`apps/mobile/src/lib/emoji-data.ts`) keeps its data table and excludes it from the lint.

**Deviations / judgement calls.**

- **Task size.** I size a task by its net source change (new helper + removed lines) and keep it under ~800; the relocated bodies are listed separately, because an add+remove bar of 800 on 72,900 moved lines would be ~180 tasks. If the lead wants that finer granularity, tasks divide cleanly at the file and §2.x entry boundaries.
- The server dedup (`runSql`, the error envelope, `groups/access.ts`, the crypto envelope) is the same work as simplify-plan §2.2/§2.6/§2.7; §5 says so and does not add the two totals together.
- jscpd reports a clone only when **both** `min-lines` and `min-tokens` pass, so "30 lines or 150 tokens" is the union of two runs (documented in §1.1).

**Problems.** None blocking. `pnpm dlx` fetched jscpd over the network; nothing else was needed.

**Open questions.** None blocking. The only thing worth confirming is the task-size convention above (settled in round 2, below).

**Round 2 (fix).** Fixed the one should-fix from `PREREVIEW.md`.

- **Finding 3 (should-fix) · §4.4 grouped tasks were over the ~800-line bar.** Split every grouped task at its §2.3 file boundary, so each task now splits exactly one source file. `docs/audit/size-plan.md` §4.4 grew from 28 tasks (T56–T83) to 68 tasks (T56–T123) and the document from 91 to 131 ordered tasks (8 F + 123 T). The largest single-file task relocates ~510 lines (`stickers/telegram-import.ts`), under the spec's ~800; the §4 convention no longer counts a move as net zero, so a task cannot hide a second file's relocation behind a "≤800" label.
- Findings 1 and 2 are nits; neither is on a line this round changes, so both were left untouched per the fix-round rule.

**Tests.** None added or adjusted: the finding names no test, and the task changes no code (docs only), so per `AGENTS.md` there is nothing to test. Single check run: `pnpm exec prettier --check docs/audit/size-plan.md` — `All matched files use Prettier code style!`.

**Gate (round 2).** Ran once from the repo root:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.0s)
PASS  lint  (0.8s)
PASS  typecheck  (0.6s)
SKIP  effect (no source files changed)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Round 3 (fix).** Fixed both should-fix findings from `PREREVIEW.md` (findings 1 and 2). Docs only, so no behaviour change.

- **Finding 1 (should-fix) · §4 intro claimed the largest relocation was ~510, under the spec's ~800, while nine §4.2/§4.3 tasks relocate 830–1,160 lines.** Restated the convention honestly: each task splits exactly one file, `Relocate` and `Remove` are read separately, and the ~800 bar is on the net change (helper + removals), because a relocation is a delete plus an add. The intro now names the nine over-800 single-file tasks (`T1` ~850, `T7` ~1,160, `T8` ~1,150, `T10` ~1,050, `T15` ~850, `T16` ~980, `T17` ~1,000, `T21` ~870, `T22` ~830; `F2` separately removes ~900) and points at the §2 sub-module boundaries where each can be cut in two, as `T1/T2`, `T3/T4` and `T5/T6` already do.
- **Finding 2 (should-fix) · three §1.2 clone rows did not support their anchors.** Re-anchored the three rows to the real duplicated block, set `Lines` to the shorter copy, and re-sorted and renumbered the table (and the §1.1/§5 totals, ~1,450 → ~1,390):
  - old #2 → **#6**: the `MessageActionsMenu` + confirm block (`MessageBubble.tsx:450-506` / `775-839`, 57 lines).
  - old #4 → **#31**: the shared `RetryButton` key (`approval-card.tsx:23-38` / `load-error.tsx:18-34`, 16 lines); the group/target now say the retry key, not "card chrome".
  - old #23 → **#22**: the reversed `u/[handle].tsx:217-146` became `u/[handle].tsx:217-249` (33 lines, matching `blocked.tsx:102-134`); the group/target now say the screen chrome, not a `PersonRow`.
  - Added a note under the table: jscpd's structural match normalises TypeScript identifiers, so its two blocks can span different line counts, and `Lines` is the shorter block.
  - Nit 3 (the §1.3 Web-UI bullet also listed the mobile group 1 and omitted groups 11/19/24) sits on a line this fix rewrites, so it is corrected; nits 4 and 5 are untouched.

**Tests.** None added or adjusted: both findings are documentation-only, neither names a test, and the task changes no code, so per `AGENTS.md` there is nothing to test. Single check run: `pnpm exec prettier --check docs/audit/size-plan.md` — `All matched files use Prettier code style!`.

**Gate (round 3).** Ran once from the repo root:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.2s)
PASS  lint  (0.8s)
PASS  typecheck  (0.8s)
SKIP  effect (no source files changed)
scope: every changed file is inside the Allowed files
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean after 2 automatic rounds, with 2 nits.**
- **The plan:** `docs/audit/size-plan.md`.
  - **In scope:** 119 source files over 400 lines, 78,831 lines in all (15 over 1,000, 36 between 601 and 1,000, 68 between 401 and 600).
  - **Duplication:** small at the 30-line bar, 33 clone pairs and about 1,320 lines.
  - **The work:** 131 ordered tasks. 8 shared-helper tasks come first, then one task per file. In total they move about 72,900 lines and remove about 5,900, of which about 3,000 to 3,500 no other plan already covers.
- **The lint rule:** oxlint 1.85 supports `max-lines` (checked in the worktree), and a warning does not fail the gate.
- **The review:** the pre-review checked the anchors, totals and partitions against the source.
- **Note:** the worker's approval requests sat unanswered for about 3 hours, the lead's miss (see memory `permission-check-session-id`).
