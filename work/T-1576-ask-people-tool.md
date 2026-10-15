---
id: T-1576
title: "AI questions step 4 (plan docs/audit/handoff-questions-plan.md): a 'question' payload in @zilar/protocol; the ask_people group tool (question + 2-4 options) offered when a person triggered the turn; its runner stores the ai_questions row, posts the card (fallback text = question + numbered options) and stamps the message id on the still-open row"
status: merged
milestone: M5
branch: task/T-1576-ask-people-tool
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1576: The ask_people tool and question card

## Spec (written by Claude, do not edit)

### Why
Julio approved "a question with reply chips". Background:
- `docs/audit/handoff-questions-plan.md` §3 and §7 step 4;
- the lead's answers in `work/T-1566-audit-handoff-questions.md` › Review: a new table (done in T-1571); a chip tap is a normal reply; anyone who can post may answer; topics only;
- **the T-1571 Review's notes for this step:** stamp `message_id` only on an open row.

This task lets an AI post a question card. Rendering the chips is step 5, and closing on a reply is step 6. Until step 5, clients show the card's fallback text: web shows text beside unknown cards, and the phone falls back to the text since T-1572.

### Facts (the lead read them on main, 2026-10-15)
- **Storage (T-1571):** `apps/server/src/questions/service.ts` has:
  - `createQuestion(db, { aiId, groupId, topicId, roomJid, question, options, ttlMs? })`, which trims, validates (1–300 chars, 2–4 options of 1–40) and caps at 20 open per AI (`HttpError(429, 'too_many_questions', …)`);
  - `setQuestionMessageId(db, id, messageId)`: it stamps any row with `message_id IS NULL`, **including a closed one** (T-1571 nit 3);
  - `findOpenQuestionByMessage`, `answerQuestion` and `listOpenQuestions`.
- **Model tools:**
  - names and argument schemas: `apps/server/src/agents/tools/schemas.ts` (207 lines; `DELEGATE_TOOL` at `:11`, its call shape near `:198`);
  - the `ValidToolCall` union: `apps/server/src/agents/tool-loop.ts:42-60`;
  - definitions: `apps/server/src/agents/tools/definitions.ts` (263), with `buildGroupTools(actions, delegateTargets?, opts?)` at `:251-263`;
  - the barrel: `apps/server/src/agents/tools.ts` (67).
- **The executor:** `apps/server/src/agents/gateway/tool-exec.ts` (339).
  - Its context is `ToolExecContext` (`:48-56`: `deps`, `logger`, `sessions`, `roomRounds`, `sessionIsLive`, `pumpRoom`, `secretsFor`), and it is built in `apps/server/src/agents/gateway.ts:154`.
  - In a group context it refuses any tool not on its allow-list (`:101-122`).
  - Runners are split out per concern: `apps/server/src/agents/gateway/request-action.ts` (96) is the model.
- **Sending:** `liveSendMessage(session, to, kind, text, opts?)` returns `{ id }`, the stanza id (`apps/server/src/agents/gateway/live.ts:60-68`); `opts.payload` carries a payload.
- **The group turn:** `apps/server/src/agents/gateway/group-turn-body.ts` (366) builds `groupTools = buildGroupTools(...)`. The trigger records whether it is an AI handoff (find the `handoff` flag on the queued trigger; `contracts.ts:155-156` per the plan).
- **The protocol:** the payload union is in `packages/protocol/src/payload.ts`; `handoff-line.ts` (T-1572) is the model for a small new payload.

### Steps
1. **Protocol:** new `packages/protocol/src/question.ts`, `QuestionSchema = struct({ id: <string 1–64>, ai: JidSchema, question: <string 1–300>, options: <array of string 1–40, 2–4 items> })`.
   - Add `{ v: 0, type: 'question', data: QuestionSchema }` to `PayloadSchema`, and export it from the index.
2. **The tool:**
   - `ASK_PEOPLE_TOOL = 'ask_people'`, with args `{ question: string, options: string[] }` (schemas plus the `ValidToolCall` member);
   - a definition whose description tells the model to use it for a decision only the people in the room can make, with 2–4 short options, and never to ask the same thing twice;
   - `buildGroupTools` gains `opts.askPeople?: boolean` and appends the tool when it is true.
3. **`group-turn-body.ts`:** pass `askPeople: true` only when the trigger is a person (not an AI handoff trigger).
4. **The runner:** new `apps/server/src/agents/gateway/ask-people.ts`, `runAskPeople(...)`.
   - It reads the AI id, room, group and topic **from the session and context, never from the call**, like `request-action.ts`.
   - It calls `createQuestion`, then posts the card with `liveSendMessage(session, roomJid, 'groupchat', fallbackText, { payload: { v: 0, type: 'question', data: { id, ai: <this AI's bare JID>, question, options } } })`. The fallback text is the question, then one `n. option` line per option.
   - It then calls `setQuestionMessageId`.
   - **Model text:**
     - success: "Your question was posted. The people here will answer in this room; wait for their reply.";
     - a `too_many_questions` error: "invalid: too many open questions";
     - any other failure: "error: the question could not be posted".
   - Logs carry the AI id and the outcome only, never the text.
   - Wire it into `tool-exec.ts`: add it to the group allow-list, and refuse it as an unknown tool when `askPeople` was not offered, the same way `request_action` uses `allowActions`. Pass `liveSendMessage` into `ToolExecContext` from `gateway.ts:154` if it is not reachable.
5. **`setQuestionMessageId`:** it stamps only a row that is still `open`.
6. **Tests** (the message pipeline):
   - extend `apps/server/src/questions/service.test.ts` with "does not stamp a closed row";
   - add one runner test in `apps/server/src/agents/gateway/ask-people.test.ts` with a fake send: it posts the payload and stamps the returned id.

### Not in scope
- client rendering (step 5);
- the answer path (step 6);
- activity (step 7);
- DMs.

### Allowed files
- `packages/protocol/src/question.ts` (new)
- `packages/protocol/src/payload.ts`
- `packages/protocol/src/index.ts`
- `apps/server/src/agents/tools/schemas.ts`
- `apps/server/src/agents/tools/definitions.ts`
- `apps/server/src/agents/tools.ts`
- `apps/server/src/agents/tool-loop.ts`
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/agents/gateway/ask-people.ts` (new)
- `apps/server/src/agents/gateway/ask-people.test.ts` (new)
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway.ts`
- `apps/server/src/agents/tools/parse.ts` (added by the lead after the block)
- `apps/server/src/agents/tool-calls.ts` (added by the lead after the block)
- `apps/server/src/agents/gateway/group-turn.ts` (added by the lead after the block)
- `apps/server/src/questions/service.ts`
- `apps/server/src/questions/service.test.ts`
- `work/T-1576-ask-people-tool.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway/ask-people.test.ts src/questions/service.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The new tests pass, and the gate passes.
- Every file stays under 400 lines (`tool-exec.ts` is 339; put the new logic in `ask-people.ts`).
- The Report gives the tool definition text and the `wc -l` of the changed gateway files.

---

## Report (written by the worker when done)

### What I did

All five steps are done and the gate is green. The tool is wired end to end: a person-triggered group turn offers `ask_people`, and a call stores the `ai_questions` row, posts the card and stamps the message id.

1. **Protocol (step 1, done).** New `packages/protocol/src/question.ts` with `QuestionSchema` (`id` 1–64, `ai` bare JID, `question` 1–300, `options` an array of 1–40-char strings with 2–4 items); added `{ v: 0, type: 'question', data: QuestionSchema }` to `PayloadSchema` in `payload.ts`, exported `./question` from `index.ts`.
2. **Storage nit (step 5, done).** `apps/server/src/questions/service.ts`: `setQuestionMessageId` now stamps only a row that is still `open` (`WHERE id = $1 AND message_id IS NULL AND status = 'open'`), per the T-1571 Review. Test added in `service.test.ts` ("does not stamp a closed row").
3. **Tool name + args schema (step 2).** `tools/schemas.ts` gains `ASK_PEOPLE_TOOL = 'ask_people'` and `AskPeopleArgsSchema` (question 1–300, options 2–4 × 1–40), exported through the `tools.ts` barrel.
4. **Tool definition (step 2).** `tools/definitions.ts` gains `ASK_PEOPLE_TOOL_DEF`; `buildGroupTools(actions, delegateTargets?, opts?)` gains `opts.askPeople` and appends it when true (`tools.ts` barrel updated).
5. **Runner (step 4).** New `apps/server/src/agents/gateway/ask-people.ts`, `createAskPeopleRunner(db, logger, send)`. It reads the AI id, room, group and topic from the session/context only; calls `createQuestion`; posts the card through `send` (= `liveSendMessage`) with `payload: { v: 0, type: 'question', data: { id, ai: session.aiJid, question, options } }` and fallback text `question` then one `n. option` line per option; then calls `setQuestionMessageId`. Model texts: `"Your question was posted. The people here will answer in this room; wait for their reply."`, `"invalid: too many open questions"` (a `too_many_questions` `HttpError`), `"error: the question could not be posted"` (any other failure). Logs carry the AI id, the tool name (fixed) and the outcome only — never the question or options. New runner test `apps/server/src/agents/gateway/ask-people.test.ts` uses a fake send and asserts the payload, the fallback text and that the returned id is stamped on the row.
6. **Parse pipeline (step 2).** `tools/schemas.ts` gains the `ParsedToolArguments` member; `tools/parse.ts` adds `ask_people` to its whitelist and decodes it with `AskPeopleArgsSchema`; `tool-loop.ts` gains the `ValidToolCall` member; `tool-calls.ts`'s `toCall` maps the parsed shape onto it.
7. **Per-turn flag + offering (step 3).** `group-turn.ts`'s `RequestActionContext` gains `askPeople`; `group-turn-body.ts` sets `askPeople = trigger.handoff !== true` (so only a person-triggered turn gets it) and passes it both to `buildGroupTools` and to the executor context.
8. **Executor wiring (step 4).** `gateway.ts` passes `liveSendMessage` into `createToolExec`; `ToolExecContext` carries it and builds the ask-people runner; `tool-exec.ts` adds `ask_people` to the group allow-list, refuses it with `invalid: unknown tool` when `context.askPeople` is false (and when there is no context, i.e. a DM), and otherwise runs `runAskPeopleEffect` with the turn's `groupId`/`topicId`/`roomJid`.

### Tool definition text

```
name: ask_people
description: Ask the people in this room to decide something only they can decide. Offer 2-4 short options for the likely answers: they can tap one, and a free reply is still allowed. Ask one question at a time and never ask the same thing twice.
parameters: { question: string(1..300), options: array<string(1..40)>(2..4) }, required [question, options], additionalProperties false
```

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/ask-people.test.ts src/questions/service.test.ts` → **2 files passed, 9 tests passed**.
- `pnpm --filter @zilar/protocol test --maxWorkers=2 --reporter=dot src/payload.test.ts` → **1 file passed, 15 tests passed**.
- `pnpm gate` (from the repo root):
  ```
  gate: 18 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.4s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/protocol  (1.1s)
  PASS  tests @zilar/server  (18.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Changed gateway files (`wc -l`): `ask-people.ts` 142, `ask-people.test.ts` 110, `tool-exec.ts` 368, `group-turn-body.ts` 374, `group-turn.ts` 338. All under 400.

### Blocked note (resolved)

Resolved: the spec's parse gap needed `tools/parse.ts`, `tool-calls.ts` and `group-turn.ts`; the lead added them to the Allowed files and I finished the parse/`toCall`/executor wiring (steps 6–8 above), so the last gate is green with every changed file in scope.

### Notes for the lead

- The wiring was verified by `pnpm gate` (typecheck covers the new parse/`toCall`/executor members and the flag). I did not add a separate parse-pipeline test; the spec's Test section asks only for the runner test and the closed-row test.
- The `ai` field on the payload is `session.aiJid` (the bare AI JID the session was built with).
- `packages/protocol/src/payload.test.ts` does not enumerate the union exhaustively (`handoff.line`/`sticker` are already absent from its `expectedTypes`), so the new `question` member needed no test edit there — and that file is outside scope anyway.
- An empty id from `liveSendMessage` means the stop kill-switch dropped the send; the runner leaves the row unstamped and, since the fix round below, treats that as a failed post.

### Round (fix round, 2026-10-15)

Fixed both prereview findings, one commit each:

- **Finding 1 (should-fix, `ask-people.ts:85-96`):** a `send` that threw left the `ai_questions` row `open` with `message_id` NULL — invisible to every read, but still counted by the per-AI 20-open cap until 24h expiry. Added `expireQuestion(db, id)` to `questions/service.ts`: it sets `status = 'expired'` on an `open`, unstamped row so the cap slot is refunded; a stamped row (a visible card) is left alone. `postCard` now calls it when the send fails. Commit `f0d42a049`.
- **Finding 2 (nit, `ask-people.ts:85-89`):** an empty id (stop kill-switch dropped the send) used to return `ok: true` and the success text. That line is inside the block the finding-1 fix rewrites, so it is now treated as a failure: the row is expired and the model gets `error: the question could not be posted`. Commit `46081eef1`.

Tests added:

- `ask-people.test.ts` › "expires the row so a failed send refunds the cap slot" (send throws → `error: …` and the AI's open-question count is 0).
- `ask-people.test.ts` › "treats a dropped send as a failure and refunds the cap slot" (send returns `{ id: '' }` → failed text, count 0).
- `service.test.ts` › "expires an unposted open row so it stops counting against the cap" (expires an unstamped open row; leaves a stamped row `open`).

Checks: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/ask-people.test.ts src/questions/service.test.ts` → **2 files passed, 12 tests passed**. `pnpm gate` → **GATE PASS** (18 changed files, all inside scope; every changed source file under 400 lines).

Disagreements: none.

## Review (written by Claude)

**Approved and merged.**

- **The block:** the worker blocked once because the spec missed the parse pipeline. The lead added `tools/parse.ts`, `tool-calls.ts` and `gateway/group-turn.ts`, and saved a memory note for future tool specs.
- **Pre-review:** clean after one autopilot round.
- **What the lead checked:**
  - **Who gets the tool:** `ask_people` is offered only when `trigger.handoff !== true` (a person triggered the turn), and `tool-exec.ts` refuses it as an unknown tool otherwise.
  - **The runner:** `gateway/ask-people.ts` takes the AI, room, group and topic from the session and context, never from the call. Its logs carry the AI id and the outcome only.
  - **The question card:** `question` payload `{ id, ai, question, options }`; the fallback text is the question plus numbered options.
  - **`setQuestionMessageId`** now stamps only an open row.
  - **Tests:** the lead ran `ask-people.test.ts` and `questions/service.test.ts` on the branch, 12 passed.
  - **Sizes:** `tool-exec.ts` 376 and `group-turn-body.ts` 374 lines. Both are near the limit, so the next gateway change should split first.
- **Next:** step 5 (the chips on web and phone), step 6 (a reply closes the question) and step 8 (the "AIs here" row opens it).
