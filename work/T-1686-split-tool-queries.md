---
id: T-1686
title: "Size split of apps/server/src/tools/queries.ts (392 lines): move the four pure row mappers (toToolDetail, toPublicVersion, toVersionDetail, toPublicRun) into a new tools/tool-views.ts and re-export the three public ones from queries.ts so no importer changes — a pure move"
status: merged
milestone: M5
branch: task/T-1686-split-tool-queries
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1686: Split the row mappers out of tools/queries.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/tools/queries.ts` is 392 of 400 lines. Its row-to-view mappers are pure functions with no SQL, and they're the cleanest block to move.

### Facts (the lead read them on 2026-10-16)
- **`queries.ts`:**
  - imports `:1-12` (the `PublicTool`, `PublicToolRun`, `PublicToolVersion`, `ToolDetail` and `ToolVersionDetail` types from `./service`; the row types from `../db/rows`);
  - `export type ToolRow = AiToolRow; VersionRow = AiToolVersionRow; RunRow = AiToolRunRow` (`:32-34`);
  - **the mappers:** `export function toToolDetail(tool, current, lastRunStatus) :293-312`, `function toPublicVersion(row) :314-324` (private), `export function toVersionDetail(row) :326-328` and `export function toPublicRun(row) :330-345`;
  - then `listToolsForAi :347-…`.
- **Importers** of `./queries` inside `apps/server/src/tools/`: `hosts.ts:13`, `mutations.ts:19`, `runner.ts:15` and `service.ts:117`. Some of them import `toToolDetail`, `toVersionDetail` or `toPublicRun`.
- **The folder `apps/server/src/tools/`** has no `tool-views.ts`.

### Steps
1. **Create `apps/server/src/tools/tool-views.ts`** with the four mappers moved **word for word**.
   - Export `toToolDetail`, `toVersionDetail` and `toPublicRun`; `toPublicVersion` stays private.
   - Import only types (`ToolRow`, `VersionRow`, `RunRow` from `./queries`; the public view types from `./service`), so there's no runtime cycle.
2. **`queries.ts`:**
   - delete the four;
   - add `export { toPublicRun, toToolDetail, toVersionDetail } from './tool-views';` so every importer keeps working unchanged;
   - if `queries.ts` itself calls a mapper (for example `getTool`), import it from `./tool-views`;
   - drop the type imports it no longer uses.
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/server/src/tools/tool-views.ts`
- `apps/server/src/tools/queries.ts`
- `work/T-1686-split-tool-queries.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/tools --reporter=dot
pnpm gate
```

### Acceptance
- **`queries.ts` is about 340 lines,** and `tool-views.ts` holds the mappers unchanged.
- **The `src/tools` tests and the server typecheck pass.**

---

## Report (written by the worker when done)

### What I did

Pure move of the four row-to-view mappers out of `tools/queries.ts` into a new
`tools/tool-views.ts`. No behaviour change, no test changes.

- **`apps/server/src/tools/tool-views.ts`** (new, 52 lines): `toToolDetail`,
  `toPublicVersion`, `toVersionDetail` and `toPublicRun` moved word for word.
  Types are imported with `import type` only — `ToolRow`, `VersionRow`, `RunRow`
  from `./queries`, the view types from `./service` — so the runtime edge runs
  one way (`queries.ts` → `tool-views.ts`) and there is no cycle.
- **`apps/server/src/tools/queries.ts`** (392 → 343 lines): the four mappers
  deleted; added `import { toPublicRun, toPublicVersion, toToolDetail,
  toVersionDetail } from './tool-views'` (the functions `queries.ts` itself calls
  in `getTool`, `listVersions`, `getVersion`, `listRuns`) and the re-export
  `export { toPublicRun, toToolDetail, toVersionDetail } from './tool-views'`.
  No type import became unused: `PublicTool`, `PublicToolRun`, `PublicToolVersion`,
  `ToolDetail` and `ToolVersionDetail` are all still used as return types.
- Importers (`hosts.ts`, `mutations.ts`, `runner.ts`, `service.ts`) need no change.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools`:
  1 test file passed, 5 tests passed, 0 failed (11.5s).
- `pnpm gate` (from repo root, final run): GATE PASS
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.1s)
  PASS  format  (0.5s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.1s)
  PASS  effect  (1.8s)
  PASS  tests @zilar/server  (7.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (An earlier first gate run failed on `format` only for the new file, and a
  second on `typecheck` for the `toPublicVersion` export — see Notes; both fixed
  before the passing run above.)

### Notes for the lead

- **One deliberate deviation from the spec:** the spec said `toPublicVersion`
  stays private, but `queries.ts` calls it in `listVersions` (`rows.map(toPublicVersion)`),
  so with it private the server typecheck fails (`TS2724`). I exported it from
  `tool-views.ts` and imported it into `queries.ts`. It is **not** in the
  re-export line, so the public surface of `queries.ts` is unchanged (still only
  `toPublicRun`, `toToolDetail`, `toVersionDetail`). The function body itself is
  unchanged — still a pure move. The alternative (inlining the mapping) would
  have duplicated the function and pushed `queries.ts` above ~350 lines.
- `queries.ts` is 343 lines (acceptance asked for "about 340").
- No new tests: this is a pure move and the spec asked for none.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean; 1 cosmetic nit (two `import type` lines), left as is.
- **The lead's check:** the removed lines equal `tool-views.ts` exactly. The re-export keeps `queries.ts`'s public surface, and `toPublicVersion` stays internal.
- **Result:** `queries.ts` drops from 392 to 343 lines.
