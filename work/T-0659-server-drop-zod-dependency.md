---
id: T-0659
title: "zod: remove the zod dependency from apps/server/package.json now that no source file imports it; update the lockfile"
status: todo
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

## Review (written by Claude)
