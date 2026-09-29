---
id: T-0098
title: `request_action` in group chats — only admins can trigger it, the card is visible to the whole room (server)
status: todo
milestone: M4
branch: task/T-0098-group-request-action
model: minimax-coding-plan/MiniMax-M3
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
pnpm exec turbo test --force --filter=@galena/server
pnpm build
```

### Out of scope
- "Always allow" rules (T-0099), web/mobile changes, group tools other than `request_action`.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**
