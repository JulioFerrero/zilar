---
id: T-0865
title: "Delete the confirmed dead files and the 41 unreferenced declarations (knip, hand-verified)"
status: todo
milestone: M5
branch: task/T-0865-dead-files-exports
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0865: Delete the confirmed dead files and the 41 unreferenced declarations (knip, hand-verified)

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Findings G-F1 and G-F2 in `docs/audit/simplify-2026-10-09/G-deadcode.md` (read both sections for the exact lists).
- **Confirmed dead files:**
  - `apps/mobile/src/components/chat/use-invites-api.ts` and `apps/mobile/src/mock/invites.ts`;
  - `apps/server/src/auth/session.ts`;
  - `apps/mobile/src/lib/protocol.ts`, which only its own test uses.
- **Declarations:** 41 declarations are referenced nowhere, about 202 lines.
- **Out of scope here:** dropping `export` on the 756 file-local exports is a later sweep, because it touches too many files at once.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
For each item, re-verify with grep (including tests, dynamic imports, Expo Router file routes, package.json scripts and workers) before deleting, and skip anything that is not truly dead. Delete the dead file's own test with it. Do not touch `apps/web/src/store/**`, `apps/mobile/src/store/**`, `apps/web/src/mock/**`, `apps/mobile/src/mock/**` (except `invites.ts`) or any `*/api.ts` in the server; other tasks are editing those. Skip items there and list them.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/mobile/src/components/chat/use-invites-api.ts`, `apps/mobile/src/mock/invites.ts`, `apps/server/src/auth/session.ts`, `apps/mobile/src/lib/protocol.ts`, `apps/mobile/src/lib/protocol.test.ts`, `apps/web/src/**`, `apps/mobile/src/**`, `apps/server/src/**`, `packages/**/src/**`, `work/T-0865-dead-files-exports.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
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
