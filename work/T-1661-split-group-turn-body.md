---
id: T-1661
title: "Size split: move the room turn's access rules (who may use request_action, ask_people, delegation, and the isStillAllowed re-check) out of agents/gateway/group-turn-body.ts (394 lines) into a new group-turn-access.ts — a pure move, no logic or wording change"
status: merged
milestone: M5
branch: task/T-1661-split-group-turn-body
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1661: Split the room turn's access rules out of group-turn-body.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/agents/gateway/group-turn-body.ts` is at 394 of the 400 allowed lines after T-1655 and T-1657, so the next change to it can't land. The per-turn access rules are a clean, self-contained block, so they can move out.

### Facts (the lead read them on 2026-10-16, main after T-1659)
- **`apps/server/src/agents/gateway/group-turn-body.ts`** (394 lines):
  - `runGroupTurnBody(input)` (`:80-…`);
  - the access block runs from the comment `// T-0098/T-0444: decide per turn…` (`:195`) to the end of `isStillAllowed` (`:253`);
  - it computes `scheduledTrigger`, `triggerBare`, `triggerRole`, `allowedForAction`, `actionsList`, `allowActions`, `askPeople` and `delegateTargets` (from `roster.canDelegate` and `roster.handoffTargets`, `:177-178`);
  - then `turnDesk`/`deskEnabled`/`groupTools`, which **stay** in the body because they need `yield*`;
  - then `isStillAllowed`, which calls `loadRoomGateState(deps.db, room.groupId, deps.xmpp.domain, room.topicId)`. Its import is at the top, `from './db'`.
- **The folder `apps/server/src/agents/gateway/`** has `group-ingest.ts`, `group-turn-body.ts`, `group-turn-roster.ts` (55 lines, the pattern for a small helper file) and `group-turn.ts`. There's no `group-turn-access.ts`.

### Steps
1. **Create `apps/server/src/agents/gateway/group-turn-access.ts`** with:
   - `export function groupTurnAccess(input: { trigger: RoomPendingMessage; gate: RoomGateState; actionsList: …; canDelegate: boolean; handoffTargets: … })` returning `{ scheduledTrigger, triggerBare, allowedForAction, allowActions, askPeople, delegateTargets }`. Use the types the body uses today; read them from the imports.
   - `export function makeIsStillAllowed(db, domain: string, room: RoomSubscription, triggerBare: string): () => Promise<boolean>`, the same Effect pipeline as today.
   - **Move the comments with the code, word for word.**
2. **In `group-turn-body.ts`:** replace the block with calls to the two functions, keep `turnDesk`, `deskEnabled` and `groupTools` where they are, and drop imports that are no longer used. **No behaviour change.**
3. **No new tests.** The existing room tests cover it.

### Allowed files
- `apps/server/src/agents/gateway/group-turn-access.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `work/T-1661-split-group-turn-body.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway-group.test.ts src/agents/gateway-stop.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`group-turn-body.ts` is 350 lines or fewer.**
- **A pure move:** the same tools are offered to the same senders.
- **The listed tests pass.**

---

## Report (written by the worker when done)

### What I did
- Added `apps/server/src/agents/gateway/group-turn-access.ts` (92 lines):
  - `groupTurnAccess(input)` computes `scheduledTrigger`, `triggerBare`, `triggerRole`
    (internal), `allowedForAction`, `allowActions`, `askPeople` and `delegateTargets`
    from `{ trigger, gate, actionsList, canDelegate, handoffTargets }` and returns
    `{ scheduledTrigger, triggerBare, allowedForAction, allowActions, askPeople,
    delegateTargets }`.
  - `makeIsStillAllowed(db, domain, room, triggerBare)` returns the re-check callback
    (`() => Promise<boolean>`) using the same `loadRoomGateState` Effect pipeline.
  - The comments were moved word for word.
- `apps/server/src/agents/gateway/group-turn-body.ts`: replaced the access block with a
  `groupTurnAccess(...)` call and the `isStillAllowed` block with `makeIsStillAllowed(...)`;
  kept `turnDesk`, `deskEnabled` and `groupTools` in place; dropped the now-unused
  `loadRoomGateState` import and added the import of the new module. 394 → 350 lines.
- No new tests (the room tests cover it).

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts src/agents/gateway-stop.test.ts`
  → 2 test files passed, 30 tests passed.
- `pnpm gate` (from the repo root):
```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (1.1s)
PASS  lint  (1.1s)
PASS  typecheck  (3.6s)
PASS  effect  (1.4s)
PASS  tests @zilar/server  (12.0s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
The three changed files are the two source files plus this task file, all under Allowed files.

### Notes for the lead
- One deliberate, behaviour-preserving deviation from a byte-for-byte move: the
  `buildGroupTools` call passes `allowActions ? actionsList : []` instead of
  `allowedForAction ? actionsList : []`. They are identical: `allowActions` is
  `allowedForAction && actionsList.length > 0`, and an empty `actionsList` yields the
  memory tools either way. It was needed to stay at 350 lines: destructuring all six
  returned fields is formatted by Prettier into 8 lines (356 total), while destructuring
  five keeps the file at exactly 350. `allowedForAction` is still returned by
  `groupTurnAccess` as the spec requires; the body just uses the equivalent flag.
- Acceptance met: `group-turn-body.ts` is 350 lines (was 394); the listed tests pass; the
  same tools are offered to the same senders.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 1 nit. `buildGroupTools` now gets `allowActions ? actionsList : []` instead of `allowedForAction ? …`; the two differ only when the list is empty, so the result is `[]` either way. Equivalent.
- **The split:** `group-turn-access.ts` (92 lines) holds `groupTurnAccess` and `makeIsStillAllowed`, with the comments moved verbatim. `group-turn-body.ts` drops from 394 to 350 lines.
- **The tests:** the lead ran `gateway-group`, `gateway-stop` and `gateway-desk`: 31 passed.
