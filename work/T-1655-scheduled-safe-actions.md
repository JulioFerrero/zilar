---
id: T-1655
title: "Scheduled runs may use the no-approval actions: a scheduled turn offers request_action again but marks every request unattended; the action gateway runs tier 0/1 (web.price, web.fetch, tool.run…) and refuses a tier-2 action that has no standing rule with a new reason needs_approval, so nothing parks a card nobody will see"
status: merged
milestone: M5
branch: task/T-1655-scheduled-safe-actions
model: auto
effort: default
depends_on: []
estimate: 50 min
---

# T-1655: Safe actions in scheduled runs

## Spec (written by Claude, do not edit)

### Why
A scheduled routine (T-1638..T-1648) runs as a normal turn. To park no approval card in an unattended run, T-1646 and T-1647 turned `request_action` off for scheduled turns.
- **The cost:** an AI **without a computer** can't use `web.price` (tier 0), `web.fetch` (tier 1) and the other keyless actions, so a scheduled "post the BTC, gold and S&P 500 prices" fails for it.
- **The better rule:** keep `request_action` and mark the request **unattended**. Tier 0/1 run as usual. A tier-2 action without a matching standing "always allow" rule is refused with a clear reason instead of parking a card.

### Facts (the lead read them on 2026-10-16, main after T-1647)
- **`apps/server/src/actions/policy.ts`** (55 lines): `PolicyDenialReason = 'unknown_action' | 'invalid_args' | 'ai_not_active' | 'ai_not_in_group'` (`:6-7`). Tier 0/1 → allow, 2 → `require_approval` (`:50-54`).
- **`apps/server/src/actions/gateway.ts`** (113 lines): `RequestParams { aiId; groupId?; topicId?; action; args; requestedBy }` (`:66-77`), and `DeniedReason = PolicyDenialReason` (`:81`).
- **`apps/server/src/actions/decisions.ts`** (229 lines), `runRequest`:
  - deny → `{ status: 'denied', reason }` (`:54-56`);
  - allow → `runAllowedAction` (`:58-60`);
  - the tier-2 standing-rule auto-approve (`:62-79`);
  - then the approval card path.
- **`apps/server/src/agents/gateway/contracts.ts`:** `denialReasonForModel(reason)` (about `:350-361`), a switch over the four reasons.
- **`apps/server/src/agents/gateway/request-action.ts`** (96 lines): `runRequestActionEffect(session, call, chat?)` (`:31-34`) calls `actions.request({ aiId, …chat, action, args, requestedBy })`.
- **`apps/server/src/agents/gateway/tool-exec.ts`** (256 lines):
  - `executeToolCall(session, chatKey, context?, desk?)` (`:91-96`);
  - the `REQUEST_ACTION_TOOL` branch (`:211-235`): `context.isStillAllowed()` when there is a context, then `runRequestActionEffect(session, call, context ? { groupId, topicId } : undefined)`.
- **`apps/server/src/agents/gateway/dm-turn-input.ts`:** `executeToolCall(session, chatKey, undefined, desk…)` (about `:74-81`), and `tools: buildTools(scheduled === true ? [] : (deps.actions?.listActions() ?? []), { desk })` (T-1647).
- **`apps/server/src/agents/gateway/dm-turn.ts`:** `dmActionsList = trigger.scheduled === undefined ? (…listActions() ?? []) : []` (T-1647), which decides the tool guide.
- **`apps/server/src/agents/gateway/group-turn-body.ts`** (386 lines):
  - `allowedForAction = !scheduledTrigger && (role owner/admin)` (T-1646);
  - `isStillAllowed` re-reads the trigger's role (`:236-248`);
  - the `executeToolCall(...)` context includes `allowActions` (about `:286-298`).

### Steps
1. **`policy.ts`:** add `'needs_approval'` to `PolicyDenialReason`. The policy itself never returns it; only the gateway does, for unattended requests.
2. **`gateway.ts`:** add `unattended?: boolean` to `RequestParams`, with a doc comment: a scheduled run, where no person is watching.
3. **`decisions.ts`, `runRequest`:** after the standing-rule block and **before** the approval-card path, `if (params.unattended === true) { return { status: 'denied', reason: 'needs_approval' }; }`, with a comment. Tier 0/1 and standing-rule auto-approvals are unchanged.
4. **`contracts.ts`, `denialReasonForModel`:** `'needs_approval'` → `'this action needs a person to approve it, which a scheduled run cannot ask for; do the job another way or say in your answer what needs approval'`.
5. **`request-action.ts`:** `runRequestActionEffect` (and the Promise wrapper) take an optional `unattended?: boolean` and pass it to `actions.request` when true.
6. **`tool-exec.ts`:**
   - `executeToolCall` takes a 5th optional parameter, `options?: { unattended?: boolean }`;
   - the `REQUEST_ACTION_TOOL` branch passes `options?.unattended` through;
   - when unattended, skip `isStillAllowed`: there is no live person whose role could change mid-turn, and the routine's creator was checked when it was approved.
7. **DM:**
   - `dm-turn-input.ts` builds the tools with the full `listActions()` again, and passes `{ unattended: scheduled === true }` to `executeToolCall`;
   - `dm-turn.ts`'s `dmActionsList` is the full list again (so a scheduled run gets the tool guide too).
8. **Group (`group-turn-body.ts`):**
   - for a scheduled trigger, `allowedForAction` is `true` (the routine was approved by its owner or a topic admin);
   - pass `{ unattended: scheduledTrigger }` as the 5th `executeToolCall` argument;
   - `askPeople` and delegation stay off for scheduled runs.

   Keep the file within 400 lines. If it gets tight, shorten comments, not logic.
9. **Tests** (permissions area): a new `apps/server/src/actions/unattended.test.ts` using `createActionGateway` with two test adapters, one tier 0 and one tier 2 without `allowAlways`. Cover:
   - unattended tier 0 → `executed`;
   - unattended tier 2 → `denied` / `needs_approval`, with no approval row and no announce;
   - attended tier 2 → `pending_approval` as before.

   Follow the setup of the nearest existing gateway or approvals test, e.g. `apps/server/src/approvals/*.test.ts`.

### Allowed files
- `apps/server/src/actions/policy.ts`
- `apps/server/src/actions/gateway.ts`
- `apps/server/src/actions/decisions.ts`
- `apps/server/src/actions/unattended.test.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/agents/gateway/request-action.ts`
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/agents/gateway/dm-turn-input.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/group-turn.ts` (added by the lead: the `GroupTurnContext.executeToolCall` type gains the 5th parameter)
- `apps/server/src/agents/gateway-group.test.ts` (added by the lead: the T-1646 test now expects `request_action` offered and `ask_people` still off for a scheduled trigger)
- `work/T-1655-scheduled-safe-actions.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/actions/unattended.test.ts src/actions/args-example.test.ts src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A scheduled run can use tier-0/1 actions.**
- **A tier-2 action in a scheduled run is refused with `needs_approval`, and no card appears.**
- **Normal turns are unchanged.**
- **Every file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

Implemented all nine steps of the spec. The lead approved adding the two files
that the change also needs (`gateway/group-turn.ts` for the type and
`gateway-group.test.ts` for the reversed T-1646 assertion) to Allowed files, so
both edits are now in scope and the task is complete.

- **`apps/server/src/actions/policy.ts`** — added `'needs_approval'` to
  `PolicyDenialReason` (with a comment: the policy never returns it).
- **`apps/server/src/actions/gateway.ts`** — added `unattended?: boolean` to
  `RequestParams`, documented.
- **`apps/server/src/actions/decisions.ts`** — in `runRequest`, after the
  standing-rule block and before `runApprovalPath`:
  `if (params.unattended === true) return { status: 'denied', reason: 'needs_approval' };`.
  Tier 0/1 and standing-rule auto-approvals return earlier and are unchanged.
- **`apps/server/src/agents/gateway/contracts.ts`** — `denialReasonForModel`
  gained the `needs_approval` case with the fixed sentence from the spec.
- **`apps/server/src/agents/gateway/request-action.ts`** — `runRequestActionEffect`
  and the `runRequestAction` Promise wrapper take an optional `unattended` and
  pass `{ unattended: true }` to `actions.request` when set.
- **`apps/server/src/agents/gateway/tool-exec.ts`** — `executeToolCall` takes a
  5th optional `options?: { unattended?: boolean }`; the `REQUEST_ACTION_TOOL`
  branch passes `options?.unattended` through and skips `isStillAllowed` when
  unattended (no live person whose role could change).
- **`apps/server/src/agents/gateway/dm-turn-input.ts`** — tools are built from
  the full `listActions()` again; `executeToolCall` is called with
  `{ unattended: scheduled === true }`.
- **`apps/server/src/agents/gateway/dm-turn.ts`** — `dmActionsList` is the full
  `listActions()` again (so a scheduled run gets the tool guide); updated the
  `DmTurnContext.executeToolCall` type with the 5th parameter (comment also
  refreshed).
- **`apps/server/src/agents/gateway/group-turn-body.ts`** — `allowedForAction`
  is `true` for a scheduled trigger; `executeToolCall` is called with
  `{ unattended: scheduledTrigger }`; `askPeople` and delegation stay off for
  scheduled runs. File is 392 lines, within the 400 cap.
- **`apps/server/src/agents/gateway/group-turn.ts`** — the one-line type change
  (approved by the lead): `GroupTurnContext.executeToolCall` gained the 5th
  `options?: { unattended?: boolean }` parameter so `group-turn-body.ts` can
  pass it.
- **`apps/server/src/agents/gateway-group.test.ts`** — the T-1646 scheduled test
  renamed to `offers request_action (unattended) and still no ask_people for a
  scheduled trigger`, and its assertion flipped to `toContain('request_action')`
  (`ask_people` stays `not.toContain`).
- **`apps/server/src/actions/unattended.test.ts`** (new) — `createActionGateway`
  over two test adapters (`demo.low` tier 0, `demo.high` tier 2 without
  `allowAlways`), following the setup of `approvals/rules.test.ts`:
  - unattended tier 0 → `executed`;
  - unattended tier 2 → `denied` / `needs_approval`, no approval row, no announce;
  - attended tier 2 → `pending_approval`, one approval row.

### Checks run

The spec's Checks (exact commands, from `apps/server`):

`pnpm --filter @zilar/server exec vitest run src/actions/unattended.test.ts src/actions/args-example.test.ts src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts --reporter=dot`

Result: **4 test files passed, 48 passed (0 failed).**

`pnpm gate` (repo root, final run):

```
gate: 13 changed file(s) against main
PASS  install (frozen)  (2.1s)
PASS  format  (1.1s)
PASS  lint  (1.3s)
PASS  typecheck  (4.9s)
PASS  effect  (1.5s)
PASS  tests @zilar/server  (13.2s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Blocked / needs a decision

None. (Earlier I stopped because `group-turn.ts` and `gateway-group.test.ts`
were outside Allowed files; the lead added both and I finished the work.)

### Notes for the lead

- New `unattended.test.ts` passes 3/3; `args-example`, `gateway-stop` and the
  updated `gateway-group` tests all pass. Total 48 passed.
- `gateway-group.test.ts`: the renamed T-1646 test now asserts a scheduled
  trigger offers `request_action` and still no `ask_people`. The tool list only
  proves the tool is offered; the "unattended" marking happens in `tool-exec.ts`
  at execution time and is covered end-to-end by `unattended.test.ts`.
- Largest touched file is `group-turn-body.ts` at 392 lines (cap 400).
- No new dependencies, no migrations, no secrets touched.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 1 nit. A stale comment above `denialReasonForModel` still lists four reasons; that's cosmetic.
- **The change:**
  - scheduled DM and room turns offer `request_action` again, with every call marked unattended;
  - in `runRequest`, tier 0/1 and standing-rule auto-approvals run as before, and anything else that would park a card is refused with `needs_approval`, plus a plain model line;
  - the role re-check is skipped for unattended calls; `ask_people` and delegation stay off.
- **The tests:** the lead ran `unattended`, `args-example`, `gateway-stop`, `gateway-group` and `approvals/*`: 133 passed.
- **Size note:** `group-turn-body.ts` is now 391 lines. The next change to it must split it first.
- **Effect:** an AI without a computer can now run "post the prices" on a schedule with `web.price`.


