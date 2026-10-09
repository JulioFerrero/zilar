---
id: T-0659
title: "zod: remove the zod dependency from apps/server/package.json now that no source file imports it; update the lockfile"
status: merged
milestone: M5
branch: task/T-0659-server-drop-zod-dependency
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0659: drop the zod dependency

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with Schema replacing zod. T-0650, T-0651, T-0653 and T-0654 removed the last zod imports.

### Verified facts (do not re-derive)
- `git grep -ln "from 'zod'\|require('zod')" -- apps packages` shows nothing on main.
- `apps/server/package.json:33` still lists `"zod": "^4.6.5"`. No other `package.json` in the repo lists zod.

### What to build
1. Delete the `zod` line from `apps/server/package.json`.
2. Run `pnpm install` and commit the `pnpm-lock.yaml` change.
3. In the Report, paste the output of `pnpm --filter @zilar/server why zod`. A library may still pull zod in as its own dependency (for example better-auth), which is fine. Report any peer-dependency warning from `pnpm install`.

### Read first
`AGENTS.md`, `apps/server/package.json`.

### Allowed files
`apps/server/package.json`, `pnpm-lock.yaml`, `work/T-0659-server-drop-zod-dependency.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `apps/server/package.json` has no zod.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Deleted the `"zod"` line from `apps/server/package.json` dependencies, then ran `pnpm install` and committed the resulting `pnpm-lock.yaml` change (only the importer entry for zod was removed; the `zod@4.6.5` package entry remains because better-auth still depends on it).

### Files changed
- `apps/server/package.json` — removed the `zod` dependency line.
- `pnpm-lock.yaml` — removed the `zod` importer entry under `apps/server` (3 deletions, no other change).
- `work/T-0659-server-drop-zod-dependency.md` — status/Report.

### Commands and real results
- `pnpm install` (first run): succeeded, `+1173` packages. Peer-dependency warning:
  ```
  apps/mobile
  └─┬ @types/react-dom 19.3.0
    └── ✕ unmet peer @types/react@^19.3.0: found 19.2.18
  ```
  Deprecation warning: `@esbuild-kit/core-utils@3.3.2, @esbuild-kit/esm-loader@2.6.5, uuid@7.0.3`. Both are pre-existing and unrelated to this change.
- `pnpm install` (after removing zod): succeeded, lockfile updated; same peer-dependency warning as above.
- `pnpm --filter @zilar/server why zod`:
  ```
  zod@4.6.5
  ├─┬ @better-auth/core@1.7.6
  │ ├─┬ @better-auth/drizzle-adapter@1.7.6
  │ │ └─┬ better-auth@1.7.6
  │ │   └── @zilar/server@0.1.0 (dependencies)
  │ ├─┬ @better-auth/kysely-adapter@1.7.6
  │ │ └── better-auth@1.7.6 [deduped]
  │ ├─┬ @better-auth/memory-adapter@1.7.6
  │ │ └── better-auth@1.7.6 [deduped]
  │ ├─┬ @better-auth/mongo-adapter@1.7.6
  │ │ └── better-auth@1.7.6 [deduped]
  │ ├─┬ @better-auth/prisma-adapter@1.7.6
  │ │ └── better-auth@1.7.6 [deduped]
  │ ├─┬ @better-auth/telemetry@1.7.6
  │ │ └── better-auth@1.7.6 [deduped]
  │ └── better-auth@1.7.6 [deduped]
  ├── better-auth@1.7.6 [deduped]
  └─┬ better-call@1.4.0
    ├── @better-auth/core@1.7.6 [deduped]
    └── better-auth@1.7.6 [deduped]

  Found 1 version of zod
  ```
  So zod is still pulled in transitively by `better-auth`, which the spec says is fine.
- `pnpm gate` (summary lines):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (32.2s)
  PASS  lint  (1.7s)
  PASS  typecheck  (14.6s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Single tests run
None. The change only removes a dependency entry and the gate reported `SKIP tests @zilar/server (no nearby test files)`.

### Problems / deviations
None. No file outside the Allowed files was touched. No open questions.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean. The packet head is 230ea4ac, the current HEAD.
- **Lead check:**
  - zod is removed from `apps/server/package.json`;
  - the lockfile changes by 3 lines;
  - zod stays only as a dependency of libraries.
