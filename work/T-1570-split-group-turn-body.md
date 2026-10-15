---
id: T-1570
title: "Split apps/server/src/agents/gateway/group-turn-body.ts (395 lines) before the handoff marker: the handoff-roster read (other sessions in the room, loadDelegationFlags, canDelegate, handoffTargets) moves to gateway/group-turn-roster.ts as resolveHandoffRoster; no behaviour change"
status: merged
milestone: M5
branch: task/T-1570-split-group-turn-body
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1570: Split group-turn-body.ts

## Spec (written by Claude, do not edit)

### Why
`docs/audit/handoff-questions-plan.md` §6 and §7 step 1: the handoff marker needs `group-turn-body.ts` to pass the task text, and the file is at 395 lines. This is the AI group-turn path (the message pipeline). **Follow `docs/audit/split-rules.md`.**

### Facts (the lead read them on main, 2026-10-15)
- **`apps/server/src/agents/gateway/group-turn-body.ts` (395 lines):**
  - `GroupTurnBodyInput` (`:37`), `notifyOwnerOfFailure` (`:61`), `runGroupTurnBody(input)` (`:75`);
  - `sessions` comes from the input (`:97`);
  - **`:171-202`** (comment `:171-175`):
    1. `otherSessions` = sessions in `roomJid` other than `session.aiId`;
    2. `let handoffTargets: { aiId; nick; jid }[] = []` and `let canDelegate = false`;
    3. when there are others, `Effect.promise(() => loadDelegationFlags(deps.db, [...]))` then `Effect.map(...)`, which sets both, then `Effect.catchDefect(() => Effect.void)` (best effort).
  - Then `handoffTargets` and `canDelegate` are read at `:233-236` (`delegateTargets`) and later passed to the reply wiring.
  - `loadDelegationFlags` is imported from `./db` (`:30`).

### Steps
1. **New `apps/server/src/agents/gateway/group-turn-roster.ts`:** `export const resolveHandoffRoster = (db, sessions, session, roomJid): Effect.Effect<{ handoffTargets: HandoffTarget[]; canDelegate: boolean }>` holds the `:171-202` logic **unchanged**, including the comment, best-effort, `catchDefect`, and the result `{ handoffTargets: [], canDelegate: false }` when there are no others or a defect.
   - Use the exact types the current code uses for `sessions` and `session`.
   - Export `HandoffTarget`.
   - It must not import `./group-turn-body`.
2. **`group-turn-body.ts`:** `const { handoffTargets, canDelegate } = yield* resolveHandoffRoster(deps.db, sessions, session, roomJid);` in place of the block. Remove the imports only the moved code used.
3. **No behaviour change.** The gateway tests must pass in the gate.

### Tests
None new.

### Allowed files
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/group-turn-roster.ts` (new)
- `work/T-1570-split-group-turn-body.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of both files (the body under 370);
  - the export list of `group-turn-body.ts` before and after (identical);
  - the gate summary, including the gateway tests that ran.

---

## Report (written by the worker when done)

### What I did

- New `apps/server/src/agents/gateway/group-turn-roster.ts` (55 lines): `export interface HandoffTarget` and
  `export const resolveHandoffRoster(db, sessions, session, roomJid): Effect.Effect<{ handoffTargets: HandoffTarget[]; canDelegate: boolean }>`.
  Holds the old `group-turn-body.ts` `:171-202` block moved unchanged: same comment, same `otherSessions` filter,
  same best-effort `loadDelegationFlags` read, same `Effect.map`, same `Effect.catchDefect(() => Effect.void)`,
  and `{ handoffTargets: [], canDelegate: false }` when there are no others or on a defect. It does not import
  `./group-turn-body`.
- `group-turn-body.ts`: replaced that block with a call to `resolveHandoffRoster(deps.db, sessions, session, roomJid)`
  and removed the now-unused `loadDelegationFlags` import from `./db` (`loadRoomGateState`/`RoomGateState` stay).
  `sessions` from `ctx` is still used (passed to the call); `handoffTargets`/`canDelegate` feed the same places
  as before (`messages`, `delegateTargets`, `runGroupTurn`).
- No behaviour change; no tests added or edited; no files touched outside the Allowed files.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts` → **13 passed (1 file)**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/budget.test.ts src/agents/gateway/model-target.test.ts src/agents/gateway/topic-follow.test.ts` → **25 passed (3 files)** (these are the gateway tests the gate selects for this change: the changed dir has no `group-turn-body.*` / `group-turn-roster.*` test, so every test in `apps/server/src/agents/gateway/` is selected).
- `pnpm gate` (from repo root) → **GATE PASS**:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.8s)
  PASS  lint  (0.7s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (11.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Acceptance facts

- `wc -l`:
  - `apps/server/src/agents/gateway/group-turn-body.ts` → **366** (was 395; under 370)
  - `apps/server/src/agents/gateway/group-turn-roster.ts` → **55**
- Export list of `group-turn-body.ts` before (`git show main:...`) and after — identical:
  ```
  export interface GroupTurnBodyInput {
  export function notifyOwnerOfFailure(
  export function runGroupTurnBody(input: GroupTurnBodyInput): Effect.Effect<void> {
  ```
  The new file adds `export interface HandoffTarget` and `export const resolveHandoffRoster`; nothing is removed
  from the old file and no importer changes (only `group-turn-body.ts` imported `loadDelegationFlags`, and that was
  already from `./db`).

### Notes for the lead

- **Deviation from spec step 2 (one line):** the spec's snippet
  `const { handoffTargets, canDelegate } = yield* resolveHandoffRoster(deps.db, sessions, session, roomJid);`
  is 109 characters, over the repo's Prettier `printWidth` of 100, so `format --check` would reject it and Prettier
  would wrap it over 6 lines (which leaves the file at exactly 370). To stay under 370 and keep the file
  Prettier-canonical I wrote it as a one-line call plus a destructure:
  ```ts
  const roster = yield* resolveHandoffRoster(deps.db, sessions, session, roomJid);
  const { handoffTargets, canDelegate } = roster;
  ```
  Behaviour is identical. Say the word if you'd rather have the 6-line direct destructure at 370 lines.
- No `// effect-plain:` marker needed: `group-turn-roster.ts` imports `effect` as a value, so the Effect ratchet
  classifies it as an `effect` file (gate `effect` step passed).

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - **Sizes:** `group-turn-body.ts` 366 and `group-turn-roster.ts` 55 lines (was 395).
  - **Exports:** the `^export` lines of the body are identical to main's.
  - **No cycle:** the roster module mentions the body only in a comment.
  - **The moved body:** `diff -w` against main's `:176-202` shows only the `HandoffTarget` alias, `db` in place of `deps.db`, and the new `return`.
- **Next:** the handoff marker (plan step 1) now has room in the body.
