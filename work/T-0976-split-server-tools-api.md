---
id: T-0976
title: "Size split T29: apps/server/src/tools/api.ts (799 lines) into tools/{routes,wire,access}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0976-split-server-tools-api
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0976: Split `tools/api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/tools/api.ts` is 799 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #25 (task T29): `tools/routes.ts` (the HttpApi group handlers), `tools/wire.ts` (the wire mappers plus the body and limit helpers) and `tools/access.ts` (`toolAccess`, `requireReadable*`, `listToolsForGroup`, `findOwnedAiRow`, `findMembership`), under `apps/server/src/`. `tools/api.ts` becomes the barrel.

Skip the entry's Dedup: the `withServiceErrors` swap and the ais and groups query copies cross files. `access.ts` is permissions code, so move it unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #25, and `apps/server/src/tools/api.ts`.

### Allowed files
`apps/server/src/tools/api.ts`, `apps/server/src/tools/routes.ts`, `apps/server/src/tools/wire.ts`, `apps/server/src/tools/access.ts`, `work/T-0976-split-server-tools-api.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

**What I did.** Split `apps/server/src/tools/api.ts` per `docs/audit/size-plan.md` §2.2 #25 into `tools/routes.ts` (the HttpApi group handlers, plus `ToolsApi`, `ToolsApiDependencies` and `createToolsApi`), `tools/wire.ts` (the wire mappers plus the body/limit helpers) and `tools/access.ts` (`toolAccess`, `toolAccessIncludingDeleted`, `requireReadable*`, `listToolsForGroup`, `findOwnedAiRow`, `findMembership`). `tools/api.ts` is now a thin barrel. Code moved unchanged; the entry Dedup was skipped as the spec says.

**Line counts (`wc -l`).**
- before: `apps/server/src/tools/api.ts` = 799
- after: `tools/api.ts` = 21 (barrel), `tools/routes.ts` = 396, `tools/wire.ts` = 177, `tools/access.ts` = 244.
Every file stays ≤ 400; no `max-lines` warning appears.

**Export list, before → after.** `grep -E "^export"` on the old file gave the 5 public names: `TOOL_RUN_RATE_LIMIT_MAX`, `TOOL_RUN_RATE_LIMIT_WINDOW_MS`, `MAX_TOOL_RUN_INPUT_BYTES`, `ToolsApiDependencies` (interface), `createToolsApi`. The barrel re-exports the same 5 names and kinds:
```
export { createToolsApi, TOOL_RUN_RATE_LIMIT_MAX, TOOL_RUN_RATE_LIMIT_WINDOW_MS } from './routes';
export type { ToolsApiDependencies } from './routes';
export { MAX_TOOL_RUN_INPUT_BYTES } from './wire';
```
The new files additionally export the helpers that were file-private before, so the three modules can import each other: `routes.ts` exports `TOOL_RUN_RATE_LIMIT_MAX`, `TOOL_RUN_RATE_LIMIT_WINDOW_MS`, `ToolsApiDependencies`, `createToolsApi`; `wire.ts` exports `MAX_TOOL_RUN_INPUT_BYTES`, `toListWire`, `toDetailWire`, `toVersionListWire`, `toVersionDetailWire`, `toRunListWire`, `toRevertWire`, `toRunWire`, `runInputWithinLimit`, `readJsonBody`, `withServiceErrors`; `access.ts` exports `toolAccess`, `toolAccessIncludingDeleted`, `requireReadableTool`, `requireReadableVersions`, `requireReadableVersion`, `requireReadableRuns`, `listToolsForGroup`, `findOwnedAiRow`, `findMembership`. Those extra names are internal to the module; the public surface of the old path is unchanged, so no importer changes: `app.ts` still does `import { createToolsApi, type ToolsApiDependencies } from './tools/api'`.

**Gate summary** (`pnpm gate`, repo root):
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.7s)
PASS  lint  (1.3s)
PASS  typecheck  (4.0s)
PASS  effect  (1.3s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Tests I ran.** `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts` → 1 file passed, 5 tests passed. It imports `./app`, so the new module graph and `createToolsApi` wiring load and the 401 sweep still covers the tools routes. The gate itself skipped @zilar/server tests ("no nearby test files": no `*.test.ts` beside `tools/api.ts`).

**Deviations / notes.**
- The spec says to skip the entry's Dedup, so `withServiceErrors`/`mapServiceError` are kept. They live in `tools/wire.ts`, not `tools/routes.ts`: putting them in `routes.ts` made it 410 lines, over the 400 limit (split-rules item 4), and the Allowed files allow no fifth file. They are otherwise unchanged; `wire.ts` is the helper module.
- The module header comment stays on the old path (`tools/api.ts`, the barrel); its stale phrase "(`routes.ts`, now a thin wrapper below)" was dropped because no `routes.ts` wrapper exists any more. No code change.
- No `// effect-plain:` markers were needed: all three new files import `effect` as a value, so the ratchet classifies them `effect` (the gate's `PASS effect` confirms it).
- Prettier reflowed the new files' imports/exports during the format fix.

**Open questions.** None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `tools/api.ts` (799 lines) becomes a barrel plus `routes` (396), `access` (244) and `wire`. The access checks moved unchanged.
- **Check:** the gate passed.
