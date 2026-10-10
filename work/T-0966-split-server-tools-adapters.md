---
id: T-0966
title: "Size split T21: apps/server/src/tools/adapters.ts (944 lines) into tools/{tool-adapters,tool-arg-schemas,routine-adapters,adapter-support}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0966-split-server-tools-adapters
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0966: Split `tools/adapters.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/tools/adapters.ts` is 944 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #17 (task T21): `tools/tool-adapters.ts` (312–768), `tools/routine-adapters.ts` (167–215 and 769–932) and `tools/adapter-support.ts` (108–311 and 933–944), under `apps/server/src/`. `tools/adapters.ts` becomes the barrel.

- **One more split** (`split-rules.md` item 4): `tool-adapters.ts` would be about 456 lines, so its arg schemas go to `tools/tool-arg-schemas.ts`.
- **Skip the Dedup items.** They cross files: `truncateChars`, the hosts set-compares against `tools/hosts.ts` (which T-0955 just created), and the 503 mapping belong to the F tasks.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #17, and `apps/server/src/tools/adapters.ts`.

### Allowed files
`apps/server/src/tools/adapters.ts`, `apps/server/src/tools/tool-adapters.ts`, `apps/server/src/tools/tool-arg-schemas.ts`, `apps/server/src/tools/routine-adapters.ts`, `apps/server/src/tools/adapter-support.ts`, `work/T-0966-split-server-tools-adapters.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/tools/adapters.ts` (944 lines) into `tool-adapters.ts`, `tool-arg-schemas.ts`, `routine-adapters.ts` and `adapter-support.ts`, with `adapters.ts` as the barrel. Code was moved unchanged; only `export` was added where a moved helper is now needed across files. No importer changed (`main.ts` imports `buildToolAdapters` + `BuildToolAdaptersDeps` from the barrel; the barrel re-exports the same ten names with the same kinds). The entry's Dedup items were skipped as the task says (they cross files: `truncateChars`, the hosts set-compares vs `tools/hosts.ts`, the 503 mapping).

Layering (no import cycles; verified by `pnpm gate` typecheck + effect ratchet): `tool-arg-schemas` → `adapter-support` → services; `tool-adapters` and `routine-adapters` → `adapter-support` + `tool-arg-schemas`; the barrel composes all four.

### Files (wc -l)

| File | Lines |
| --- | --- |
| `apps/server/src/tools/adapters.ts` (old, `git show main:`) | 944 |
| `apps/server/src/tools/adapters.ts` (barrel, after) | 69 |
| `apps/server/src/tools/tool-adapters.ts` | 320 |
| `apps/server/src/tools/tool-arg-schemas.ts` | 93 |
| `apps/server/src/tools/routine-adapters.ts` | 238 |
| `apps/server/src/tools/adapter-support.ts` | 304 |

Every file is at most 400 lines; no `max-lines` warning can appear.

### Deviation from the spec (split-rules item 4)

`size-plan.md` §2.2 #17 puts the whole `tool.*` block (312–768) in `tool-adapters.ts`, and the task's one extra split moves its arg schemas out. Moved as written, that module's eight adapters alone are **401 lines of code**, over the 400 cap even before imports, so the arg-schema split alone cannot bring it under the cap. Following item 4, I split it once more along the entry's other named concern: the two `tool.*_hosts` adapters (`tool.approve_hosts`, `tool.revoke_hosts`) moved to `adapter-support.ts`, which the entry already assigns the hosts set-compares (`hostsEqualAsSets`, `isSubsetOf`) they use. `tool-adapters.ts` is 320 lines and holds the other six `tool.*` adapters.

One supporting reallocation: `serialisedSize` + `inputField` (plan range 242–267, `adapter-support.ts`) moved to `tool-arg-schemas.ts`. It keeps the module graph acyclic — `adapter-support.ts` now imports the two hosts arg schemas from `tool-arg-schemas.ts`, so `tool-arg-schemas.ts` must not import back into `adapter-support.ts` for `inputField`. `inputField` is only used by the arg schemas there.

### Export list

Before (`grep -E "^export"` on old `adapters.ts`), 10 names: `BuildToolAdaptersDeps` (interface), `TOOL_RUNS_PER_HOUR`, `TOOL_RUN_WINDOW_MS`, `MAX_TOOL_INPUT_BYTES`, `MAX_TOOL_POST_CHARS`, `MAX_SAVE_MODEL_TEXT_CHARS`, `buildToolAdapters` (function), `describeSchedule`, `formatNextRun`, `ApproveHostsBoundArgs` (interface).

After, the barrel re-exports exactly those ten with the same names and kinds:
- `export type { BuildToolAdaptersDeps } from './adapter-support';`
- `export { MAX_SAVE_MODEL_TEXT_CHARS, MAX_TOOL_POST_CHARS, TOOL_RUNS_PER_HOUR, TOOL_RUN_WINDOW_MS } from './adapter-support';`
- `export { describeSchedule, formatNextRun } from './routine-adapters';`
- `export { MAX_TOOL_INPUT_BYTES, type ApproveHostsBoundArgs } from './tool-arg-schemas';`
- `buildToolAdapters` is declared in the barrel.

The new modules also export internal names the siblings need — `AdapterState`, `createAdapterState`, `ownerOf`, `plural`, `hostsLine`, `truncateChars`, `serviceFailure`, `findToolByName`, `routinesInScope`, `findRoutineByTitle`, `hostsEqualAsSets`, `isSubsetOf`, `toolApproveHostsAdapter`, `toolRevokeHostsAdapter` (adapter-support); `toolListArgsSchema`…`routineTitleArgsSchema` (tool-arg-schemas); `toolListAdapter`…`toolRevertAdapter`; `routineScheduleAdapter`, `routinePauseAdapter`, `routineDeleteAdapter`. None are re-exported by the barrel, so its public surface is unchanged.

### Unchanged-code check

A normalized comparison (blank/comment/import lines and `export`/`export … from` stripped, sorted) of `git show main:…/adapters.ts` against the barrel plus the four new modules differs only by the barrel's re-export lines and the multi-line import continuations — every code line of the original is present, none lost or edited.

### Effect ratchet (split-rules item 6)

`tool-adapters.ts` and `routine-adapters.ts` import `effect` only for the `type Schema` cast, so they classify as `needs-effect` and were absent on the base; both carry `// effect-plain: moved unchanged from apps/server/src/tools/adapters.ts (size split)` in their first lines. `adapter-support.ts` and `tool-arg-schemas.ts` import `effect` as a value (classified `effect`), so they need no marker. The gate's `effect` step passed.

### Commands run

- `pnpm install` — done (done in 12s).
- No single test file was run: the `tools/` folder holds no test files (the gate step reports `SKIP tests @zilar/server`).
- `pnpm gate` (from the repo root), final run:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.1s)
PASS  lint  (1.0s)
PASS  typecheck  (3.3s)
PASS  effect  (0.7s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

(Earlier gate runs failed on format only — Prettier re-wrapped one import in `routine-adapters.ts`. That was fixed in scope; the run above is the final one.)

### Deviation summary

- Extra split under item 4: `tool.approve_hosts`/`tool.revoke_hosts` → `adapter-support.ts`; `serialisedSize`/`inputField` → `tool-arg-schemas.ts` (both explained above).
- Internal `export`s added so siblings can share moved helpers; `BuildToolAdaptersDeps` and the four `TOOL_*`/`MAX_TOOL_POST_CHARS`/`MAX_SAVE_MODEL_TEXT_CHARS` constants live in `adapter-support.ts` (the barrel keeps `buildToolAdapters` and re-exports them).
- No `// effect-plain` marker used for any reason other than item 6.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `tools/adapters.ts` (944 lines) becomes a barrel plus `tool-adapters` (320), `adapter-support` (304), `routine-adapters` (238) and `tool-arg-schemas`.
- **Left for the F tasks:** the cross-file dedups.
- **Check:** the gate passed.
