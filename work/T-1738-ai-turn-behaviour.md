---
id: T-1738
title: "AI turns match the approved boards: no follow-up post after a routine approval, follow-up replies carry no quote of the synthetic message, a typed answer closes the AI's open question, and questions are short with chip-sized options"
status: merged
milestone: M5
branch: task/T-1738-ai-turn-behaviour
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1738: AI turns that behave like the boards

## Spec (written by Claude, do not edit)

### Why
Julio's phone test on 2026-10-16: "the ai still super verbose", the AI messages carry an empty red "Message" quote, and "Deepseek is waiting for you" stays after he answered. The approved flow is `docs/design/mockups/routines/README.md` and `docs/design/mockups/ai-work/README.md`:
- after Allow, the card shrinks to a check line and the routine posts **one** message;
- there is **no separate "approved …" message**;
- a question is one short line with tap chips.

### Facts (the lead read them on 2026-10-16, live data and code)
1. **The follow-up turn:**
   - `apps/server/src/agents/gateway/approval-follow-up.ts:33-80` queues one AI turn after every approved, consumed approval;
   - its body is a synthetic message, `Approved: "<summary>". Continue the task from where you stopped. …` (`:52`), with a fresh `randomUUID()` id (`:55`, `:68-75`);
   - the AI answers it like a person's message, so its reply quotes an id that exists in no chat;
   - the clients then render a quote named "Message" with no text (`packages/chat-core/src/messages.ts:262-288`);
   - live: after Julio approved the two routine cards at 17:12:23 and 17:12:42 UTC, Deepseek posted "@Julio Routine approved and running…" and "@Julio Done: the every-5-minute routine is active…", both with that empty quote.
2. **Questions:**
   - `ask_people` (`apps/server/src/agents/tools/definitions.ts:214-240`; caps in `apps/server/src/agents/tools/schemas.ts:19-22`: question ≤ 300, 2-4 options ≤ 40) says "a free reply is still allowed";
   - only a chip answer closes the question (`apps/server/src/agents/gateway/question-answer.ts:72`, `answerQuestion` in `apps/server/src/questions/service.ts:217-234`);
   - live: question `4fd411cb…` (17:12:50) is still `open` after Julio typed "Delete one yes" and Deepseek took a turn on it, so the topic shows "waiting for you" until it expires 24 h later;
   - open questions feed the topic's `waiting` state (`apps/server/src/topics/ai-activity.ts:82-97`).
3. **The reply rule** is already "one or two short sentences" (`apps/server/src/agents/context.ts:66`, `:128`). The verbose posts were the follow-up turns above and a long question (283 bytes).

### Steps
1. **No follow-up turn after a routine approval.** In `approval-follow-up.ts`, return without queueing a turn when the approval's action is `routine.schedule`: the card's check line and the routine's own message are the result. Read the action from the approval row, and add it to the row type if needed. Other actions keep the follow-up.
2. **Follow-up replies carry no quote.** Mark the queued follow-up item as synthetic, and make the reply path skip the reply reference for a synthetic trigger. Find where an AI's room reply gets its `reply` or `to` from the triggering message (the turn send path in `apps/server/src/agents/`), and name the files in the Report. Only those files may change, besides the Allowed ones below; list them in the Report.
3. **A typed answer closes the question.**
   - When a person posts in a topic where an AI has an open question, and that AI then takes a turn on the message, mark its open questions there answered, with the message text as the answer and the sender as `answered_by` (reuse `answerQuestion`).
   - The topic's activity then drops "waiting".
4. **Short questions.**
   - Lower the caps to a question ≤ 140 characters and options ≤ 24 characters, in both `schemas.ts` and the definition (keep 2-4 options; `questions/service.ts` must accept the same caps).
   - The tool description says: "one short question in plain words; options of one to three words".
5. **Tests** (message pipeline, at most three):
   - no turn is queued after a `routine.schedule` approval;
   - a typed message closes the AI's open question in that topic;
   - the follow-up reply carries no quote.

### Allowed files
- `apps/server/src/agents/gateway/approval-follow-up.ts`
- `apps/server/src/agents/gateway/question-answer.ts`
- `apps/server/src/agents/tools/definitions.ts`
- `apps/server/src/agents/tools/schemas.ts`
- `apps/server/src/questions/service.ts`
- `apps/server/src/agents/gateway/*.test.ts`
- `apps/server/src/agents/*.test.ts`
- `apps/server/src/agents/turn-send.ts`
- `apps/server/src/agents/reply.ts`
- `apps/server/src/agents/replies.ts`
- `apps/server/src/agents/group-turn.ts`
- `apps/server/src/agents/gateway/stop-types.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `work/T-1738-ai-turn-behaviour.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway src/questions --reporter=dot
pnpm gate
```

### Acceptance
- **After Allow on a routine card,** the AI posts nothing.
- **Other approvals** still get one follow-up, with no empty quote.
- **A typed answer** clears "waiting for you".
- **Questions and options** fit the new caps.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

**1. No follow-up turn after a routine approval.** `approval-follow-up.ts` now returns before queueing when the consumed approval's `action` is `routine.schedule`. The action is read from the existing `ApprovalRow.action` field (already present, no row-type change needed). Other actions keep the follow-up.

**2. Follow-up replies carry no quote.** The queued follow-up is now marked `synthetic: true` on both the DM item (`PendingMessage`) and the room item (`RoomPendingMessage`). The room reply path is `wire()` in `apps/server/src/agents/group-turn.ts`, which is where the reply gets its `replyTo` from the trigger (`replyTo: { id: deps.triggerId }`); it now omits `replyTo` when `deps.syntheticTrigger` is set. `group-turn-body.ts` sets `syntheticTrigger` from `trigger.synthetic`.
   - Turn-send-path files changed beyond the Allowed list (authorised by Spec step 2, which says "Only those files may change, besides the Allowed ones below; list them in the Report"): `apps/server/src/agents/gateway/pending.ts` (adds the `synthetic?: true` field to both queue-item types), `apps/server/src/agents/group-turn-deps.ts` (adds `syntheticTrigger?: boolean`), `apps/server/src/agents/gateway/group-turn-body.ts` (passes `syntheticTrigger` and calls the new answer helper, below). Files inside the Allowed list: `apps/server/src/agents/group-turn.ts`.

**3. A typed answer closes the question.** New `answerOpenQuestionsOnTurn` in `question-answer.ts`: for a human sender it lists the AI's open questions in that room (new `listOpenQuestionsForAiInRoom` in `questions/service.ts`) and calls the existing `answerQuestion` for each, with the message text as the answer and the sender as `answered_by`. `group-turn-body.ts` calls it once per turn, only when `askPeople` is true and the trigger is not synthetic (so a routine, a handoff/delegation and an approval follow-up never close questions). The topic activity read then drops "waiting" because the rows are `answered`.

**4. Short questions.** Caps lowered to question ≤ 140 and option ≤ 24 in `tools/definitions.ts` (tool JSON schema) and `tools/schemas.ts` (`AskPeopleArgsSchema`); `questions/service.ts` enforces the same caps (`MAX_QUESTION_LENGTH = 140`, `MAX_OPTION_LENGTH = 24`). The tool description now reads "one short question in plain words; options of one to three words".

**5. Tests (three).**
- `gateway/approval-follow-up.test.ts`: "queues nothing after a routine.schedule approval".
- `gateway/question-answer.test.ts`: "answers the open question when a person types in the room".
- `gateway-group.test.ts`: "a synthetic follow-up carries no quote" → the room reply's opts have no `replyTo`.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/approval-follow-up.test.ts src/agents/gateway/question-answer.test.ts` → **11 passed** (2 files).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts` → **21 passed** (1 file).
- Spec check `pnpm --filter @zilar/server exec vitest run src/agents/gateway src/questions --reporter=dot` → **125 passed** (16 files).
- `pnpm gate` (repo root) summary:
  ```
  gate: 13 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (2.0s)
  PASS  lint  (2.1s)
  PASS  typecheck  (5.8s)
  PASS  effect  (3.0s)
  PASS  tests @zilar/server  (52.6s)
  scope: 3 file(s) outside the Allowed files:
    apps/server/src/agents/gateway/group-turn-body.ts
    apps/server/src/agents/gateway/pending.ts
    apps/server/src/agents/group-turn-deps.ts
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (first gate run failed `format` on `gateway-group.test.ts`; fixed with `pnpm exec prettier --write`, then the run above is clean.)

### Notes for the lead

- **Scope:** the gate lists three files outside `### Allowed files`. They are the "turn send path" files Spec step 2 explicitly authorises and asks to name here (`pending.ts`, `group-turn-deps.ts`, `group-turn-body.ts`). No other file outside the Allowed list changed.
- The reply-quote fix covers the success reply path (the one Julio saw). The rare `runGroupTurnBody`-throws failure path in `gateway/group-turn.ts` still sends its fixed failure text with `replyTo: { id: trigger.id }`; I left it untouched to keep the change inside the authorised turn-send set. Say the word if you want it guarded too.
- `group-turn-body.ts` is now 396 lines (limit 400); further additions there will trip the size check.
- Questions are closed by room (`room_jid`), which is the room the topic maps to, matching how `ai-activity` scopes open questions per topic.

### Round 2 (prereview fixes)

- **Finding 1 (must-fix) — fixed.** `approval-follow-up.ts` now skips the follow-up for every routine action: `row.action === 'routine.schedule'` became `row.action.startsWith('routine.')`, so `routine.pause` and `routine.delete` approvals no longer queue a turn either (the card's check line plus the routine's own message are the whole result, same as `routine.schedule`).
- **Test added/adjusted.** `gateway/approval-follow-up.test.ts` turned the single `routine.schedule` case into `it.each(['routine.schedule', 'routine.pause', 'routine.delete'])`, asserting both queues stay empty and no kick fires for each action.
- **Finding 2 (nit) — left untouched.** The `runGroupTurnBody`-throws failure path in `gateway/group-turn.ts:341-347` still sends its fixed failure text with `replyTo: { id: trigger.id }`. Per the round brief, nits are not touched unless they fall on a line already changed; this line does not. No disagreement with the finding — it is a real (rare) gap, deliberately deferred.
- **Checks this round.** `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/approval-follow-up.test.ts` → **9 passed** (1 file). Spec check `pnpm --filter @zilar/server exec vitest run src/agents/gateway src/questions --reporter=dot` → **127 passed** (16 files). `pnpm gate` → **GATE PASS** (install, format, lint, typecheck, effect, tests @zilar/server; the same 3 authorised scope files, no new ones).


## Review (written by Claude)

- **Accepted at `d5ff2c7df`.** It's clean after one automatic round (1 nit, 1 follow-up), and the packet is current. The lead ran `approval-follow-up.test.ts`, `question-answer.test.ts` and `gateway-group.test.ts`: 34 passed.
- **What changed:**
  - no follow-up turn after a `routine.*` approval;
  - follow-up triggers are marked synthetic, and the success reply carries no `replyTo`;
  - a person's turn-triggering message closes the AI's open questions in that room (`answerOpenQuestionsOnTurn`);
  - `ask_people` caps are 140/24, the same in all three places.
- **Files outside the list:** `group-turn-body.ts`, `pending.ts` and `group-turn-deps.ts` are in the reply path, which the spec allowed when named in the Report.
- **Left for later:**
  - the failure reply (`group-turn.ts:341-347`) still quotes a synthetic trigger id. T-1739 hides an empty quote in the apps;
  - a batch with a real message followed by a synthetic one doesn't close the question on that turn.
