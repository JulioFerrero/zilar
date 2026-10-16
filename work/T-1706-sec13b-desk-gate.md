---
id: T-1706
title: "SEC-13b (Julio chose (a), 2026-10-16): a room turn offers the AI's computer (desk tools) only when the trigger is the AI's owner, a room owner or admin, or a scheduled routine — a plain member's or another AI's mention no longer runs commands on the owner's computer; the desk isn't even resolved for those turns"
status: merged
milestone: M5
branch: task/T-1706-sec13b-desk-gate
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1706: Only the owner or an admin can make an AI use its computer

## Spec (written by Claude, do not edit)

### Why
Finding SEC-13b (`docs/audit/findings-sweep-server.md`): any group member can run the owner's AI computer. A room turn resolves the desk from the AI's settings alone and offers the desk tools whoever triggered it, while actions are already limited to owners and admins. Julio chose option (a) on 2026-10-16: the computer is used only when the AI's owner, or a room owner or admin, triggers the turn. A scheduled routine counts too, because its creator was checked when the routine was approved (T-1646/T-1655), the same rule actions use.

### Facts (the lead read them on 2026-10-16)
- **`apps/server/src/agents/gateway/group-turn-access.ts`** (92 lines):
  - `GroupTurnAccessInput { trigger; gate; actionsList; canDelegate; handoffTargets }` (`:11-17`);
  - `GroupTurnAccess { scheduledTrigger; triggerBare; allowedForAction; allowActions; askPeople; delegateTargets }` (`:19-26`);
  - `groupTurnAccess(input)` (`:28-66`) computes:
    - `scheduledTrigger = trigger.scheduled !== undefined`;
    - `triggerBare = normBareJid(trigger.fromJid)`;
    - `triggerRole = gate.memberRolesByJid.get(triggerBare)`;
    - `allowedForAction = scheduledTrigger || triggerRole === 'owner' || triggerRole === 'admin'`.
- **`apps/server/src/agents/gateway/group-turn-body.ts`** (350 lines):
  - `:196-198`: `const { scheduledTrigger, triggerBare, allowActions, askPeople, delegateTargets } = groupTurnAccess({ trigger, gate, actionsList, canDelegate, handoffTargets });`;
  - `:200`: `const turnDesk = yield* Effect.promise(() => resolveTurnDesk(deps, ai));`;
  - `:201`: `const deskEnabled = turnDesk.client !== undefined;`;
  - `deskEnabled` drives `buildGroupTools(…, { desk: deskEnabled, … })` (`:202-207`), the executor's desk (`:258-259`) and `turnLimits(…, deskEnabled)` (`:266`);
  - `turnDesk.waiting` posts "waiting for your computer" (`:222-226`).
- **`apps/server/src/agents/gateway/desk-exec.ts`:**
  - `export interface TurnDesk { readonly client?: DeskClient; readonly waiting: boolean }` (`:156-159`);
  - `resolveTurnDesk(deps, input)` (`:163-189`) uses `input.owner` (the AI's owner user id).
- **The owner's bare JID** is derived the way `apps/server/src/agents/gateway/db.ts:367` does it: `normBareJid(jidFor(localpartFor(userId), domain))` (`jidFor` and `localpartFor` from `../../xmpp/provisioning`). The domain in the body is `deps.xmpp.domain` (used at `group-turn-body.ts`'s `makeIsStillAllowed(deps.db, deps.xmpp.domain, …)` call).
- **There's no `group-turn-access.test.ts`.** The `groupTurnAccess` function is pure.

### Steps
1. **`group-turn-access.ts`:**
   - add `aiOwnerBare: string` to `GroupTurnAccessInput` and `allowDesk: boolean` to `GroupTurnAccess`;
   - compute `allowDesk = allowedForAction || triggerBare === input.aiOwnerBare` (so scheduled, room owner, room admin and the AI's own owner);
   - add a short comment naming SEC-13b and Julio's choice (a).
2. **`group-turn-body.ts`:**
   - pass `aiOwnerBare: normBareJid(jidFor(localpartFor(ai.owner), deps.xmpp.domain))`;
   - read `allowDesk`;
   - resolve the desk only when allowed: `const turnDesk: TurnDesk = allowDesk ? yield* Effect.promise(() => resolveTurnDesk(deps, ai)) : { waiting: false };`, so a plain member's turn neither wakes the runner nor posts "waiting for your computer";
   - leave everything after `deskEnabled` unchanged;
   - keep the file under 400 lines.
3. **New `apps/server/src/agents/gateway/group-turn-access.test.ts`** (this is a permission rule, so it gets a test). Call `groupTurnAccess` with a hand-built `gate` (`memberRolesByJid`) and check `allowDesk`:
   - a plain member → `false`;
   - a room owner → `true`;
   - a room admin → `true`;
   - the AI's owner who is a plain member of the room → `true`;
   - a scheduled trigger → `true`;
   - another AI's JID (a handoff) → `false`.

   Build only the fields the function reads; look at the `RoomPendingMessage` and `RoomGateState` types for the rest, and use the smallest valid values.

### Allowed files
- `apps/server/src/agents/gateway/group-turn-access.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/group-turn-access.test.ts`
- `work/T-1706-sec13b-desk-gate.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway/group-turn-access.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A plain member's mention** gets no desk tools, and the desk isn't resolved.
- **The AI's owner, a room owner or admin, and a scheduled routine** keep the computer as today.
- **The new test passes.**

---

## Report (written by the worker when done)

### What I did

- `group-turn-access.ts`: added `aiOwnerBare: string` to `GroupTurnAccessInput` and
  `allowDesk: boolean` to `GroupTurnAccess`; `allowDesk = allowedForAction ||
  triggerBare === aiOwnerBare`, with a comment naming SEC-13b and Julio's choice (a).
- `group-turn-body.ts`: pass `aiOwnerBare: normBareJid(jidFor(localpartFor(ai.owner),
  deps.xmpp.domain))`, read `allowDesk`, and resolve the desk only when allowed
  (`const turnDesk: TurnDesk = allowDesk ? yield* Effect.promise(() => resolveTurnDesk(deps, ai))
  : { waiting: false }`). Everything after `deskEnabled` is unchanged.
- Added `group-turn-access.test.ts` with the six cases from the spec. File is 60 lines.
- Changed files: `apps/server/src/agents/gateway/group-turn-access.ts`,
  `apps/server/src/agents/gateway/group-turn-body.ts`,
  `apps/server/src/agents/gateway/group-turn-access.test.ts`,
  `work/T-1706-sec13b-desk-gate.md`.

### Checks run

- `pnpm --filter @zilar/server exec vitest run src/agents/gateway/group-turn-access.test.ts --reporter=dot`
  → 1 file passed, 6 tests passed.
- `pnpm gate` (repo root) summary:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.2s)
  PASS  lint  (1.3s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/server  (8.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- First `pnpm gate` run failed only on `format` for `group-turn-body.ts`; I ran
  `pnpm exec prettier --write` on that one file (import collapsed to one line) and re-ran
  the gate, which passed. No checks were disabled.
- `allowDesk` is a strict superset of `allowedForAction`: scheduled/owner/admin already
  qualify, so the new branch only adds the AI's owner when they are a plain member. This
  matches the spec's `allowedForAction || triggerBare === aiOwnerBare`.
- Test note: the "another AI's handoff" case uses a JID absent from `memberRolesByJid`
  with `handoff: true`, which is how a handoff turn actually reaches this function; the
  scheduled case uses a synthetic trigger with a `scheduled` block.
- No deviations from the spec; nothing blocked.

## Review (written by Claude)

**Approved and merged.** SEC-13b is closed with Julio's choice (a).

- **Pre-review:** clean, 0 nits.
- **The change:**
  - `groupTurnAccess` returns `allowDesk`, which is `allowedForAction` (a scheduled trigger, or a room owner or admin) or the AI's owner;
  - the body resolves the desk only when `allowDesk` is true, so a plain member's mention neither gets the desk tools nor wakes the runner.
- **The tests:** the lead ran `group-turn-access.test.ts` in the worktree, and its 6 cases passed (member, owner, admin, AI owner, scheduled, handoff).
- **Size:** `group-turn-body.ts` is 362 lines.
