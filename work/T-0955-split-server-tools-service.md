---
id: T-0955
title: "Size split T10: apps/server/src/tools/service.ts (1,200 lines) into tools/{queries,mutations,hosts,runner}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0955-split-server-tools-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0955: Split `tools/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/tools/service.ts` is 1,200 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #7 (task T10): `tools/queries.ts`, `tools/mutations.ts`, `tools/hosts.ts`, `tools/runner.ts`, under `apps/server/src/`. `tools/service.ts` becomes the barrel.

The entry's Dedup of `hostsEqual` applies only inside these files.

This is permissions code (tool hosts and approvals), so it is crucial: move it unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #7, and `apps/server/src/tools/service.ts`.

### Allowed files
`apps/server/src/tools/service.ts`, `apps/server/src/tools/queries.ts`, `apps/server/src/tools/mutations.ts`, `apps/server/src/tools/hosts.ts`, `apps/server/src/tools/runner.ts`, `work/T-0955-split-server-tools-service.md`.

### Checks
```bash
pnpm gate
```
The gate runs the nearest server tests.

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/tools/service.ts` (1,200 lines) into `queries.ts`, `mutations.ts`, `hosts.ts`, `runner.ts`, with `service.ts` as the barrel. Code was moved unchanged; only `export` was added where a moved helper is now needed across files, and one exported line was wrapped by Prettier (see Deviations). No importer changed.

The runtime shared foundation (`ToolServiceError`, the four `MAX_*` constants, the `ToolRow`/`VersionRow`/`RunRow` aliases) lives in `queries.ts`: it is the only new module the other three can depend on without an import cycle, since every other module uses the row-read helpers (`queries` depends on nothing in `tools/` except types). The public interfaces stay in the barrel, the project's usual pattern for a split's shared view types (see `machines/service.ts` in the plan).

### Files (wc -l)

| File | Lines |
| --- | --- |
| `apps/server/src/tools/service.ts` (old, `git show HEAD:`) | 1200 |
| `apps/server/src/tools/service.ts` (barrel, after) | 126 |
| `apps/server/src/tools/queries.ts` | 392 |
| `apps/server/src/tools/mutations.ts` | 393 |
| `apps/server/src/tools/hosts.ts` | 162 |
| `apps/server/src/tools/runner.ts` | 217 |

Every file is at most 400 lines; no `max-lines` warning.

### Deviation from the spec (split-rules item 4)

`size-plan.md` §2.1 #7 puts `saveToolVersion`/`appendVersion`/revert/delete **plus the audit/run inserts** in `mutations.ts`. Moved as written, that module is **528 lines**, over the 400 cap. Following split-rules item 4 (split a module once more along a boundary the entry names), the entry's named "audit/run inserts" group (`InsertVersionInput`, `RecordSaveAuditInput`, `recordSaveAudit`, `insertVersion`, `RecordRunInput`, `recordRun`, `truncateBytes`) was split out and placed in `runner.ts`, which is the run-related file the entry names. `runner.ts` is 217 lines; `mutations.ts` is 393 lines. This is the only redistribution beyond the entry's four files; all four names are used.

### Export list

Before (old `service.ts`) exports 28 names: `ToolRunner`, `ToolRunResult` (type), `MAX_TOOLS_PER_TOPIC`, `MAX_VERSIONS_PER_TOOL`, `MAX_RUNS_PER_TOOL`, `MAX_RUN_OUTPUT_BYTES`, `ToolServiceError`, `SaveToolVersionInput`, `PublicTool`, `ToolDetail`, `PublicToolVersion`, `ToolVersionDetail`, `PublicToolRun`, `SaveToolVersionResult`, `saveToolVersion`, `listTools`, `getTool`, `listVersions`, `getVersion`, `RevertToolInput`, `revertTool`, `deleteTool`, `deleteToolsForAiInTopicEffect`, `deleteToolsForAiInGroupEffect`, `RunToolVersionDeps`, `RunToolVersionInput`, `runToolVersion`, `approveToolHosts`, `revokeToolHosts`, `listRuns`, `listToolsForAi`.

After, the barrel re-exports exactly those names with the same kinds:
- `export type { ToolRunner, ToolRunResult } from './types';`
- the 10 public interfaces (`SaveToolVersionInput`, `PublicTool`, `ToolDetail`, `PublicToolVersion`, `ToolVersionDetail`, `PublicToolRun`, `SaveToolVersionResult`, `RevertToolInput`, `RunToolVersionDeps`, `RunToolVersionInput`) are declared in the barrel;
- `export { getTool, getVersion, listRuns, listTools, listToolsForAi, listVersions, MAX_RUN_OUTPUT_BYTES, MAX_RUNS_PER_TOOL, MAX_TOOLS_PER_TOPIC, MAX_VERSIONS_PER_TOOL, ToolServiceError } from './queries';`
- `export { deleteTool, deleteToolsForAiInGroupEffect, deleteToolsForAiInTopicEffect, revertTool, saveToolVersion } from './mutations';`
- `export { approveToolHosts, revokeToolHosts } from './hosts';`
- `export { runToolVersion } from './runner';`

The new modules also export internal helpers the siblings need (`findActiveTool`, `enforceToolLimit`, `getToolRow`, `latestRunStatus`, `listViewExtras`, `toToolDetail`, `toVersionDetail`, `toPublicRun`, `ToolRow`, `VersionRow`, `RunRow`, `hostsEqual`, `recordSaveAudit`, `insertVersion`). These are not re-exported by the barrel, so its public surface is unchanged.

I verified the moved blocks are byte-identical to the original ranges (`diff` of each range against its destination, allowing only the added `export` prefixes); `hostsEqual` (1083–1088) moved to `hosts.ts`. The entry's dedup of `hostsEqual` with `tools/adapters.ts:933` crosses files and is left for the F task, as the task says.

### Deviations

- The audit/run-insert redistribution above (split-rules item 4).
- `recordSaveAudit`'s one-line signature was wrapped by Prettier because the added `export` pushed it past the 100-column limit. Formatting only, no behaviour change.
- Imports added to every new file; `ToolRow`/`VersionRow`/`RunRow` are now `export type` in `queries.ts` so the siblings can use them.
- No `// effect-plain:` marker was needed: every new module imports `effect` as a value, so the ratchet classified them `effect` (the `effect` gate step passed).

### Commands run

- `pnpm install` — done (resolved 1262, done).
- No single test file was run: the `tools/` folder holds no test files, so the gate's nearest-test step skips.
- `pnpm gate` (from the repo root), final run:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.6s)
PASS  lint  (0.6s)
PASS  typecheck  (0.9s)
PASS  effect  (0.5s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

(Earlier gate runs failed on format, then lint, then typecheck; each failure was fixed in scope and the final run is the one above.)

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `tools/service.ts` (1,200 lines) becomes a barrel plus `tools/{queries,mutations,hosts,runner}.ts`, the largest at 393 lines. No behaviour change.
- **Check:** the gate passed.
