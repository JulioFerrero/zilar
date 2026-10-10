---
id: T-0960
title: "Size split T3+T4: apps/server/src/agents/reply.ts (1,585 lines) into agents/{tool-loop,dm-turn,group-turn}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0960-split-server-agents-reply
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0960: Split `agents/reply.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/agents/reply.ts` is 1,585 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written. The plan splits it in two tasks (T3, T4); this task does both, because they are one file.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #2: `agents/tool-loop.ts`, `agents/dm-turn.ts`, `agents/group-turn.ts`, under `apps/server/src/`. `agents/reply.ts` becomes the barrel.

The plan's ranges give `tool-loop.ts` and `dm-turn.ts` about 450 to 500 lines each. Split each once more along a boundary the entry names (`split-rules.md` item 4): `tool-loop.ts` plus `tool-exec.ts` (execute and redact), and `dm-turn.ts` plus `dm-tool-turn.ts` (`runToolTurn`).

This is the AI reply pipeline (message pipeline), so it is crucial: move the code unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #2, and `apps/server/src/agents/reply.ts`.

### Allowed files
`apps/server/src/agents/reply.ts`, `apps/server/src/agents/tool-loop.ts`, `apps/server/src/agents/tool-exec.ts`, `apps/server/src/agents/dm-turn.ts`, `apps/server/src/agents/dm-tool-turn.ts`, `apps/server/src/agents/group-turn.ts`, `work/T-0960-split-server-agents-reply.md`.

### Checks
```bash
pnpm gate
```
The gate runs the nearest server tests. Also run any kept server test that imports from `agents/reply` (find them with grep) with `--reporter=dot`, and list them in the Report.

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/agents/reply.ts` (1,585 lines) into a thin barrel plus
five feature files, moving code unchanged (no logic, comment or signature edits
beyond adding `export` where a moved piece now crosses a file, and two comment
lines of module header in the barrel). No importer changed; `agents/reply.ts`
re-exports every name it exported before with the same names and kinds.

I did **not** run the plan's two Dedup items (`finishLoop` collapse,
`redactError` reuses `redactSecrets`): the task says this is the message
pipeline and to move the code unchanged, so the moved code is byte-identical
(see the byte check below).

### Files (wc -l)

| File | Lines |
| --- | ---: |
| `agents/reply.ts` (old) | 1585 |
| `agents/reply.ts` (barrel) | 43 |
| `agents/tool-loop.ts` | 387 |
| `agents/tool-exec.ts` | 376 |
| `agents/dm-turn.ts` | 145 |
| `agents/dm-tool-turn.ts` | 382 |
| `agents/group-turn.ts` | 369 |

All new files and the barrel are at most 400 lines. No `max-lines` warning.

Move check: I extracted each moved block verbatim with `sed -n 'a,bp'` ranges
from the original, then verified it. After removing the old file's import header
(lines 1–21) and each new file's added import header, dropping blank lines and
normalizing the leading `export ` (added to 9 declarations), the multiset of the
old body's 1,501 lines is **identical** to the multiset of the five new files'
1,501 body lines (`diff` prints nothing). Every top-level declaration of the old
file also appears exactly once across the new files. So no code line was
dropped, duplicated or edited. Prettier only reflowed my added import headers
(and the `export` keyword above); no moved line changed.

### Export list, before → after

Before (`grep -E "^export"` on the old file), 28 names:
`REPLY_MAX_TOKENS`, `LITELLM_CHAT_TIMEOUT_MS`, `BUDGET_EXCEEDED_REPLY`,
`PROVIDER_KEY_REJECTED_REPLY`, `TRANSIENT_FAILURE_REPLY`, `dailyLimitReply`,
`dailyWarningReply`, `monthlyWarningReply`, `ChatCompletionError`,
`ChatToolCall`, `ValidToolCall`, `ToolExecution`, `ExecuteToolCall`,
`ModelRequestMessage`, `CompleteChatInput`, `completeChat`, `mapFailureToReply`,
`DmTurnDeps`, `DmTurnOutcome`, `TOOL_TURN_WALL_CLOCK_MS`,
`TOOL_TURN_MAX_CALLS`, `TOOL_RESULT_MAX_CHARS`, `TOOL_REPEAT_RESULT`,
`TOOL_CAPPED_RESULT`, `runDmTurn`, `runToolLoop`, `GroupTurnDeps`,
`runGroupTurn`.

After: the barrel `agents/reply.ts` re-exports exactly those 28 names from the
five files (values via `export { … }`, types via `export type { … }`):
`tool-loop.ts` holds the 11 value consts/class + 6 types, `tool-exec.ts`
`mapFailureToReply`, `dm-turn.ts` the three daily texts + `completeChat` +
`runDmTurn` + `DmTurnDeps`/`DmTurnOutcome`, `dm-tool-turn.ts` `runToolLoop`,
`group-turn.ts` `runGroupTurn` + `GroupTurnDeps`.

Nine additional `export`s were added so moved code can cross the new module
boundaries (they are internal and are **not** re-exported by the barrel, so the
public surface is unchanged): `ChatCompletionResult`, `requestCompletion`,
`executeToolCalls`, `followUpMessages`, `runLoopRound`, `actionOfCall`,
`redactError`, `runToolTurn`, `clearProgressQuietly`.

### Effect ratchet (`// effect-plain:` markers)

`tool-loop.ts` imports `effect` as a value, so it is classified `effect` and
needs no marker. Four new files would otherwise be `needs-effect` (they are
plain and contain `async`/`try`), so each carries, in its first lines:
`// effect-plain: moved unchanged from apps/server/src/agents/reply.ts (size split)`
— `tool-exec.ts`, `dm-turn.ts`, `dm-tool-turn.ts`, `group-turn.ts`. The gate's
`effect` step passed. These are the only markers added, and for no other reason.

### Commands and real results

- `pnpm install` — Done, 1262 packages resolved (frozen lockfile; the gate runs it too).
- `pnpm gate` (from the repo root) — summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- Kept server tests importing `agents/reply`: **none exist**. `grep -rn
  "agents/reply\|from './reply'\|from '../reply'" apps/server/src` lists only
  non-test sources, and `grep -rln "runDmTurn\|runGroupTurn\|runToolLoop\|
  completeChat\|mapFailureToReply" apps --include='*.test.ts'` returns no test
  that exercises this file. There is no `src/agents/*.test.ts`; the gate agrees
  ("no nearby test files"), so there was no single test file to run with
  `--reporter=dot`. I wrote no new tests and edited none.

### Deviations from the spec / decisions

- **One extra split inside `tool-loop.ts` was not enough; code had to be
  distributed one file further than the plan's ranges.** The plan's ranges for
  `tool-loop.ts` (≈390 lines) omit the model-call layer that the loop and the
  turns call (`requestCompletion`, the response schemas, the tagged errors,
  `ChatCompletionError`, the reply-text constants, `mapFailureToReply`, the
  loop types and caps — ≈360 further lines). With a hard 400-line limit and the
  requirement that `reply.ts` stay a thin barrel, that material cannot all live
  in two files: the loop closure (model call + types + caps + loop + execute +
  redact) is ≈865 lines, and >800 cannot fit in two files. The only cycles-free
  way to keep every file ≤400 and every import acyclic (the repo deliberately
  avoids runtime cycles in split files, e.g. the `agents/gateway/*` uses of
  `import type`) is this layout:
  - `tool-loop.ts` = the model-call layer (`requestCompletion` etc.), the loop
    types, and the caps;
  - `tool-exec.ts` = `executeOneToolCall`/`executeToolCalls`, `toCall`,
    `redactError`, `actionOfCall`, `followUpMessages`/`truncateToolContent` and
    `runLoopRound` (the per-round pipeline plus error mapping);
  - `dm-tool-turn.ts` = the shared `runToolLoop`, the DM `runToolTurn`,
    `sendReply` and `clearProgressQuietly`;
  - `dm-turn.ts` = `DmTurnDeps`/`runDmTurn` + `completeChat` and the daily texts;
  - `group-turn.ts` = `GroupTurnDeps`/`runGroupTurn`/`runGroupToolTurn`/`sendGroupReply`.
  Consequence to flag for review: `runToolLoop` (the shared loop the plan places
  in `tool-loop.ts`) and `sendReply` (the plan places it in `dm-turn.ts`) live in
  `dm-tool-turn.ts`, because `runToolTurn` calls both and any other placement
  creates a `tool-loop ⇄ dm-turn ⇄ dm-tool-turn` runtime cycle. The dependency
  graph is acyclic: `tool-loop ← tool-exec ← dm-tool-turn ← {dm-turn, group-turn}`.
- This is reported per `split-rules.md` item 4 ("split it once more along a
  boundary the entry names, and say so in the Report"). The boundary names the
  entry gives (`execute`/`redact`) are honoured in `tool-exec.ts`; the loop's
  cap/types and the model call stay together in `tool-loop.ts`.

### Security checklist

Pure relocation: no query, `where`, permission, cap, atomicity, logging or audit
code changed. The redaction path (`redactError`/`redactSecrets`) is moved
unchanged, and no secret is newly logged. Nothing new is exported on the public
barrel surface.

### Open questions / blocked

None. No file outside the Allowed files was touched.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `agents/reply.ts` (1,585 lines) becomes a barrel plus `tool-loop`, `tool-exec`, `dm-turn`, `dm-tool-turn` and `group-turn`, the largest at 387. The code moved verbatim.
- **Check:** the gate passed (types, lint, Effect).
- **No test covers the AI reply pipeline any more,** since the test cut. That is crucial code under Julio's rule, so a small test task for it is noted as a follow-up.
