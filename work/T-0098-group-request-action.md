---
id: T-0098
title: `request_action` in group chats — only admins can trigger it, the card is visible to the whole room (server)
status: merged
milestone: M4
branch: task/T-0098-group-request-action
model: meta/muse-spark-1.3-contributor
depends_on: [T-0090, T-0092, T-0093]
estimate: 1 day
---

# T-0098: AIs can ask for actions in groups

## Spec (written by Claude, do not edit)

### Julio's decision (2026-09-29)
"Groups: only admins, but it needs to show up to everyone." So:
- In a group, an AI may **request an action only when the message that woke it was sent by a group owner or admin** of that group. For a plain member, the AI is not offered the tool at all, so nothing can be requested.
- The approval **card is posted in the room**, visible to every member (T-0092 already posts to the room for a group request). Only group owners/admins (and the AI's owner, already true in `canDecide`) get the buttons; everyone else sees the card as "Waiting for a decision" (already how the web card behaves).

### Goal

Today only the owner's DM turn runs a tool loop (`runDmTurn`); group turns use a plain call (`runGroupTurn` → `completeChat`, no tools). Give group turns the same tool loop, but **only the `request_action` tool, and only when the sender is a group owner/admin**. Persona tools stay DM-only (only the AI's owner may reshape it, in the DM).

### Design (decided; follow it)
- **Who may trigger:** compute at turn time, in `agents/gateway.ts`, whether the trigger's sender is `owner` or `admin` of *this* group (`group_members.role`, looked up by the user behind the sender's JID; a sender who is an AI, unknown, or a plain `member` → not allowed). Do this lookup **per turn, from the database**, never from anything in the message text or the model output.
- **Tools offered in a group turn:** `buildTools`-style: when the sender is allowed **and** `deps.actions` has at least one action, offer only the `request_action` tool (build it from the same helper as the DM one; do **not** include the persona tools). Otherwise no tools, exactly today's behaviour and the plain `completeChat` path (keep the existing group tests passing untouched).
- **Tool loop:** reuse the DM tool loop (`runToolTurn` and the tool-call parsing/validation in `reply.ts`) instead of copying it. Extract what you need so both turns share it, without changing DM behaviour (all DM tests must pass unchanged). `runGroupTurn` gets optional `tools` and `executeTool`; the reply is still `@Name text` pointing at the trigger, and a model failure still posts the honest failure text.
- **Executor for groups:** like the DM executor: liveness check first, then `actions.request({ aiId: session.aiId, groupId: <the room's group id from the session's room subscription, never from the model>, action, args, requestedBy: <AI's bare JID> })`, with the same fixed model-facing outcome strings as the DM (`done: …`, `waiting for an admin's approval; a card was posted in this room`, `the action failed`, `denied: <reason>`). Adjust the pending wording for groups only.
- The trigger's **sender must be re-checked when the tool is executed** (the role could change during a long turn): if they are no longer owner/admin, answer `denied: not allowed` and do not call the gateway.
- Nothing else changes: budgets, warnings, drafts, kill switch checks stay as they are.
- Audit: the gateway already records `action.requested` with the AI and group. Add the triggering user's id to that entry only if the existing `AuditEntry` shape has a field for it (`actorUserId` is `null` today for AI-initiated entries; setting it to the admin who woke the AI is welcome **if it does not require a schema change**; otherwise skip and say so in the Report).

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §15.1–15.3, §7.3 (roles)
- `work/T-0093-request-action-tool.md` (DM version, Review), `T-0092-...md`
- `apps/server/src/agents/reply.ts` (`runDmTurn`, `runToolTurn`, `runGroupTurn`), `agents/tools.ts`, `agents/gateway.ts` (group turn around `runGroupTurn`, `executeToolCall`/`runRequestAction`, how a session knows its rooms and group ids), `groups/service.ts` and `db/schema.ts` (`groupMembers`), `xmpp/provisioning.ts` (JID ↔ user id helpers)

### Allowed files
- `apps/server/src/agents/reply.ts`, `reply.test.ts`, `tools.ts`, `tools.test.ts`, `gateway.ts`, `gateway.test.ts`
- `work/T-0098-group-request-action.md`

**Not allowed:** schema/migrations, web, mobile, `actions/**` (the gateway already supports `groupId`), config, new dependencies, any HTTP route.

### Tests (Vitest, fakes, no network)
- Group turn with an **admin/owner** sender and an action registered: the model receives only the `request_action` tool (no persona tools); a scripted tool call reaches `actions.request` once with the session's `aiId`, the room's group id, the AI's JID; a model that puts `aiId`/`groupId` inside `args` cannot change the top-level values; each outcome maps to the fixed text; the final reply is posted in the room mentioning the sender.
- **Plain member** sender: no tools are sent, `actions.request` is never called even if the fake model tries a tool call (answered `invalid: unknown tool`); reply works as before.
- Sender who is an AI, unknown, or removed from the group: no tools.
- Role revoked between the turn start and the tool execution: `denied: not allowed`, gateway not called.
- No actions registered: group turn identical to today (existing tests unchanged).
- Stopped AI: nothing is requested or sent.
- DM turns: all existing tests pass unchanged (report the count).

### Live check
Not possible without a real group and Julio's OK; say so. (Steps for Julio go in the live-checks doc: the lead adds them.)

### Acceptance criteria
- [ ] A plain member can never cause an action request; an admin/owner can.
- [ ] Group id and AI id come from the session, never the model.
- [ ] Persona tools are not reachable from groups.
- [ ] DM behaviour unchanged; all existing tests pass.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint passes and is re-run after your last edit.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@zilar/server
pnpm build
```

### Out of scope
- "Always allow" rules (T-0099), web/mobile changes, group tools other than `request_action`.

---

## Report (written by the worker when done)

### What I did
- Group turns now offer the `request_action` tool, but only when the trigger's sender is a group `owner`/`admin` (looked up per turn from `group_members` via JID, never from message text or model output) and at least one action is registered. Plain members, AI senders, unknown/removed senders, and empty registries all take today's plain path with no tools.
- Extracted the DM tool-loop plumbing in `reply.ts` into shared helpers (`executeOneToolCall`, `executeToolCalls`, `followUpMessages`) so DM and group turns run the exact same validation/redaction; DM behaviour unchanged.
- `runGroupTurn` accepts optional `tools` + `executeTool` and runs the shared loop; the reply still goes to the room with `@Name` + `replyTo` on the trigger, and model failures still post the honest failure text.
- The plain (no-tools) group path now also answers an improvised model `tool_call` with `invalid: unknown tool` via one follow-up call instead of ignoring it — the spec requires `actions.request` is never called for plain members even if the fake model tries a tool call. The executor is never invoked on that path. (This fixed 2 failing gateway tests that scripted an improvised call on the plain path and timed out waiting for a second model call that never came.)
- Group executor (`gateway.ts`): liveness check first, then `actions.request` with `aiId` from the session, `groupId` from the room subscription, `requestedBy` = AI's bare JID; smuggled `aiId`/`groupId` inside `args` cannot change the top-level values. Pending wording adjusted for groups (`waiting for an admin's approval; a card was posted in this room`); all other outcomes use the same fixed strings as DM.
- The trigger sender's role is re-checked at execution time: demotion between turn start and tool execution answers `denied: not allowed` without calling the gateway (no audit row, no card).
- `buildGroupTools` in `tools.ts` returns only the `request_action` tool (empty list when no actions registered, so the caller falls back to the plain path). Persona tools are never offered in groups.
- Audit: did NOT set `actorUserId` on the `action.requested` entry. The field exists on `AuditEntry` (no schema change needed), but threading the triggering admin's user id through would require adding a field to `RequestParams` in `apps/server/src/actions/gateway.ts`, which is outside this task's Allowed files.

### Files changed
- `apps/server/src/agents/tools.ts` (+14): `buildGroupTools` helper.
- `apps/server/src/agents/tools.test.ts` (+30): `buildGroupTools` — empty registry, only `request_action` with persona tools excluded, description lists all actions.
- `apps/server/src/agents/reply.ts`: extracted shared `executeOneToolCall`/`executeToolCalls`/`followUpMessages`; `runGroupTurn` gained optional `tools`+`executeTool` with `runGroupToolTurn` + `sendGroupReply`; plain path answers improvised tool calls `invalid: unknown tool` via one follow-up call (executor never invoked).
- `apps/server/src/agents/reply.test.ts` (+228): group tool-loop tests (request_action execution, plain path unchanged, second-call failure → `kind: failed` + failure text) plus plain-path improvised-call test (executor never runs, `invalid: unknown tool` fed back, follow-up reply sent).
- `apps/server/src/agents/gateway.ts` (+110): `memberRolesByJid` in room gate state, per-turn admin/owner check + `buildGroupTools`, group `RequestActionContext` with `isStillAllowed` re-check, group-aware `runRequestAction` wording and `groupId` plumbing.
- `apps/server/src/agents/gateway.test.ts` (+594): 10 end-to-end group tests — admin/owner tool offer (no persona tools), smuggled ids, all outcome wordings, plain-member/AI/removed-sender no-tools, revocation mid-turn, no-actions invalid, stopped AI silence.

### Commands run and real results
- `pnpm install`: up to date (7s).
- `pnpm format:check`: all files use Prettier style (pass).
- `pnpm lint`: pass (fixed one `unicorn/no-useless-spread` in `gateway.test.ts` from prior work; re-ran after last edit — pass).
- `pnpm typecheck`: 10 tasks successful (pass).
- `pnpm exec turbo test --force --filter=@zilar/server`: 55 files passed, 5 skipped; 850 tests passed, 7 skipped (pass, ~7 min).
- `pnpm build`: 2 tasks successful (pass).
- Targeted: `reply.test.ts` + `tools.test.ts`: 70 passed. `gateway.test.ts`: 104 passed. `gateway.test.ts -t "request_action in groups"`: 10 passed.
- Note: during this session `pnpm exec vitest run src/agents/gateway.test.ts` initially showed 2 failures (timeouts in the plain-member and no-actions group tests); root cause was the plain path ignoring improvised `tool_calls` so the scripted second model call never happened. Fixed in `reply.ts` as described above; full suite green afterwards.

### Problems, deviations from the spec, open questions
- Deviation (bug fix on prior work, within spec): the plain group path now makes a follow-up model call when the model improvises a tool call, instead of ignoring it. This matches the spec test bullet (`invalid: unknown tool`, `actions.request` never called) and preserves "No actions registered: identical to today" for well-behaved models (single call, same reply). Existing group tests pass untouched.
- Audit `actorUserId` skipped (see above); needs a decision whether T-0099 or a follow-up should thread the triggering admin id through `actions/gateway.ts` (not allowed here).
- Live check not possible without a real group and Julio's OK (per spec).

### Blocked / needs a decision
- None. Ready for review.

---

## Review (written by Claude)

**Verdict:** approved and merged after one security fix by the lead. Rebased on main; after the last edit format, lint, typecheck clean; server 851 passed, 7 skipped. No disable comments.

**The hole (found by the lead, proven by a failing test first):** in a group turn with `request_action` offered, the executor still handled the persona tools, and the argument parser accepts a tool by name whether or not it was advertised. A model that improvised `update_persona` in a room (for example after reading a hostile message) got `ok` and the AI's persona was rewritten. That broke the acceptance criterion "persona tools are not reachable from groups". Fixed in two layers: the group executor answers `invalid: unknown tool` for anything but `request_action`, and the group tool loop refuses any tool that was not advertised. Regression test added (`a persona tool the model improvises in a group tool turn is never executed`).

Confirmed: only a group owner or admin sender gets the tool (per-turn database lookup, re-checked right before execution), a plain member, an AI or an unknown sender gets no tools and the gateway is never called even if the model tries; group id and AI id come from the session; each outcome maps to a fixed line; a stopped AI sends nothing; DM behaviour is unchanged (all DM tests untouched).

Notes: the plain group path now makes one follow-up call when a model improvises a tool call with none advertised (answered `invalid: unknown tool`); the audit entry does not carry the triggering admin's user id yet (a follow-up: needs a change in `actions/gateway.ts`). Not live-checked (needs a real group and Julio's OK); steps are in the live-checks doc.

Process note: this worker had been moved from MiniMax to Muse mid-task.
