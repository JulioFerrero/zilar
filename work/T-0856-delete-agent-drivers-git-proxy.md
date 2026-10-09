---
id: T-0856
title: "Delete packages/agent-drivers and the unmounted git proxy (apps/server/src/git) — Julio approved"
status: todo
milestone: M5
branch: task/T-0856-delete-agent-drivers-git-proxy
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0856: Delete packages/agent-drivers and the unmounted git proxy (apps/server/src/git) — Julio approved

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Julio approved this on 2026-10-09 (`docs/audit/simplify-plan.md`, section 5, D-2). Findings I-F4 and G-F3 in `docs/audit/simplify-2026-10-09/`.
- **`packages/agent-drivers`** (1,610 lines with tests) has no importers and is in no `package.json`.
- **`apps/server/src/git/*`** (about 450 source and 447 test lines) is not mounted. The lead checked that nothing outside tests imports it.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Before deleting, re-check with grep that there are no importers, including package.json files, tsconfig, turbo.json, CI workflows, Dockerfiles and docs that run them. Then delete both.
2. Remove every config reference: the workspace list if it is explicit, turbo, CI and the lockfile (`pnpm install` updates `pnpm-lock.yaml`).
3. Mention them in docs only where a doc describes current code; leave history docs alone.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`packages/agent-drivers/**`, `apps/server/src/git/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `apps/server/package.json`, `package.json`, `.github/workflows/*.yml`, `docs/**`, `work/T-0856-delete-agent-drivers-git-proxy.md`.

### Checks (wave mode)
```bash
pnpm install
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/authz-sweep.test.ts src/app.test.ts
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.

---

## Report (written by the worker when done)

## Review (written by Claude)
