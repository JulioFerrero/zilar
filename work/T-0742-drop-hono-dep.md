---
id: T-0742
title: "B1.9: drop the hono dependency from apps/server (no import left after T-0740)"
status: todo
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

## Review (written by Claude)
