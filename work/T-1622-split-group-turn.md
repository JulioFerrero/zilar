---
id: T-1622
title: "Size split: move GroupTurnDeps (agents/group-turn.ts:34-117) into agents/group-turn-deps.ts and re-export it, so group-turn.ts drops from 399 to ~315 lines before its next change; no behaviour change"
status: merged
milestone: M5
branch: task/T-1622-split-group-turn
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1622: Split group-turn.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/agents/group-turn.ts` is at 399 lines after T-1611, against a limit of 400. The next change to it would cross the limit, so it is split first. The type-only part is the safest piece to move.

### Facts (the lead read them on 2026-10-16, main after T-1615)
- **`apps/server/src/agents/group-turn.ts`** (399 lines):
  - `:34-117` `export interface GroupTurnDeps { … }`;
  - `:118` `reportFailure`, `:146` `export async function runGroupTurn`, `:276` `runGroupToolTurn`.
- **Importers of `GroupTurnDeps` from this file:**
  - `apps/server/src/agents/reply.ts:44` (`export type { GroupTurnDeps } from './group-turn'`);
  - `apps/server/src/agents/turn-send.ts:8` and `apps/server/src/agents/turn-stop.ts:8` (`import type { GroupTurnDeps } from './group-turn'`).
  - The `./group-turn` imports inside `apps/server/src/agents/gateway/` point at a **different** file (`apps/server/src/agents/gateway/group-turn.ts`): leave them alone.

### Steps
1. **Create `apps/server/src/agents/group-turn-deps.ts`** holding `GroupTurnDeps`, with its doc comments, and the imports it needs. Move any type used only by `GroupTurnDeps` along with it.
2. **In `group-turn.ts`,** remove the interface. Import it as a type and keep `export type { GroupTurnDeps } from './group-turn-deps';`, so every importer keeps working unchanged.
3. **No behaviour change.** Don't touch anything else.

### Tests
None (a type move). Run the existing group turn tests.

### Allowed files
- `apps/server/src/agents/group-turn.ts`
- `apps/server/src/agents/group-turn-deps.ts`
- `work/T-1622-split-group-turn.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway-group.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`group-turn.ts` is under 330 lines,** and `group-turn-deps.ts` is under 150.
- **The typecheck and the group tests pass unchanged.**

---

## Report (written by the worker when done)

### What I did

Moved the `GroupTurnDeps` interface out of `group-turn.ts` into a new
`apps/server/src/agents/group-turn-deps.ts`, unchanged (same field order and all
doc comments), with the type imports it needs (`ChatKind`/`SendMessageOptions`,
`FetchLike`, `ModelTarget`, `ChatUsage`, `ChatCompletionMessage`, `ExecuteToolCall`/
`TurnCaps`, `ChatToolDefinition`, `TurnLog`).

In `group-turn.ts` I removed the interface, added
`import type { GroupTurnDeps } from './group-turn-deps';` and kept
`export type { GroupTurnDeps } from './group-turn-deps';` so every existing importer
(`reply.ts`, `turn-send.ts`, `turn-stop.ts`) keeps working with no change. I also
dropped the four imports that were only used by the interface and are no longer
referenced by `group-turn.ts`: `ChatKind`, `ChatCompletionMessage`, `TurnCaps`,
`ChatToolDefinition` (`SendMessageOptions` and the other shared types are still used
by the remaining functions, so they stayed).

No behaviour change, no other file touched.

Files changed:
- `apps/server/src/agents/group-turn.ts` — 399 → 319 lines
- `apps/server/src/agents/group-turn-deps.ts` — new, 89 lines
- `work/T-1622-split-group-turn.md` — status + this report

### Checks run

- `pnpm install` — Done in 15.8s (one pre-existing peer-dep warning in apps/mobile, unrelated).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts`
  — `Test Files 1 passed (1)`, `Tests 13 passed (13)`. (Same file as the Checks entry; I
  added the `--maxWorkers=2` cap that AGENTS.md requires.)
- `pnpm gate` (from repo root) — summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.7s)
  PASS  lint  (1.2s)
  PASS  typecheck  (4.8s)
  PASS  effect  (1.1s)
  PASS  tests @zilar/server  (16.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- Acceptance met: `group-turn.ts` is 319 lines (< 330) and `group-turn-deps.ts` is 89
  lines (< 150).
- Only the four imports used solely by the interface were dropped; the rest of the
  import block in `group-turn.ts` is unchanged, since the remaining functions still
  need it.

### Blocked / needs a decision

None.

### Open questions

None.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **The split:** `GroupTurnDeps` moved to `group-turn-deps.ts` (89 lines) and is re-exported, so no importer changed. `group-turn.ts` went from 399 to 319 lines.
