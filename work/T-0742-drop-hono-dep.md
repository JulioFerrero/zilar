---
id: T-0742
title: "B1.9: drop the hono dependency from apps/server (no import left after T-0740)"
status: merged
milestone: M5
branch: task/T-0742-drop-hono-dep
model: auto
effort: low
depends_on: [T-0740]
estimate: 0.05 day
---

# T-0742: remove the Hono dependency (B1.9)

## Spec (written by Claude, do not edit)

### Why
B1.9 of `docs/audit/effect-edge-flip-plan.md` (line 266). Since T-0740 no source file imports Hono; this task removes the package.

### Verified facts (do not re-derive)
- `apps/server/package.json:26` has `"hono": "^4.13.9"` in `dependencies`. No other workspace `package.json` lists `hono` or `@hono/*`.
- `git grep -n "from 'hono" -- apps packages` prints nothing; the only matches are the dependency line above and code comments.
- `apps/server/src/errors.ts` already uses a local `ContentfulStatusCode` union (T-0732).
- Code comments that mention Hono describe parity ("as Hono did"). They stay.

### What to build
1. Remove the `hono` line from `apps/server/package.json`.
2. Run `pnpm install` to update `pnpm-lock.yaml`; only the `hono` entries may change.

### Read first
`AGENTS.md`, `apps/server/package.json`.

### Allowed files
`apps/server/package.json`, `pnpm-lock.yaml`, `work/T-0742-drop-hono-dep.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `git grep -n '"hono"' -- '*package.json'` prints nothing.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Done:** removed the `"hono": "^4.13.9"` line from `apps/server/package.json` (dependencies) and ran `pnpm install`.

**Files changed (all in Allowed files):**
- `apps/server/package.json`: 1 line deleted (`hono`).
- `pnpm-lock.yaml`: 9 lines deleted, all in the hono entries (importer specifier and version, the `hono@4.13.9` resolution, engines, and blank separators). Nothing else changed.
- `work/T-0742-drop-hono-dep.md`: status and this Report.

**Commands and results:**
- Pre-check `git grep -n "from 'hono\|from \"hono\|require('hono" -- apps packages`: no output, so no import remains.
- `pnpm install`: exit 0.
- `pnpm exec prettier --write apps/server/package.json`: unchanged, exit 0.
- `git grep -n '"hono"' -- '*package.json'`: no output, exit 1 (acceptance met).
- `pnpm gate`: exit 0. Summary lines:
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

**Problems / deviations:** none. Code comments that mention Hono were left as the spec says.

**Open questions:** none.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 1.5 min). The `hono` line is removed from `apps/server/package.json`, and the lockfile drops the whole package, so no other dependency used it. The gate passed. **With this, Hono is gone from Zilar.**
