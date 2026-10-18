---
id: T-2060
title: "Reduce (server): four in-file copies become one helper each — the adapter run in actions/decisions.ts (approve vs auto-approve), the message assembly in agents/context.ts (group vs DM), the write-body read in connections/api.ts (create vs update) and the 'schedule a routine' tail in tools/routine-adapters.ts — no behaviour change"
status: merged
milestone: M5
branch: task/T-2060-server-self-clones
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2060: Server in-file copies, one helper each

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code. The lead's jscpd run (2026-10-18, on `310ba71b8`) found four blocks written twice **inside the same file**. Each becomes one local helper in that file.

### Facts (read by the lead on 2026-10-18 at `7f39c3adf`)
1. **`apps/server/src/actions/decisions.ts`** (253 lines). The approve path (`:115-140`) and the auto-approval path (`:183-206`) run the adapter the same way:
   - `let outcome / summary / modelText / posted`;
   - `adapter.execute(ctx, parsedArgs)`;
   - `truncateSummary`, `sanitiseModelText` and `posted === true`;
   - on throw, `outcome = 'error'` and a `deps.logger.warn` with `errorName(error)`.

   Only the log fields (`ruleId` added) and the log message differ.
2. **`apps/server/src/agents/context.ts`** (313 lines). The group builder (`:245-266`) and the DM builder (`:291-312`) do the same steps:
   - collect turns, `capHistoryByChars(turns, DM_HISTORY_CHAR_BUDGET)`;
   - the system message, then the memory message;
   - the capped turns;
   - then the trigger message when its id is not the last turn.

   They differ in the turn mapper (`toGroupTurn(message, aiBare, senderNames)` against `toTurn(message, aiBare, ownerBare)`) and the trigger content (`` `${sender}: ${triggerBody}` `` against `triggerBody`).
3. **`apps/server/src/connections/api.ts`** (374 lines). The `create` (`:201-…`) and `update` (`:243-…`) handlers open the same way: `requireCipher()`, the `writeLimiter` 429, the JSON read with the `INVALID_JSON` 400, then `Schema.decodeUnknownOption(<Payload>, STRICT_DECODE)`. They differ only in the payload schema.
4. **`apps/server/src/tools/routine-adapters.ts`** (381 lines). The two "create the routine, then reply Scheduled …" tails (`:228-239` and `:281-291`) are the same:
   - `nextRunAfter`, then the `Scheduled "<title>"; next run …` summary;
   - a `RoutineServiceError` becomes `serviceFailure(error)`.

### Steps
1. **`decisions.ts`.** Add a local `runAdapter(adapter, ctx, parsedArgs, logFields, logMessage)`, returning `{ outcome, summary, modelText, posted }`. Keep both comments about never logging the error text, merged into one.
2. **`context.ts`.** Add a local `assembleMessages(system, memory, turns, trigger, triggerContent)`, used by both builders with their own mapper and trigger text.
3. **`connections/api.ts`.** Add a local helper that does the shared opening and returns the decoded payload, generic over the schema. Keep every status code and message exactly as it is.
4. **`routine-adapters.ts`.** Add a local helper for the shared create-and-summarise tail.
5. **Tests.** No new tests. Run the nearest existing ones (Checks).
6. **Size.** Product lines must drop by at least 50. Report the counts.

### Allowed files
- `apps/server/src/actions/decisions.ts`
- `apps/server/src/agents/context.ts`
- `apps/server/src/connections/api.ts`
- `apps/server/src/tools/routine-adapters.ts`
- `work/T-2060-server-self-clones.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/actions/approval-reuse.test.ts src/actions/unattended.test.ts src/agents/context.test.ts src/agents/context-edits.test.ts src/connections/api.test.ts src/connections/update-key.test.ts src/tools/routine-schedule-prompt.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines are at least 50 lower.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/actions/decisions.ts`: added `runAdapter` (executes the adapter, maps the result and answers `{ outcome, response }`) and `executeAction` (args decode + context + run). The allow path now runs `executeAction(deps, params, adapter, null)` inline in `runRequest`; the auto-approval path calls it with the rule id. The error text is still never logged: only `errorName(error)` plus the same fields (`action`, `aiId`, and `ruleId` on the auto path), and the two original log messages are kept.
- `apps/server/src/agents/context.ts`: added `assembleMessages(system, memory, history, mapper, trigger, triggerContent)`, which collects and caps the turns, adds the system and memory messages and then the trigger unless its id is the last turn. Both builders call it with their own mapper and trigger text. The group and DM mappers were also merged into one `toTurn(message, aiBare, userContent)`, since they were a further in-file copy: the AI's own turns are `assistant`, and `userContent` is `null` for a DM stranger.
- `apps/server/src/connections/api.ts`: added `readBody(request, userId, schema)`, generic over the schema, which does the shared opening in the same order: `requireCipher()` (503), `writeLimiter` (429), JSON read (`Invalid JSON body`, 400), `Schema.decodeUnknownOption` with `STRICT_DECODE` (`Invalid connection request`, 400). `create` and `update` both call it; status codes and messages are unchanged.
- `apps/server/src/tools/routine-adapters.ts`: added `scheduledSummary(created, now)` for the create-and-summarise tail (`Scheduled "<title>"; next run …` plus `RoutineServiceError` → `serviceFailure`). The two `RoutineServiceError` catch tails in `routine.pause` and `routine.delete` were byte-identical too, so they share a `serviceSummary(run)` helper; no behaviour change.
- No new tests, per the spec.

Size (`wc -l`, product files only): before 253 + 313 + 374 + 381 = **1321**; after 238 + 285 + 369 + 379 = **1271**, i.e. **50 lines fewer**.

### Checks run
- `pnpm install`: completed, no output.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/approval-reuse.test.ts src/actions/unattended.test.ts src/agents/context.test.ts src/agents/context-edits.test.ts src/connections/api.test.ts src/connections/update-key.test.ts src/tools/routine-schedule-prompt.test.ts`: **7 test files passed, 30 tests passed**. (An earlier run of the same set failed 3 routine tests with `TypeError: create is not a function`, caused by my first helper signature taking a promise while the helper expected a factory; fixed, then the final run above passed.)
- `pnpm gate` (repo root), final run:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.7s)
  PASS  lint  (1.7s)
  PASS  typecheck  (7.4s)
  PASS  effect  (1.8s)
  PASS  build @zilar/server  (0.7s)
  PASS  tests @zilar/server  (12.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  Earlier gate runs failed on format (`context.ts`) and typecheck (`context.ts` and the schema generic in `api.ts`); both were fixed before the final run.

### Notes for the lead
- **Deviations from the literal spec, all behaviour-preserving:**
  - `runAdapter` takes `(deps, params, adapter, ctx, parsedArgs, ruleId)` instead of `(adapter, ctx, parsedArgs, logFields, logMessage)`, and returns `{ outcome, response }` rather than the four fields. `deps`/`params`/`ruleId` build the log fields and message in one place, and returning the final `RequestOutcome` deduplicates the identical executed/failed mapping at both tails. A second local `executeAction` covers the identical args decode + context construction.
  - `assembleMessages` also collects and caps the turns (signature additionally takes `history` and `mapper`), because the two collection loops were themselves identical; this was needed to reach the 50-line target. Group and DM `toTurn` mappers were merged into one function.
  - `routine-adapters.ts` also uses the new `serviceSummary` helper for the identical `RoutineServiceError` catches in `routine.pause` and `routine.delete`.
  - Comments that described the duplicated blocks were merged into the helper comments rather than kept twice.
- No changes outside the Allowed files; no new dependencies; no open questions.

## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** Local helpers replace the in-file copies:
  - `runAdapter` (decisions);
  - `assembleMessages` (agent context);
  - the shared write-body opening (connections);
  - the routine create-and-summarise tail.
- **Size.** −50 product lines. The nearest action, agent-context, connections and routine tests pass.
