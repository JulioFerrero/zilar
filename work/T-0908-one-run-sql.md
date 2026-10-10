---
id: T-0908
title: "One runSql: delete the 21 module-local copies of runSql and import the shared one from apps/server/src/effect/sql.ts"
status: todo
milestone: M5
branch: task/T-0908-one-run-sql
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0908: One runSql

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/effect/sql.ts:111-116` exports `runSql(db, effect)`, which returns `sqlRuntimeFor(db).runPromise(effect)`.

On 2026-10-10 the lead found module-local copies with the same one-line body in these files: `apps/server/src/actions/gateway.ts`, `apps/server/src/actions/production-announcer.ts`, `apps/server/src/agents/delegation/service.ts`, `apps/server/src/agents/gateway/db.ts`, `apps/server/src/agents/listener/score.ts`, `apps/server/src/auth/invites.ts`, `apps/server/src/chat-folders/service.ts`, `apps/server/src/chat-prefs/service.ts`, `apps/server/src/contact-requests/service.ts`, `apps/server/src/directory/service.ts`, `apps/server/src/groups/join.ts`, `apps/server/src/groups/service.ts`, `apps/server/src/groups/visibility.ts`, `apps/server/src/invite-links/service.ts`, `apps/server/src/machines/registry.ts`, `apps/server/src/machines/service.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/startup.ts`, `apps/server/src/topics/access.ts`, `apps/server/src/voice-transcription/routes.ts`, `apps/server/src/voice-transcription/settings.ts`.

Some copies take `deps` and read `deps.db` (for example `apps/server/src/pins/service.ts:42-47`). Some narrow the error type to `SqlError.SqlError` (for example `apps/server/src/topics/access.ts:86-91`).

### What to build
1. **Delete the local copies:** in each file above, delete the local `function runSql` and import `runSql` from the shared module (`../effect/sql` or the right relative path).
2. **Call sites that passed `deps`:** they pass `deps.db`.
3. **Narrowed error types:** where a copy narrowed the error type and a caller relied on it, keep the narrowing at the call site, or check that the shared generic infers the same type. Typecheck proves it.
4. **Copies that differ:** if a copy does something other than `sqlRuntimeFor(db).runPromise(effect)`, leave it alone and list it in the Report.
5. **Unchanged:** behaviour and tests.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/<task id>/`; use the `@/test/wait` helpers, never a raw `setTimeout(resolve, 0)`), and `apps/server/src/effect/sql.ts`.

### Allowed files
`apps/server/src/actions/gateway.ts`, `apps/server/src/actions/production-announcer.ts`, `apps/server/src/agents/delegation/service.ts`, `apps/server/src/agents/gateway/db.ts`, `apps/server/src/agents/listener/score.ts`, `apps/server/src/auth/invites.ts`, `apps/server/src/chat-folders/service.ts`, `apps/server/src/chat-prefs/service.ts`, `apps/server/src/contact-requests/service.ts`, `apps/server/src/directory/service.ts`, `apps/server/src/groups/join.ts`, `apps/server/src/groups/service.ts`, `apps/server/src/groups/visibility.ts`, `apps/server/src/invite-links/service.ts`, `apps/server/src/machines/registry.ts`, `apps/server/src/machines/service.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/startup.ts`, `apps/server/src/topics/access.ts`, `apps/server/src/voice-transcription/routes.ts`, `apps/server/src/voice-transcription/settings.ts`, `work/T-0908-one-run-sql.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/pins src/topics src/machines src/groups src/chat-folders src/chat-prefs src/directory src/invite-links src/contact-requests src/auth src/voice-transcription src/actions src/agents/listener src/agents/delegation src/effect
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```

### Acceptance
- The Checks pass.
- `grep -rn "^function runSql" apps/server/src` finds only the copies listed in the Report.
- The Report gives the lines removed.

---

## Report (written by the worker when done)

## Review (written by Claude)
