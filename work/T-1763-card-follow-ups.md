---
id: T-1763
title: "AI card follow-ups to T-1761: the crash failure reply drops @asker, approval-path tool.run gets the logger, a delegated card turn stores a summary, stale @prefix comments, one test for the posted link"
status: merged
milestone: M5
branch: task/T-1763-card-follow-ups
model: auto
effort: default
depends_on: [T-1761]
estimate: 30 min
---

# T-1763: AI card follow-ups

## Spec (written by Claude, do not edit)

### Why
T-1761 (merged as `9ff1e88f3`) made group replies quote the asker without an `@asker` tag, and stopped the echo reply after an AI posts a card. Its pre-review left follow-ups in files outside that task's Allowed list, and the lead found one more (step 3).

### Facts (read by the lead on 2026-10-17)
1. **The crash-only failure reply still tags the asker.** `apps/server/src/agents/gateway/group-turn.ts:341-348` (375 lines) sends `` `@${name} ${GROUP_FAILURE_REPLY}` `` with `mentions: [{ jid: normBareJid(trigger.fromJid), begin: 0, end: name.length + 1 }]`. Every other group reply is untagged since T-1761.
2. **The approval path passes no logger.** `apps/server/src/actions/queries.ts:302-310` (341 lines) calls `adapter.execute({ aiId, groupId, topicId, requestId }, pending.args)` without `logger`, while `ActionContext.logger?` exists (`apps/server/src/actions/registry.ts:41-47`) and `deps.logger` is in scope (`queries.ts:315`). An approved `tool.run` with invalid blocks therefore logs nothing.
3. **A delegated card turn stores an empty summary.** `apps/server/src/agents/gateway/group-turn-body.ts:366-374` (396 lines) stores `resultSummary: turnOutcome.text` when a delegated turn finishes. Since T-1761, a turn that posted a card returns `{ kind: 'replied', text: '' }` (`apps/server/src/agents/group-turn.ts`, the `loop.postedToRoom` branch), so the boss AI would get an empty result.
4. **Stale comments** that still describe the old `@<asker> ` prefix:
   - `apps/server/src/agents/reply-mention.ts:1-6`;
   - `apps/server/src/agents/handoff.ts:6` ("offsets are in the final wire text (the `@<sender> ` prefix shifted by its length)");
   - `apps/server/src/agents/gateway/group-turn-body.ts:364-365` ("with the `@<boss> ` prefix").
5. **A dead field:** `askerName` in `apps/server/src/agents/gateway/room-limits.ts:66` is no longer used. Its caller passes it at `apps/server/src/agents/gateway/group-turn.ts:248`.

### Steps
1. In `gateway/group-turn.ts`, the crash failure reply sends just `GROUP_FAILURE_REPLY`, with no mention span. Keep its `replyTo` rule as is.
2. In `actions/queries.ts`, pass `logger: deps.logger` in the `adapter.execute` context, if its type fits `ActionContextLogger`. If it doesn't, adapt it with a small wrapper that keeps ids-only logging.
3. In `group-turn-body.ts`, when a delegated turn is `replied` with empty text, store `resultSummary: 'Posted a card in the room.'`. Keep the file at most 400 lines.
4. Update the four stale comments, and remove `askerName` from `room-limits.ts` and its caller.
5. **One test** (the message pipeline): a group tool turn whose `executeTool` is the real request-action mapping of an `executed` outcome with `posted: true` sends no final reply. It covers the `posted` → `postedToRoom` → no-echo link end to end. Add it to `apps/server/src/agents/group-turn-card.test.ts`, which T-1761 created.

### Allowed files
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/room-limits.ts`
- `apps/server/src/actions/queries.ts`
- `apps/server/src/agents/reply-mention.ts`
- `apps/server/src/agents/handoff.ts`
- `apps/server/src/agents/group-turn-card.test.ts`
- `apps/server/src/agents/gateway-group.test.ts`
- `apps/server/src/agents/gateway-stop.test.ts`
- `work/T-1763-card-follow-ups.md`

If another test asserts the crash reply's `@Name ` prefix, stop and list it in the Report.

### Checks
```bash
cd apps/server && pnpm exec vitest run src/agents/group-turn-card.test.ts src/agents/gateway-group.test.ts src/agents/gateway-stop.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- No group reply path tags the asker.
- An approved `tool.run` with invalid blocks logs an ids-only warning.
- A delegated card turn stores a non-empty summary.
- The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

All five steps of the Spec, only inside the Allowed files.

1. **Crash failure reply untagged** (`agents/gateway/group-turn.ts`): the `trigger.scheduled === undefined` branch now sends just `GROUP_FAILURE_REPLY`; the `mentions` span is gone and the `replyTo` rule is unchanged (still `{}` for a synthetic follow-up, `{ replyTo: { id: trigger.id } }` otherwise). The `name` local that only fed the `@${name} ` prefix was removed. The object literal is a plain ternary now, because oxlint's `no-useless-spread` rejected the previous single-spread object after the mentions key was dropped.
2. **Approval path logger** (`actions/queries.ts`): `adapter.execute(...)` now receives `logger: deps.logger` in its context. `deps.logger` is `ActionGatewayLogger`, which extends `ActionContextLogger`, so it fits the field with no wrapper; typecheck confirms.
3. **Delegated card-turn summary** (`agents/gateway/group-turn-body.ts`): a `replied` turn with empty text now stores `resultSummary: 'Posted a card in the room.'`. The file is exactly 400 lines.
4. **Stale comments + dead field**: rewrote the T-1625 header comment in `reply-mention.ts`, the offset sentence in `handoff.ts`, and the delegated-summary comment in `group-turn-body.ts`. Removed the unused `askerName` field from `RateNoticeInput` in `room-limits.ts` and its single caller in `group-turn.ts`.
5. **Test** (`agents/group-turn-card.test.ts`): added a case that wires `executeTool` to the real `createRequestActionRunner` with a fake `ActionGateway` returning `{ status: 'executed', summary: 'posted a card', posted: true }`. The advertised tool is `buildRequestActionTool([...])`, the model asks for `request_action` with a valid action name (`market.prices`, matching `ACTION_NAME_PATTERN`), and the test asserts the gateway was asked once, the turn outcome is `{ kind: 'replied', text: '' }`, and no room reply was sent.

Changed files: `agents/gateway/group-turn.ts`, `agents/gateway/group-turn-body.ts`, `agents/gateway/room-limits.ts`, `actions/queries.ts`, `agents/reply-mention.ts`, `agents/handoff.ts`, `agents/group-turn-card.test.ts`, `work/T-1763-card-follow-ups.md`.

### Checks run

- `cd apps/server && pnpm exec vitest run src/agents/group-turn-card.test.ts src/agents/gateway-group.test.ts src/agents/gateway-stop.test.ts --reporter=dot` → **3 files passed, 34 tests passed** (ran again after the final lint fix).
- `pnpm gate` (repo root) → **GATE PASS**. Summary lines:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.7s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (9.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first gate run failed on `lint` (`unicorn(no-useless-spread)` at `group-turn.ts:345`); that was fixed (see step 1) and the re-run passed.
- No test asserts the crash reply's `@Name ` prefix: `gateway-group.test.ts:401-402` only uses `toContain(GROUP_FAILURE_REPLY)`, so nothing had to be reported for that Spec rule.

### Notes for the lead

- The Spec says "Update the four stale comments" but lists three locations; I updated all three. Two more spots still describe the old `@<asker>`/`@Name` wiring and are **outside this task's Allowed files**, so I left them untouched: `agents/tool-rounds.ts:23` ("groups wire `@Name` + `replyTo`") and `agents/group-turn-deps.ts:27,54` (the `senderName`/`@Name` prefix field docs). Flagging in case they should ride along in another task.
- Minor interpretation: step 3 uses `turnOutcome.text.trim() === ''`, so a whitespace-only reply also stores the fixed summary, not just the exact `''` the card branch returns. Say the word if you want strict `=== ''`.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `1d456ec98`.
- The crash reply sends bare `GROUP_FAILURE_REPLY` with no mention span, and its `replyTo` rule is unchanged.
- The approval-path `adapter.execute` now gets `logger: deps.logger`.
- A delegated card turn stores "Posted a card in the room.". The `trim()` is accepted: whitespace-only text is no summary either.
- `askerName` is removed from `room-limits.ts` and its caller, and the three stale comments are updated.
- The new end-to-end test covers `posted` → `postedToRoom` → no echo.
- I ran group-turn-card, gateway-group and gateway-stop: 34 passed.
- **Follow-up (comments only):** `agents/tool-rounds.ts:23` and `agents/group-turn-deps.ts:27,54` still describe `@Name`. They ride along with the next task that touches those files.
