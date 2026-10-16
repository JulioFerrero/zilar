---
id: T-1711
title: "Audit + plan: a routine's runs edit ONE chat message instead of posting a new one each run (Julio approved the canvas 2026-10-16) — map the scheduled-run reply path, the correction path the progress message uses, where the routine's message id would be stored, and how web and phone render corrections; write docs/plan/routine-live-message.md with exact file:line steps. No code."
status: merged
milestone: M5
branch: task/T-1711-audit-routine-live-message
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1711: Plan for a routine's single live message

## Spec (written by Claude, do not edit)

### Why
Julio approved the "Routines" row of the AI work card canvas on 2026-10-16. A routine posts **one** message, and every later run **edits** that message ("edited 10:45") instead of adding a new one. Before speccing the build, the lead needs a verified map of the code paths. This task writes only a plan document. **No code changes.**

### Facts (the lead read them on 2026-10-16)
- **Scheduled runs** enter the AI's DM or room queue as synthetic triggers with a `scheduled` field (`apps/server/src/agents/gateway/routine-run.ts:97-125`). The turn then replies through the normal group or DM turn path (`apps/server/src/agents/gateway/group-turn-body.ts`, `apps/server/src/agents/dm-turn.ts`).
- **The progress message is already edited in place with corrections:**
  - `apps/server/src/agents/dm-turn.ts:102-106` ("corrections target it", the final task-card correction);
  - the AI's context folds corrections (`apps/server/src/agents/context-edits.ts`).
- **Routines are stored in the `routines` table** (`apps/server/src/db/rows.ts`; the scheduler is `apps/server/src/routines/scheduler.ts`). New migrations are hand-written SQL run by `migrateSql`.

### Steps
1. **Read and map, with `file:line`:**
   - (a) where a scheduled turn's final reply is sent, for a room and for a DM, and which message id it gets;
   - (b) how a correction (XEP-0308 replace) is built and sent for the progress message, and whether the final reply could be sent the same way to an older message id;
   - (c) whether the scheduled turn knows its `routineId` at send time (`trigger.scheduled.routineId`);
   - (d) where a `last_message_id` for a routine could be stored (a new column on `routines` versus a separate table), and which row types and SQL would change;
   - (e) how web (`apps/web`) and phone (`apps/mobile`) render a corrected message, and whether a correction of an old message moves it or only changes it in place;
   - (f) what happens when the stored message was deleted (retracted) or is past the archive or correction limits: fall back to a new message.
2. **Write `docs/plan/routine-live-message.md`:**
   - the map above;
   - then a numbered build plan of tasks, each small enough for one worker, with exact files and the line numbers you read;
   - then the risks.
   - Keep it under 200 lines. Plain English, short sentences.

### Allowed files
- `docs/plan/routine-live-message.md`
- `work/T-1711-audit-routine-live-message.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The plan exists** with the six answers (a) to (f), each with `file:line`, a task list and the risks.
- **No source file changed.**

---

## Report (written by the worker when done)

### What I did

Docs-only audit/plan task. No source file changed.

- Wrote `docs/plan/routine-live-message.md` (199 lines): the six answers (a)–(f)
  each with `file:line`, a numbered 8-task build plan, and 8 risks/open questions.
- Key findings:
  - (a) A scheduled run's final reply is sent by `sendReply` (`apps/server/src/agents/turn-send.ts:19`, DM) and `sendGroupReply` (`:44`, room). Both **discard** the send result, which is the **origin id** (sender-generated) a correction must name.
  - (b) The progress path already builds/sends XEP-0308 corrections (`apps/server/src/agents/gateway/live.ts:133-135,178-179` → `packages/xmpp-core/src/core-effect/operations.ts:178-196` → `build-outgoing.ts:150-166`). The final reply can use the same call; no new mechanism needed.
  - (c) The routine id is known in both bodies (`trigger.scheduled?.routineId`; DM `dm-turn.ts:172,329`, room `group-turn-body.ts:93`), but today only a **boolean** `scheduled` is plumbed down (`dm-turn-input.ts:36`, `group-turn-access.ts:44`).
  - (d) Recommend two nullable columns on `routines` (`last_message_id`, `last_message_at`); the row is already loaded whole each run and the SQL client camelCases names. Precedent: `ai_questions.message_id`.
  - (e) Both apps share one ledger: a correction changes the target **in place**, never moves it, and shows only "edited" with the **original** send time (web `MessageMeta.tsx:31-32`, phone `plain-bubble-body.tsx:85`).
  - (f) A retraction wins over later corrections forever (`chat-core edits.ts:168-172`), and a pruned/old target renders nowhere (`prune.ts:10`, `context.ts:13`); so the plan adds an age-bound guard plus a clear-on-retraction fallback rather than editing blindly.

### Checks run

- `pnpm install`: Done in 12.9s (already up to date).
- `pnpm gate` (from repo root): ends `GATE PASS`, 2 changed files against main, both inside the Allowed files. Summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (1.1s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (1.1s)`
  - `PASS  typecheck  (1.2s)`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- No single test files were run: the task is docs-only (no code under test). The gate's `SKIP effect` confirms nothing executable changed.

### Notes for the lead

- The task's Fact list pointed at `apps/server/src/db/rows.ts` for the routine row; the actual `RoutineRow` lives in `apps/server/src/db/rows-agents.ts:152-176` (re-exported by `rows.ts`). Noted in the plan.
- Real open questions for Julio are in §3 of the plan (edit-time marker, invisible runs, card suppression, room mention on a correction). I recommend the plan's defaults but did not decide them.
- Nothing blocked; no deviation from the spec.

## Review (written by Claude)

**Approved and merged.** A docs-only plan.

- **Pre-review:** clean, 1 nit.
- **The lead read the whole plan:**
  - the six answers each cite `file:line`;
  - the main finding is that every send already returns the origin id that a correction needs; it is just dropped, and the routine id is in scope but not passed down to the send;
  - storage is two nullable columns on `routines`.
- **Build order:** the 8 tasks get specced in the order the plan gives.
- **Questions for Julio** (§3 Q1–Q4) go to him with the build:
  - should "edited" show the edit time?
  - runs don't bump unread;
  - no progress card on scheduled runs;
  - no @mention on edits.
