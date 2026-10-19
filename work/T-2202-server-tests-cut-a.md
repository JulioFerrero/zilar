---
id: T-2202
title: "Server tests, wave A: routines, questions, blocks and message-block tests cut to the few that pin permissions, money, keys, delivery or input limits"
status: merged
milestone: M5
branch: task/T-2202-server-tests-cut-a
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2202: Server tests outside the crucial areas, wave A

## Spec (written by Claude, do not edit)

### The rule (Julio, 2026-10-10 and 2026-10-19)
Tests exist only for crucial code: auth and keys, permissions and money, and the message pipeline. On 2026-10-19 Julio chose to cut the server tests outside those areas "to a few each".

In each file below, **keep only the cases that pin one of these**, at most about 4 per file:
- **Who may:** permission, ownership, membership, admin-only, another user's data refused, a non-member refused.
- **Money:** spend limits, usage, budgets.
- **Keys and secrets:** a key or token is never returned, logged or sent where it must not go.
- **Message delivery:** sent once, to the right room, never duplicated, never sent to the wrong person.
- **Safety limits on untrusted input:** private or loopback addresses refused (SSRF), size and count caps, sanitising, injection.

**Delete every other case:** wording and text, ordering, formatting, default values, response shape, and logging details.

If a file has no case of those kinds, keep its single most basic happy-path case, so the module still loads under test. Then delete the helpers, fixtures and imports in the same file that become unused.

### Files (2,941 test lines, counted on 2026-10-19)
- `apps/server/src/routines/alert-link-create.test.ts` (90)
- `apps/server/src/routines/blocks-post.test.ts` (115)
- `apps/server/src/routines/execute-prompt.test.ts` (265)
- `apps/server/src/routines/execute.test.ts` (356)
- `apps/server/src/routines/message-store.test.ts` (68)
- `apps/server/src/routines/mine.test.ts` (215)
- `apps/server/src/routines/prompt-routines.test.ts` (155)
- `apps/server/src/routines/scheduler.test.ts` (329)
- `apps/server/src/routines/topic-routines.test.ts` (96)
- `apps/server/src/questions/service.test.ts` (328)
- `apps/server/src/blocks/blocks.test.ts` (208)
- `apps/server/src/message-blocks/build.test.ts` (44)
- `apps/server/src/message-blocks/cards.test.ts` (226)
- `apps/server/src/message-blocks/guide.test.ts` (70)
- `apps/server/src/message-blocks/respond.test.ts` (376)

### Steps
1. Work one file at a time. List its cases, mark each keep or delete by the rule above, delete, and run that file with `--reporter=dot`.
2. Change test files only: no product code, no other test file.
3. In the Report, give one line per file: cases before → after, lines before → after, and which kept cases pin what.

### Allowed files
- The 15 test files listed above
- `work/T-2202-server-tests-cut-a.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines src/questions src/blocks src/message-blocks --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- Only the listed test files change.
- These files lose at least half their lines (at least −1,450).

---

## Report (written by the worker when done)

### What I did

Cut the 15 listed test files to the cases that pin permissions/ownership, money, keys/secrets,
message delivery, or limits on untrusted input. Three files already contained only one such case
and are unchanged: `routines/alert-link-create.test.ts`, `routines/message-store.test.ts`,
`routines/topic-routines.test.ts`. Only test files and this task file changed.

Totals: **61 → 23 cases**, **2,941 → 1,478 lines** (−1,463, acceptance needed at least −1,450).

### Per file (cases before → after, lines before → after, what the kept cases pin)

- `routines/alert-link-create.test.ts` 1 → 1, 90 → 90. One live alert block cannot create a second routine (`alert_card_taken`, count 1) — uniqueness/count.
- `routines/blocks-post.test.ts` 2 → 1, 115 → 85. An invalid (non-https) link block falls back to a plain post — sanitising untrusted tool output.
- `routines/execute-prompt.test.ts` 9 → 3, 265 → 167. Third failure pauses and posts the fixed notice once (delivery, no duplicate); the daily cap stops the runner (usage/money); the slot is refunded when the AI is offline (usage/money).
- `routines/execute.test.ts` 4 → 2, 356 → 235. A failed post is retried once, then recorded ok (delivery, no duplicate); another AI's alert card is left untouched (ownership).
- `routines/message-store.test.ts` 1 → 1, 68 → 68. One live routine message id is recorded and loaded back — delivery.
- `routines/mine.test.ts` 3 → 1, 215 → 47. Another user's AI routines are never returned — ownership.
- `routines/prompt-routines.test.ts` 4 → 2, 155 → 77. Empty and over-long prompts are refused (input caps); the 11th routine in a topic is refused (count cap).
- `routines/scheduler.test.ts` 3 → 1, 329 → 138. A routine is not started again while its previous run is still in flight (no duplicate delivery).
- `routines/topic-routines.test.ts` 1 → 1, 96 → 96. A private topic's routines are hidden from a group member, shown to the creator, and a missing topic answers null (404 parity) — permission.
- `questions/service.test.ts` 11 → 3, 328 → 120. A question is not found through another room (scope); option count/length caps (input limits); only one of two racing creates gets the last open slot (atomic count cap).
- `blocks/blocks.test.ts` 5 → 1, 208 → 46. Blocking removes the pair from both contact lists and both roster items — permission.
- `message-blocks/build.test.ts` 2 → 1, 44 → 21. A non-https link is rejected — sanitising.
- `message-blocks/cards.test.ts` 4 → 1, 226 → 73. One vote per actor per poll, counted once — count/uniqueness.
- `message-blocks/guide.test.ts` 4 → 1, 70 → 30. Interactive kinds are taught to `post_blocks` only and never to a saved tool — capability boundary on untrusted tool output.
- `message-blocks/respond.test.ts` 7 → 3, 376 → 185. A stranger gets the same 404 and nothing is written (permission, no effect before the check); only the AI's owner answers a DM card (ownership); poll picks are visible only to their voter (isolation).

### Commands and real results

- `pnpm install` → done in 42.8s; peer warning only (`apps/mobile`: `@types/react-dom 19.3.0` wants `@types/react ^19.3.0`, found 19.2.18).
- `pnpm --filter @zilar/server exec vitest run src/routines src/questions src/blocks src/message-blocks --maxWorkers=2 --reporter=dot` → **15 files passed, 23 tests passed** (50.97s). This is the task's checks command with the worker cap AGENTS.md requires.
- `pnpm gate` → `GATE PASS`. Summary:
  - `PASS install (frozen) (4.1s)`, `PASS format (3.3s)`, `PASS lint (3.4s)`, `PASS typecheck (13.7s)`
  - `SKIP effect (no source files changed)`, `PASS build @zilar/server (1.6s)`, `PASS tests @zilar/server (57.5s)`
  - `migration`, `images`, `size`, `comments` all reported clean.

### Deviation: gate scope line

The gate ends with `GATE PASS` but prints `scope: 12 file(s) outside the Allowed files` listing
exactly the 12 test files I edited. The scope check only reads backticked paths in the Allowed
files section (`packages/devtools/src/gate/scope.ts`), and that section names the files by
reference ("The 15 test files listed above"), so it cannot expand them. Every listed file is one
of the 15 under "Files" in this spec, and no other file changed. I did not touch the Spec to
work around it.

### Problems / questions

- None blocking. If the scope line should be clean, the lead can spell the 15 paths out in
  Allowed files; the code change here would not need to change.


## Review (written by Claude)

Approved; the pre-review passed with 1 cosmetic nit. Only test files changed.

Routines, questions, blocks and message-block tests went from 61 to 23 cases and from 2,941 to 1,478 lines (−1,463), per Julio's 10-19 call.

The kept cases pin:
- ownership: another user's routines, another AI's alert card, the owner-only DM card;
- permissions: a stranger's 404 with no write, private-topic routines, blocking;
- caps: prompt length, routines per topic, question options, the racing last slot, the daily cap and refund;
- delivery with no duplicate: the retry once, the fixed notice once, no overlapping run;
- sanitising: https-only link blocks.

Gate PASS (server tests included).
