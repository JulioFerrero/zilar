---
id: T-1727
title: "Julio's phone test 10-16: any room member can ask an AI for tools and routines (approvals still go to owners; the computer stays owner/admin), no work card for memory-only turns, no duplicate title/step line on the card, and no stale facts from memory presented as current"
status: merged
milestone: M5
branch: task/T-1727-members-ask-card-reply
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1727: Members can ask; a cleaner card and replies

## Spec (written by Claude, do not edit)

### Why
Julio tested on his phone on 2026-10-16. As **JULITO**, a plain member of "ai test" (Julio's other account is the owner), he asked @Deepseek for a BTC, gold and S&P 500 message plus a routine every 5 minutes. What he got:
- a work card reading "✓ Working on it 0:03" with a second line "Working on it";
- a reply with prices recalled from memory ("as of 00:37 UTC, Yahoo Finance + Swissquote"), followed by "I have no scheduler tool enabled in this chat".

The turn's steps on prod (`agent_task_events`) show only two `recall` calls: `request_action` wasn't offered, because only owners and admins get it.

**Julio's decision:** "Members can ask". Any member may make the AI use tools and set routines. Anything that needs approval still goes to the AI's owner or the room's owners or admins: `apps/server/src/approvals/access.ts` `canDecide` already allows only them, so a member can't approve their own request. The AI's computer stays owner, admin or AI owner only (SEC-13b, T-1706).

### Facts (the lead read them on 2026-10-16)
- **The access rule:** `apps/server/src/agents/gateway/group-turn-access.ts:46-53`:
  - `allowedForAction = scheduledTrigger || triggerRole === 'owner' || triggerRole === 'admin'`;
  - `allowActions = allowedForAction && actionsList.length > 0`;
  - `allowDesk = allowedForAction || triggerBare === aiOwnerBare`.
- **Who is a member:** `triggerRole` comes from `gate.memberRolesByJid`, which holds **human** members only (`group_members`, `apps/server/src/agents/gateway/db.ts:361-371`); an AI sender has no role. A handoff trigger has `trigger.handoff === true`. The tests are in `apps/server/src/agents/gateway/group-turn-access.test.ts` (SEC-13b cases).
- **Progress:** `apps/server/src/agents/tool-exec.ts:134-150` reports the stage of the **first** call of each round (`stageForToolCall`), whatever the tool is.
  - `apps/server/src/agents/tool-guide.ts` has no labels for the memory and persona tools, so they get `TOOL_STAGE_FALLBACK = 'Working on it'` (`:61`).
  - Those tools are `recall`, `remember`, `memory_zoom`, `update_persona` and `revert_persona` (`apps/server/src/agents/tools/schemas.ts:4-9`).
- **The card:** `apps/server/src/agents/task-card.ts`:
  - `startTaskCard(stage)` sets the title to the first stage (`:37-46`);
  - `addTaskCardStep` then adds the same label as step 1 (`:51-62`), so title and first step always repeat;
  - its tests are in `apps/server/src/agents/task-card.test.ts`.
- **The prompts:** the platform lines are in `apps/server/src/agents/context.ts:66` (DM) and `:128` (room).

### Steps
1. **Members can ask** (`group-turn-access.ts`):
   - `allowedForAction = scheduledTrigger || (triggerRole !== undefined && trigger.handoff !== true)`. Any human member who can see the topic qualifies; AIs and handoffs don't;
   - `allowDesk = scheduledTrigger || triggerRole === 'owner' || triggerRole === 'admin' || triggerBare === aiOwnerBare` (SEC-13b unchanged);
   - update the comments (T-0098 → T-1727, Julio 2026-10-16 "Members can ask").
   - **Tests** in `group-turn-access.test.ts`:
     - a member gets `allowActions` true and `allowDesk` false;
     - an unknown sender (no role) gets both false;
     - a handoff trigger from a member gets `allowActions` false;
     - the SEC-13b cases still pass.
2. **No card for memory-only rounds** (`tool-exec.ts`): report progress for the **first call that isn't** one of the five memory or persona tools. If every call in the round is one of them, report nothing, so a memory-only turn opens no card. Export the set from `tool-guide.ts` as `QUIET_TOOLS`.
3. **No repeated line** (`task-card.ts`): in `addTaskCardStep`, when the card has no steps yet and `label === card.title`, return the card with `stage` updated and **no** new step. Later different labels still add steps. Update `task-card.test.ts`: one case for the skip, and one where a second, different label adds step 1.
4. **Prompts** (`context.ts:66` and `:128`): add one sentence to both platform lines: "Never present prices, times or other live facts from memory as current: fetch them fresh, or say you can't. If you can't do something, say so in one short sentence, without mentioning tools, hosts or approvals." Keep `context.ts` under 400 lines.

### Allowed files
- `apps/server/src/agents/gateway/group-turn-access.ts`
- `apps/server/src/agents/gateway/group-turn-access.test.ts`
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/agents/gateway-stop.test.ts`
- `apps/server/src/agents/tool-exec.ts`
- `apps/server/src/agents/tool-guide.ts`
- `apps/server/src/agents/task-card.ts`
- `apps/server/src/agents/task-card.test.ts`
- `apps/server/src/agents/context.ts`
- `work/T-1727-members-ask-card-reply.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway/group-turn-access.test.ts src/agents/task-card.test.ts src/actions/args-example.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A plain member** triggers turns with `request_action`, but never the computer.
- **A memory-only turn** opens no work card.
- **A card's first step** no longer repeats its title.
- **Both prompts** carry the live-facts sentence.
- **The tests and the gate pass.**

---

## Report (written by the worker when done)

### What I did

Implemented all four spec steps.

1. **Members can ask** (`apps/server/src/agents/gateway/group-turn-access.ts`): `allowedForAction` is now `scheduledTrigger || (triggerRole !== undefined && trigger.handoff !== true)` — any human member who can see the topic qualifies; an AI sender or unknown occupant has no role, and an AI handoff is excluded. `allowDesk` is written out explicitly (`scheduledTrigger || triggerRole === 'owner' || triggerRole === 'admin' || triggerBare === aiOwnerBare`) so SEC-13b is unchanged. Comments updated (T-0098 → T-1727).
2. **No card for memory-only rounds** (`apps/server/src/agents/tool-guide.ts`, `apps/server/src/agents/tool-exec.ts`): added `QUIET_TOOLS` to `tool-guide.ts` (recall, remember, memory_zoom, update_persona, revert_persona). `runLoopRound` now reports the first call that is not in `QUIET_TOOLS` and reports nothing when every call is, so a memory-only turn opens no card.
3. **No repeated line** (`apps/server/src/agents/task-card.ts`): `addTaskCardStep` returns the card with `stage` updated and no new step when it has no steps and the label equals the title; a later, different label still opens step 1.
4. **Prompts** (`apps/server/src/agents/context.ts`): added the live-facts / one-sentence sentence to both the DM and the group platform lines. The file is 296 lines (under the 400 cap).

Tests added: `group-turn-access.test.ts` (a plain member gets `allowActions` true and `allowDesk` false; owner and admin still allowed; unknown sender both false; a member's handoff `allowActions` false; the SEC-13b `allowDesk` cases unchanged) and `task-card.test.ts` (title-repeat skip; a later, different label opens step 1).

**Necessary extra change (lead confirmed in review).** In the same `group-turn-access.ts` I also updated `makeIsStillAllowed`. It required the sender to still be a room owner/admin, so a plain member's `request_action` would have been offered and then denied at execution with `denied: not allowed` — the feature could not work end to end. It now requires only that the sender is still a member of this topic (`fresh.memberJids.has(triggerBare)`), the fresh-state form of the new rule. The lead confirmed this (it guards only `request_action`; `allowDesk` still decides the computer at turn start).

### Follow-up (lead review round)

- **`makeIsStillAllowed` confirmed**, and the comment above the check in `apps/server/src/agents/gateway/tool-exec.ts:215-219` updated to say the sender is `no longer a member of this topic (T-1727)` (comment only).
- **`apps/server/src/agents/gateway-stop.test.ts`** now drives its two tool rounds with non-quiet desk tools (`bash`, then `read`) instead of `recall`, so the card opens and keeps an in-progress step; its assertions are unchanged. Two different stages are needed because of spec step 3: the first report only sets the title, and the first step is skipped when its label repeats the title.
- **Allowed files** extended with `apps/server/src/agents/gateway-stop.test.ts` and `apps/server/src/agents/gateway/tool-exec.ts` (lead approved).

### Checks run

- First focused run: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/group-turn-access.test.ts src/agents/task-card.test.ts src/actions/args-example.test.ts` → `Test Files 3 passed (3)`, `Tests 40 passed (40)`.
- Final focused run (lead's command, with the AGENTS `--maxWorkers=2` cap): `pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/agents/gateway-stop.test.ts src/agents/gateway/group-turn-access.test.ts src/agents/task-card.test.ts` → `Test Files 3 passed (3)`, `Tests 32 passed (32)`.
- `pnpm gate` → `gate: 10 changed file(s) against main`; `PASS install (frozen) (1.0s)`; `PASS format (1.1s)`; `PASS lint (0.8s)`; `PASS typecheck (0.8s)`; `PASS effect (0.4s)`; `PASS tests @zilar/server (15.4s)`; `scope: every changed file is inside the Allowed files`; `migration: every added migration continues from the base`; `size: every changed source file is within 400 lines`; `GATE PASS`. (A first gate run that round was killed by SIGTERM on the shared machine — the tests step exited 143 with no test output; the immediate re-run passed clean.)

### Notes for the lead

- All four spec steps and the review items are done; `pnpm gate` ends with `GATE PASS` and lists no files outside the Allowed files.
- The spec's prompt check command runs `exec vitest run` without a worker cap; I ran the same set with the AGENTS-required `--maxWorkers=2` cap instead.

## Review (written by Claude)

**Approved and merged.** Julio chose "Members can ask" on 2026-10-16, after his phone test as JULITO.

- **Pre-review:** clean, 1 nit and 3 follow-ups, all accepted:
  - stale T-0098 comments in `agents/gateway/db.ts:314-316`, `agents/group-turn.ts:60-61` and `agents/tools/definitions.ts:286`;
  - they're comment-only, for a later small task.
- **The lead approved the worker's two extra changes:**
  - `makeIsStillAllowed` now requires topic membership, otherwise a member's `request_action` would be denied at run time. It guards only `request_action`;
  - `gateway-stop.test.ts` drives the stop path with `bash`/`read`, because `recall` rounds are now quiet.
- **The computer:** `allowDesk` stays scheduled, owner, admin or AI owner (SEC-13b).
- **The tests:** the lead ran `group-turn-access`, `task-card`, `gateway-stop` and the `args-example` boot guard in the worktree: 4 files, 50 tests passed.
