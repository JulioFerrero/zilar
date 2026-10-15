---
id: T-1579
title: "AI questions step 6 (plan docs/audit/handoff-questions-plan.md): when the AI's own question card comes back from the room, re-key the ai_questions row to the archive stanza id clients quote; a person's reply to that message answers (closes) the question, handled once by the asking AI's session; logic in gateway/question-answer.ts"
status: merged
milestone: M5
branch: task/T-1579-question-answer-path
model: auto
effort: default
depends_on: []
estimate: 50 min
---

# T-1579: A reply closes the question

## Spec (written by Claude, do not edit)

### Why
The lead's answers (`work/T-1566-audit-handoff-questions.md` › Review, items 4–6):
- a chip tap or a typed reply to the question answers it;
- the first reply closes it;
- the asking AI's turn is woken by the reply as today.

The plan is `docs/audit/handoff-questions-plan.md` §3e, §3f and §7 step 6.

### Facts (the lead read them on main after T-1576, 2026-10-15)
- **`apps/server/src/agents/gateway/ask-people.ts`** (T-1576) posts the card with `liveSendMessage(...)` and stamps `setQuestionMessageId(db, id, <the returned id>)`. That returned id is the **origin id the gateway chose**.
- **`apps/server/src/agents/gateway/group-ingest.ts` (317 lines), `handleRoomIncoming` (`:88`):**
  - the AI's own room reflection comes back with `message.outgoing`. Its `message.id` is the **archive stanza id (XEP-0359) that clients quote in `replyTo.id`**, and `message.originId` is the id the gateway chose (`:93-108`). Today it only remembers both ids;
  - a person's message opens a round (`:128-139`);
  - `mentioned` includes a reply to the AI (`replyTargetsAi`, `:141-148`), which queues the turn.
- **Clients** reply with `replyTo.id` = the stanza id. So **`findOpenQuestionByMessage(db, replyTo.id)` would never match the origin id**: the row must be re-keyed.
- **`apps/server/src/questions/service.ts`:** `findOpenQuestionByMessage(db, messageId)` returns the open, unexpired row; `answerQuestion(db, id, { answer, answeredBy })` closes it once and returns whether it changed.
- **The payload:** a question message's `message.payload?.type === 'question'` (`packages/protocol/src/question.ts`). Read how `ChatMessage` exposes the payload on the server side and cite it.

### Steps
1. **`questions/service.ts`:** `rekeyQuestionMessage(db, fromId, toId)` updates `message_id` from the origin id to the stanza id, only for an `open` row, and is a no-op when they are equal.
2. **New `apps/server/src/agents/gateway/question-answer.ts`** with two best-effort functions. Each logs the AI id and the outcome only, and never throws into ingest.
   - **`rekeyOnReflection(db, message)`:** when an outgoing reflection carries a `question` payload and has an `originId`, call `rekeyQuestionMessage(db, originId, message.id)`.
   - **`answerOnReply(db, session, message)`:**
     - for a message from a person (not an AI sender) with `replyTo.id`: `findOpenQuestionByMessage(db, replyTo.id)`;
     - **only if the row's `aiId === session.aiId`** (every AI session in the room receives the stanza; only the asker handles it), call `answerQuestion` with `answer` = the body with a leading `@<nick> ` removed, cut to 200 characters, and `answeredBy` = the sender's bare JID.
3. **`group-ingest.ts`:**
   - call `rekeyOnReflection` in the outgoing branch (without awaiting the turn path);
   - call `answerOnReply` for a person's message, before the mention early-return;
   - the turn queueing is unchanged.
4. **Tests:**
   - `apps/server/src/questions/service.test.ts`: `rekeyQuestionMessage` moves an open row and leaves a closed one;
   - new `apps/server/src/agents/gateway/question-answer.test.ts`, 2–3 cases with the real service on the test DB:
     - a person's reply to the re-keyed id closes the question with the option text;
     - another AI's session does nothing;
     - an AI sender's reply does not answer.

### Not in scope
- client changes;
- the activity (T-1577, which already drops closed rows);
- DMs.

### Allowed files
- `apps/server/src/questions/service.ts`
- `apps/server/src/questions/service.test.ts`
- `apps/server/src/agents/gateway/question-answer.ts` (new)
- `apps/server/src/agents/gateway/question-answer.test.ts` (new)
- `apps/server/src/agents/gateway/group-ingest.ts`
- `work/T-1579-question-answer-path.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway/question-answer.test.ts src/questions/service.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The new tests pass, and the gate passes.
- `group-ingest.ts` grows by at most ~15 lines; the Report gives its `wc -l`.

---

## Report (written by the worker when done)

### What I did

Implemented the answer path for a question card (plan §3e, §3f, §7 step 6):

1. **`apps/server/src/questions/service.ts`** — added `rekeyQuestionMessage(db, fromId, toId)`:
   moves `message_id` from the gateway's origin id to the archive stanza id, only for a
   still-`open` row, no-op when the two ids are equal, returns whether the row changed.
2. **`apps/server/src/agents/gateway/question-answer.ts`** (new, 87 lines) — two
   best-effort functions, each logging the AI id and the outcome only and swallowing every
   failure (errors become a logged no-op via `Effect.orElseSucceed`):
   - `rekeyOnReflection` — on an outgoing reflection with a `question` payload and an
     `originId`, re-keys the row to `message.id` (the stanza id clients quote).
   - `answerOnReply` — for a person's message with `replyTo.id`, finds the open question;
     only when the row's `aiId === session.aiId` (the asking AI's session) does it call
     `answerQuestion` with the body (leading `@<asking AI nick>` stripped, cut to 200
     chars) and `answeredBy` = the sender's bare JID.
3. **`apps/server/src/agents/gateway/group-ingest.ts`** — calls `rekeyOnReflection` in the
   outgoing branch and `answerOnReply` for a person's message (inside the existing
   non-AI-sender block, before the mention early-return); both fire-and-forget (`void`), so
   the turn queueing is unchanged.
4. **Tests** — `service.test.ts` got the re-key case (open row moves, equal-id no-op,
   closed row left alone); new `question-answer.test.ts` has 3 cases on the real service
   and test DB: a person's reply to the re-keyed stanza id closes the question with the
   option text; another AI's session does nothing; an AI sender's reply does not answer.

Files changed (all Allowed): `questions/service.ts`, `questions/service.test.ts`,
`agents/gateway/question-answer.ts` (new), `agents/gateway/question-answer.test.ts` (new),
`agents/gateway/group-ingest.ts`, `work/T-1579-question-answer-path.md`.

### Checks run

- Single test files: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/agents/gateway/question-answer.test.ts src/questions/service.test.ts`
  → `Test Files 2 passed (2)`, `Tests 13 passed (13)`.
- `pnpm gate` (from repo root):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.7s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/server  (9.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

`group-ingest.ts`: `wc -l` = **323** (was 317; **+6**, within the ~15 budget).

### Notes for the lead

- **Signature deviation (deliberate).** The spec lists `rekeyOnReflection(db, message)` and
  `answerOnReply(db, session, message)`. I added `session` to `rekeyOnReflection` and a
  `logger` to both, because "each logs the AI id" cannot be done otherwise: only the
  session carries `aiId`, and the gateway logger is how the adjacent modules log. Both
  functions are still best-effort and never throw into ingest. Say the word and I will drop
  the logger param / the `session` param.
- **Effect ratchet.** The first `pnpm gate` failed with `effect: .../question-answer.ts
  needs Effect (H1, W4)`. A new server source file that uses `async`/`try` must import
  `Effect`; I rewrote the module on `Effect.tryPromise`/`Effect.gen`/`Effect.orElseSucceed`
  (the `voice-transcription/routes.ts` pattern). Final gate passes.
- The reply-to id is only matchable after the re-key, which is why the reflection path is
  part of this task; verified in the tests by asserting the origin id no longer matches and
  the stanza id does.
- Security: logs carry only `aiId` and the error class name (`errorName`), never message
  text; the `UPDATE` is scoped by the row's `message_id` and `status`.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 3 nits.
- **What the lead checked:**
  - **The ingest change:** `group-ingest.ts` grew by 6 lines (to 323), with two fire-and-forget calls.
    - `rekeyOnReflection` runs on the AI's own reflection and moves the row from the origin id to the stanza id that clients quote.
    - `answerOnReply` runs for a person's message, before the mention early-return, and acts only when `question.aiId === session.aiId`, so one AI never closes another's question.
  - **Logs:** they carry the AI id and the error class only.
  - **Tests:** the lead ran `question-answer.test.ts` and `questions/service.test.ts` on the branch, 13 passed.
- **The nits, accepted:**
  - the helpers also take `session` and `logger`, which the logging needs;
  - a reply that is only `@<nick>` closes the question with an empty answer (a person did reply);
  - a reply landing before the re-key finishes would miss the close. That needs a reply within milliseconds of the card's reflection.
- **Next:** step 8 (the "AIs here" row opens the question).

