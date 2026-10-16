---
id: T-1761
title: "AI cards, Julio's test: tool.run posts a tool's blocks as a card; after an AI posts a card (post_blocks or tool.run) the turn sends no echo reply; group replies quote the asker but no longer start with @asker"
status: merged
milestone: M5
branch: task/T-1761-ai-card-no-echo
model: auto
effort: default
depends_on: [T-1758, T-1759]
estimate: 45 min
---

# T-1761: AI cards without echo or tag

## Spec (written by Claude, do not edit)

### Why
Julio tested message blocks live on 2026-10-16 (about 21:28 UTC). He wrote "@Deepseek post the BTC, gold and S&P prices as a card" in "ai test › General", and got:
1. **A plain-text post:** `market-prices BTC $81629.92 · Gold … (as of …)`. Deepseek updated its saved tool to return `blocks` and ran it with `tool.run`, but `tool.run` posts plain text and ignores `blocks`.
2. **A second message** that quotes his message, starts with `@Julio`, and **repeats the same prices**.

His words: "its broken and we really dont need the second message the one duplicating the content and taging me".

### Facts (read by the lead on 2026-10-16)
- **`tool.run`** is `toolRunAdapter` in `apps/server/src/tools/tool-adapters.ts:210-275` (326 lines).
  - On success it posts `text: \`${found.name}\n${truncateChars(text, MAX_TOOL_POST_CHARS)}\`` through `state.post(...)` (`:262-273`).
  - It returns `{ summary: 'ok', modelText: text }`.
  - `ran.result.output` now carries `blocks?: unknown` (T-1759: `apps/server/src/sandbox/types.ts`, `apps/server/src/tools/types.ts:13`).
  - `state.post` already accepts `payload?: Payload` (T-1759: `apps/server/src/tools/adapter-support.ts:23-29`).
- **The routine twin to copy:** `routineBlocksPayload` in `apps/server/src/routines/outcomes.ts`. It calls `buildBlocksPayload({ title, meta?, blocks }, outputText)` from `apps/server/src/message-blocks/build.ts`, posts the payload when `ok`, and otherwise posts plain text and logs ids only.
- **The adapter result:** `ActionResult { summary; modelText? }` (`apps/server/src/actions/registry.ts:44-47`).
  - It flows to `{ status: 'executed'; summary; modelText? }` (`apps/server/src/actions/gateway.ts:20`, built in `apps/server/src/actions/decisions.ts:117-140,176-181`).
  - Then the request-action runner turns it into `{ content: \`done: …\` }` (`apps/server/src/agents/gateway/request-action.ts:72`).
- **`post_blocks`** (T-1758) posts its card in `apps/server/src/agents/gateway/post-blocks.ts` and returns `{ content: POSTED_TEXT }`.
- **`ToolExecution`** is `{ content; notice?; stage?; … }` (`apps/server/src/agents/tool-loop.ts:84-…`). The loop collects results in `apps/server/src/agents/tool-rounds.ts` (213 lines; the `notices` and `toolCalls` fields, `:79-150`).
- **The group reply:**
  - `runGroupTurn` in `apps/server/src/agents/group-turn.ts` (325 lines) builds every reply with `wire(text)` (`:85-121`): `prefix = \`@${name} \``, a mention span `{ begin: 0, end: name.length + 1 }`, handoff mention offsets measured after the prefix, and `replyTo: { id: deps.triggerId }` unless the trigger is synthetic;
  - `runGroupToolTurn` (`:202-…`) runs the tool loop, then sends the final text with `sendGroupReply(deps, secrets, wire(text))`;
  - `stripLeadingMention` (`apps/server/src/agents/reply-mention.ts`) removes the model's own `@asker` echo.

### Steps
1. **`tool.run` posts blocks:** in `toolRunAdapter`, when `ran.result.output.blocks !== undefined`, build `buildBlocksPayload({ title: found.name, blocks }, text)`.
   - **If `ok`,** post with the same text plus `payload`.
   - **Otherwise,** post plain text as today, and log `{ aiId }` only, never the reason.
2. **The card flag:** a post that worked tells the turn that the room already got the answer.
   - Add `posted?: boolean` to `ActionResult`, and carry it through `decisions.ts` into the `executed` outcome and on to `request-action.ts`, which returns `postedToRoom: true` on the `ToolExecution`.
   - `toolRunAdapter` sets `posted: true` when its `state.post` resolved `true`.
   - `post-blocks.ts` sets `postedToRoom: true` on success.
   - Add `postedToRoom?: boolean` to `ToolExecution`, and have `tool-rounds.ts` record `postedToRoom` on its result when any executed call returned it.
3. **No echo:** in `runGroupToolTurn`, when the loop's result has `postedToRoom`, **send no final text reply**.
   - Finish the work card as done, the way a normal reply finishes it (look for the existing finish and progress helpers in the file), and return a `replied` outcome with empty text.
   - Failures, stops and budget trips keep their current replies.
4. **No tag:** group replies no longer start with `@asker`.
   - In `wire`, drop the prefix and the asker's mention span. Keep `replyTo` on the trigger, so the reply still quotes the message.
   - Keep `stripLeadingMention`, so a model that writes `@Julio …` itself doesn't re-add it.
   - Recompute the handoff mention offsets without the prefix.
   - The fixed failure reply (`@${name} ${GROUP_FAILURE_REPLY}` at `group-turn.ts:343`) and the room-limit notice (`apps/server/src/agents/gateway/room-limits.ts:87`) also drop the `@name ` part.
5. **Tests (the message pipeline, at most 2 new):**
   - a group tool turn where `post_blocks` returns `postedToRoom` sends no final reply;
   - `wire`'s output text has no `@asker` prefix and still carries `replyTo`.
   - Existing assertions that expect the `@Name ` prefix (for example in `apps/server/src/agents/gateway-group.test.ts`) are updated to the new behaviour, not deleted. List them in the Report.
   - Keep every touched source file at most 400 lines.

### Allowed files
- `apps/server/src/tools/tool-adapters.ts`
- `apps/server/src/actions/registry.ts`
- `apps/server/src/actions/gateway.ts`
- `apps/server/src/actions/decisions.ts`
- `apps/server/src/agents/gateway/request-action.ts`
- `apps/server/src/agents/gateway/post-blocks.ts`
- `apps/server/src/agents/gateway/room-limits.ts`
- `apps/server/src/agents/tool-loop.ts`
- `apps/server/src/agents/tool-rounds.ts`
- `apps/server/src/agents/group-turn.ts`
- `apps/server/src/agents/group-turn-card.test.ts` (new: the 2 new tests)
- `apps/server/src/agents/gateway-group.test.ts`
- `apps/server/src/agents/gateway-stop.test.ts`
- `apps/server/src/agents/handoff.test.ts`
- `apps/server/src/agents/reply-mention.test.ts`
- `apps/server/src/agents/gateway/approval-follow-up.test.ts`
- `apps/server/src/agents/gateway/question-answer.test.ts`
- `apps/server/src/agents/gateway/topic-follow.test.ts`
- `work/T-1761-ai-card-no-echo.md`

If another test file asserts the `@Name ` prefix, stop and list it in the Report instead of editing outside this list.

### Checks
```bash
cd apps/server && pnpm exec vitest run src/agents/group-turn-card.test.ts src/agents/gateway-group.test.ts src/agents/gateway-stop.test.ts src/agents/handoff.test.ts src/agents/reply-mention.test.ts src/agents/gateway/approval-follow-up.test.ts src/agents/gateway/question-answer.test.ts src/agents/gateway/topic-follow.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- `tool.run` of a tool that returns valid blocks posts a `blocks` card.
- A group turn that posted a card sends no second message.
- Group replies quote the asker without an `@asker` tag.
- The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

1. **`tool.run` posts blocks** (`apps/server/src/tools/tool-adapters.ts`):
   when `ran.result.output.blocks !== undefined` it calls
   `buildBlocksPayload({ title: found.name, blocks }, text)`. A valid set is
   posted with the same `"<name>\n<text>"` body plus the `blocks` payload; an
   invalid set falls back to today's plain post and logs the AI id only. The
   inline comment lives next to the code.
2. **Card flag carried through the pipeline**:
   - `ActionResult` gained `posted?: boolean` (`actions/registry.ts`).
   - `decisions.ts` copies `result.posted === true` into the `executed` outcome
     on both the allow path and the auto-approved path.
   - `RequestOutcome`'s `executed` variant gained `posted?: boolean`
     (`actions/gateway.ts`).
   - `request-action.ts` turns it into `postedToRoom: true` on the
     `ToolExecution`.
   - `post-blocks.ts` returns `{ content: POSTED_TEXT, postedToRoom: true }` on
     a successful post.
   - `ToolExecution` gained `postedToRoom?: boolean` (`agents/tool-loop.ts`).
   - `tool-rounds.ts` (`runToolLoop`) wraps both executor seams and records the
     flag from every executed call, returning it on all loop outcomes.
3. **No echo** (`agents/group-turn.ts`): after the failure branch,
   `runGroupToolTurn` checks `loop.postedToRoom`; when set it finishes the card
   `done` (same helper a normal reply uses) and returns
   `{ kind: 'replied', text: '' }` without a second model call or a room send.
   Failures, stops and budget trips keep their existing replies.
4. **No tag** (`agents/group-turn.ts`): `wire` drops the `@asker ` prefix and the
   asker's mention span; it still sets `replyTo` on the trigger and keeps
   `stripLeadingMention`, so a model that writes `@Julio …` itself does not
   re-add it. Handoff mention offsets are recomputed without the prefix (and
   capped at 2, matching `buildHandoffLine`). The fixed failure reply goes
   through `wire`, so it also lost the prefix. The room-rate notice
   (`agents/gateway/room-limits.ts`) now sends `ROOM_RATE_LIMIT_NOTICE` alone.
5. **Tests**: new `apps/server/src/agents/group-turn-card.test.ts` (2 tests:
   card turn sends no echo, and a plain reply quotes the trigger with no `@`
   prefix / no asker mention). Existing prefix assertions in
   `apps/server/src/agents/gateway-group.test.ts` were updated to the new
   behaviour:
   - `group reply wakes the AI (T-1176)` `isReply` now matches the AI text
     `'AI answer'` instead of `message.text.startsWith('@Owner ')`.
   - `group mentions from different senders (T-1290)` `isReply` now matches
     `text.includes('answer')` and the three prefix checks were replaced with
     "no reply starts with `@`" plus "each reply quotes its own trigger"
     (`replyTo` ids `m-1/m-2/m-3`).

### Checks run

- `pnpm install` → Done.
- Targeted tests (from `apps/server`):
  `pnpm exec vitest run src/agents/group-turn-card.test.ts src/agents/gateway-group.test.ts src/agents/gateway-stop.test.ts src/agents/handoff.test.ts src/agents/reply-mention.test.ts src/agents/gateway/approval-follow-up.test.ts src/agents/gateway/question-answer.test.ts src/agents/gateway/topic-follow.test.ts --maxWorkers=2 --reporter=dot`
  → **Test Files 8 passed (8), Tests 75 passed (75)**. The new file alone:
  2 passed (2).
- `pnpm gate` (repo root):
  ```
  gate: 13 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.3s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.5s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/server  (18.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Deviation (logging):** the spec asks to log `{ aiId }` only when
  `buildBlocksPayload` rejects a tool's `blocks`. `AdapterState`
  (`tools/adapter-support.ts`) has no logger, and that file is not in the
  Allowed files, so there is no in-scope structured-logger seam.
  I used `console.warn({ aiId }, 'tool.run blocks invalid')` in
  `tool-adapters.ts` — the AI id only, never the reason. If you would rather
  have a pino logger on `AdapterState`, that needs `adapter-support.ts` (and its
  caller `tools/adapters.ts`) in scope; I can do it in a follow-up.
- The handoff mention cap is now 2 (as `buildHandoffLine` already capped its
  `to` list at 2); previously the cap was 3 entries including the removed asker
  span, i.e. also 2 handoffs, so live behaviour is unchanged.
- `RateNoticeInput.askerName` is now unused inside `room-limits.ts`. It is kept
  because its caller (`agents/gateway/group-turn.ts`, outside the Allowed files)
  still passes it; removing the field would break that file's typecheck.
- No other test file outside the Allowed list asserted the `@Name ` reply
  prefix (checked the whole `apps/server/src` tree).

### Round 2 — fixes for PREREVIEW

Findings fixed:

- **F1 (should-fix, `console.warn` bypasses redaction):** the invalid-blocks
  warning no longer uses `console.warn`; it goes through the gateway's
  redacting logger. `ActionContext` (`actions/registry.ts`) gained an optional
  `logger?: ActionContextLogger` (the `warn`-only shape the gateway logger
  already has); `ActionGatewayLogger` (`actions/gateway.ts`) now extends it;
  both `ActionContext` construction sites in `actions/decisions.ts`
  (`allow` and standing-rule paths) pass `deps.logger`;
  `tools/tool-adapters.ts` calls
  `actionCtx.logger?.warn({ aiId: actionCtx.aiId }, 'tool.run blocks invalid')`.
  It is still the AI id only, never the reason. This stays inside the Allowed
  files: `AdapterState` lives in `tools/adapter-support.ts` (out of scope), so
  the logger rides on the execution context the adapter already receives. The
  optional field keeps `ActionContext` literals built by hand (tests, the
  approval path `actions/approval-path.ts`) compiling unchanged.

Findings left as written (not must-fix or should-fix):

- F2 (nit, `posted` boolean trusted before the post lands): left untouched.
  Asserting on a sent id would change the `state.post` contract in
  `tools/adapter-support.ts`, outside the Allowed files.
- F3, F4 (follow-ups, stale comments): their files
  (`agents/gateway/group-turn-body.ts`, `agents/reply-mention.ts`) are outside
  the Allowed files.
- F5 (nit, new-card test uses a stubbed executor): left untouched; a
  real-`post_blocks` test would need a test file outside the Allowed list.

No disagreements with any finding. Tests added this round: none — F1 is
log-routing, not a pipeline behaviour change, and no Allowed test file covers
`tools/tool-adapters.ts` (its only test would be a new file outside the list).
Existing tests re-run below still pass.

Commands run this round:

- `cd apps/server && pnpm exec vitest run src/agents/group-turn-card.test.ts
  src/agents/gateway-group.test.ts src/agents/gateway-stop.test.ts
  src/agents/handoff.test.ts src/agents/reply-mention.test.ts
  src/agents/gateway/approval-follow-up.test.ts
  src/agents/gateway/question-answer.test.ts src/agents/gateway/topic-follow.test.ts
  --maxWorkers=2 --reporter=dot`
  → **Test Files 8 passed (8), Tests 75 passed (75)**.
- `cd apps/server && pnpm exec vitest run src/actions/approval-reuse.test.ts
  src/actions/args-example.test.ts src/actions/unattended.test.ts
  src/tools/routine-schedule-prompt.test.ts --maxWorkers=2 --reporter=dot`
  → **Test Files 4 passed (4), Tests 29 passed (29)** (nearest tests of the
  `actions/` files I touched).
- `pnpm gate` (repo root) → **GATE PASS**:
  ```
  gate: 13 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.7s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/server  (17.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

Files changed this round (all in Allowed files):
`apps/server/src/actions/registry.ts`, `apps/server/src/actions/gateway.ts`,
`apps/server/src/actions/decisions.ts`, `apps/server/src/tools/tool-adapters.ts`.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `287b77f23`.
- `tool.run` builds `buildBlocksPayload({ title: found.name, blocks }, text)` and posts the card. Invalid blocks fall back to plain text, with an ids-only warning through the action context's logger.
- `posted` comes back only when `state.post` resolved `true`. It carries through the `executed` outcome to `postedToRoom` in `request-action.ts`, and `post-blocks.ts` sets it too.
- `runGroupToolTurn` sends no final reply when the flag is set, finishes the work card as `done`, and runs the failure, stop and budget branches first.
- `wire()` drops the `@asker` prefix and span, keeps `replyTo`, and recomputes the handoff offsets.
- I ran the 8 spec test files plus `src/tools`: 82 passed.
- **Accepted on purpose:** a plain-text `tool.run` also counts as posted, so it gets no echo either. That is Julio's "we really dont need the second message".
- **Lead miss:** spec step 4 named `apps/server/src/agents/gateway/group-turn.ts:343`, but Allowed listed `apps/server/src/agents/group-turn.ts`. So the crash-only failure reply still tags the asker (PREREVIEW F1).
- **Follow-up T-1763:** F1, F2 (the approval-path `execute` passes no logger in `actions/queries.ts:302`), F3 (stale prefix comments and the dead `askerName`) and N2 (a test for the `posted` → `postedToRoom` link).
