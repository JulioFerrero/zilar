---
id: T-0630
title: "effect/sql: the four reads in agents/gateway/group-turn.ts (group title, topic name, virtual key via the existing loadEncryptedVirtualKey, the delegation flags) off drizzle; same best-effort catches, same prompt; tests unchanged"
status: todo
milestone: M5
branch: task/T-0630-effect-sql-group-turn
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.25 day
---

# T-0630: group turn reads on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. This is F2 in `docs/audit/effect-last-mile.md` §2 (T-0626). The gateway already has effect/sql helpers in `apps/server/src/agents/gateway/db.ts` (T-0567), with a private `runSql` there.

### Verified facts (do not re-derive)
- **`apps/server/src/agents/gateway/group-turn.ts`**, drizzle imports at 2 (`eq, inArray`) and 6 (`ais, groups, llmVirtualKeys, topics`). Four reads, all with the top-level `deps.db`:
  - **271-276:** `groups.title` by `room.groupId`, inside a best-effort `try`/`catch`;
  - **282-287:** `topics.name` by `room.topicId`, best effort;
  - **295-299:** `llm_virtual_keys.encrypted_key` by `ai_id`, where a missing row throws `AI … has no virtual key`. **`loadEncryptedVirtualKey(db, aiId)` already does this read** (`agents/gateway/db.ts:265-277`); call it and keep the throw on `null`;
  - **360-365:** `ais.id, accepts_delegation, can_delegate` for `id IN (session.aiId, …others)`. The list always holds `session.aiId`, so it is never empty. The code reads `row.accepts` and `row.canDelegate`, so alias `accepts_delegation AS accepts`.
- **Where to put the new queries:** add the three new reads (group title, topic name, delegation flags) as exported helpers in `agents/gateway/db.ts`, next to the others, with the same `runSql` there. Then `group-turn.ts` calls them. Keep the best-effort `try`/`catch` blocks exactly where they are.
- **The virtual key is decrypted in memory only** (comment at 302). Nothing new may log it.
- **Tests that must pass unchanged:** `apps/server/src/agents/gateway/*.test.ts` and `apps/server/src/agents/*.test.ts`.

### What to build
1. Move the four reads as above. `group-turn.ts` keeps no value import from `drizzle-orm` or `db/schema`.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/agents/gateway/db.ts`, `apps/server/src/agents/gateway/group-turn.ts` (lines 255-380).

### Allowed files
`apps/server/src/agents/gateway/group-turn.ts`, `apps/server/src/agents/gateway/db.ts`, `work/T-0630-effect-sql-group-turn.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway
pnpm gate
```

### Acceptance
- The group turn's reads run on effect/sql with the same behaviour.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
