---
id: T-1057
title: "Dedup F6 (S4): one firstIssueMessage in apps/server/src/effect/schema-issues.ts for auth, routines and xmpp admin; audit keeps its own"
status: todo
milestone: M5
branch: task/T-1057-server-schema-issues
model: auto
effort: default
depends_on: [T-1051]
estimate: 0.1 day
---

# T-1057: One schema-issue walker

## Spec (written by Claude, do not edit)

### Why
`docs/audit/dedup-status.md` §6.4 (slice S4), corrected by the lead with `diff` on main, 2026-10-10.
- **Three copies behave the same:**
  - `apps/server/src/auth/api.ts:74` (private);
  - `apps/server/src/xmpp/admin/errors.ts:53` (exported, used by `xmpp/admin/client.ts:8`), the same text as auth's;
  - `apps/server/src/routines/schemas.ts:121` (exported, used by `routines/support.ts:16`), which differs only in a `{ }` block around `case 'AnyOf'`.
- **`apps/server/src/audit/schema.ts:76` differs:** it adds `case 'InvalidType': return SchemaIssue.defaultLeafHook(issue);` and `case 'MissingKey': return 'Missing key';`, and it recurses into itself, so those cases apply at every level. It stays as it is.

### What to build
1. **The new file:** `apps/server/src/effect/schema-issues.ts` exports `firstIssueMessage(issue: SchemaIssue.Issue): string | undefined`, the exact body from `auth/api.ts:74-96`.
2. **auth:** `auth/api.ts` deletes its private copy and imports the shared one. Move it unchanged: change no other line in this auth file, apart from dropping `SchemaIssue` from its `effect` import if nothing else uses it (`grep` first).
3. **xmpp admin:** `xmpp/admin/errors.ts` deletes its copy. Keep `firstIssueMessage` importable from it (`export { firstIssueMessage } from '../../effect/schema-issues';`), or point `xmpp/admin/client.ts:8` at the new file. Choose one, and say which in the Report. Drop the unused `SchemaIssue` import.
4. **routines:** `routines/schemas.ts` does the same, keeping `routines/support.ts:16` working (re-export, or a changed import).
5. **audit:** `audit/schema.ts` is not touched.

### Read first
`AGENTS.md`, and the files named above.

### Allowed files
`apps/server/src/effect/schema-issues.ts`, `apps/server/src/auth/api.ts`, `apps/server/src/xmpp/admin/errors.ts`, `apps/server/src/xmpp/admin/client.ts`, `apps/server/src/routines/schemas.ts`, `apps/server/src/routines/support.ts`, `work/T-1057-server-schema-issues.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -rn "function firstIssueMessage" apps/server/src` lists only `effect/schema-issues.ts` and `audit/schema.ts`.

---

## Report (written by the worker when done)

## Review (written by Claude)
