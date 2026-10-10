---
id: T-1051
title: "Audit: what is left of the size-plan dedups F1-F7 on main, with small task slices"
status: todo
milestone: M5
branch: task/T-1051-audit-dedup-status
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1051: Dedup status audit

## Spec (written by Claude, do not edit)

### Why
`docs/audit/size-plan.md` §4.1 lists the shared-code tasks F1-F8, written before the simplify and size-split waves. Some are already partly done. F1 is an example: `apps/server/src/effect/sql.ts:111` `runSql` is used at about 522 call sites, and only 9 direct `sqlRuntimeFor(...).runPromise` calls remain (`app.ts:597`, `pins/access.ts:48`, `blocks/service.ts:138`, `pins/service.ts:129`, `auth/sql-adapter.ts:155`, `roles/service.ts:84`, `db/migrate.ts:9`, `voice-transcription/pipeline.ts:157`, `test-support.ts:304`). F6a and F8a/b are done or running (T-1043, T-1049, T-1050). The lead needs measured facts before writing more specs.

### What to build
Write `docs/audit/dedup-status.md`. **Change no code.** For each of F1-F7 (`size-plan.md` §4.1, lines 276-282):

1. **What is left on main today,** with real `grep`/`wc` evidence and file:line. Examples:
   - how many `withErrorEnvelope(` / `requestIdOf(` calls remain (F2);
   - how many schema-error envelope wrappers remain in `*/api.ts` (F3);
   - how many hand-written rate limiters exist next to `apps/server/src/effect/rate-limit-middleware.ts` (F4);
   - which modules still do their own group-membership or role checks instead of a shared one (F5);
   - which F6 items remain after T-1043: the crypto envelope copies `push/crypto.ts:44-59`, `connections/crypto.ts:48-63` and `setup/crypto.ts:49-64`, `bareJid`, the secret scrub, the schema-issue walker, `truncateChars`;
   - how much of `apps/web/src/lib/api.ts` is still hand-written (F7).
2. **Whether the copies are identical** (`diff`) or differ in behaviour, and how. Where a merge would change behaviour, say exactly what would change.
3. **Proposed task slices,** each at most about 400 changed lines, with exact files.
   - Mark the slices that touch auth, keys, permissions, rate limits or money as "security: move unchanged or lead decision".
   - Skip the files the lead has deferred: `apps/server/src/main.ts`, `apps/server/src/app.ts`, `apps/server/src/agents/gateway/*`, `apps/server/src/sandbox/tool-worker.ts`, `packages/runner-tunnel/**`, and the stores (`apps/*/src/store/**`).
4. **A recommended order.**

Keep `docs/audit/dedup-status.md` under 400 lines.

### Read first
`AGENTS.md`, `docs/audit/size-plan.md` §1 and §4.1, `docs/audit/simplify-plan.md` (§2.1-§2.8 are the same items), and `apps/server/src/effect/`.

### Allowed files
`docs/audit/dedup-status.md`, `work/T-1051-audit-dedup-status.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/dedup-status.md` exists and covers F1-F7, with grep/diff evidence and file:line for each claim.
- Every proposed slice names exact files and an estimated line count.
- No code changed.

---

## Report (written by the worker when done)

## Review (written by Claude)
