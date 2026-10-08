---
id: T-0630
title: "effect/sql: the four reads in agents/gateway/group-turn.ts (group title, topic name, virtual key via the existing loadEncryptedVirtualKey, the delegation flags) off drizzle; same best-effort catches, same prompt; tests unchanged"
status: merged
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

### What I did
Moved the four `group-turn.ts` reads off drizzle onto the effect/sql helpers in `apps/server/src/agents/gateway/db.ts`, keeping behaviour and the best-effort `try`/`catch` blocks exactly where they were.

New exported helpers in `db.ts` (using the existing private `runSql`):
- `loadGroupTitle(db, groupId): Promise<string | null>` — `SELECT title FROM groups WHERE id = … LIMIT 1`.
- `loadTopicName(db, topicId): Promise<string | null>` — `SELECT name FROM topics WHERE id = … LIMIT 1`.
- `loadDelegationFlags(db, aiIds): Promise<readonly DelegationFlagRow[]>` — `SELECT id, accepts_delegation AS accepts, can_delegate FROM ais WHERE id IN ${sql.in(aiIds)}` (the alias keeps `row.accepts`, and `transformResultNames` yields `canDelegate`).

In `group-turn.ts`:
- Removed `import { eq, inArray } from 'drizzle-orm'` and `import { ais, groups, llmVirtualKeys, topics } from '../../db/schema'`; no value import from `drizzle-orm` or `db/schema` remains.
- Group title: `groupName = (await loadGroupTitle(deps.db, room.groupId)) ?? undefined;` inside the same `try`.
- Topic name: `topicName = (await loadTopicName(deps.db, room.topicId)) ?? undefined;` inside the same `try`.
- Virtual key: `loadEncryptedVirtualKey(deps.db, session.aiId)` (existing helper) and kept `throw new Error(\`AI ${session.aiId} has no virtual key\`)` on `null`; still decrypted in memory only.
- Delegation: `loadDelegationFlags(deps.db, [session.aiId, ...otherSessions…])`, then the same `canDelegate`/`accepting` logic.

The `aiIds` list always holds `session.aiId`, so `sql.in` is never empty.

### Files changed
- `apps/server/src/agents/gateway/db.ts`
- `apps/server/src/agents/gateway/group-turn.ts`
- `work/T-0630-effect-sql-group-turn.md`

### Commands and real results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway` → 1 test file passed, 168 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents` → 16 test files passed, 1 skipped; 431 tests passed, 1 skipped.
- `pnpm gate` (first run) → FAIL at `typecheck`: `src/agents/gateway/db.ts:311 TS4104: The type 'readonly DelegationFlagRow[]' is 'readonly' and cannot be assigned to the mutable type 'DelegationFlagRow[]'`. Fixed the helper's return type to `readonly DelegationFlagRow[]`.
- `pnpm gate` (second run) →
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (16.7s)
  PASS  lint  (0.5s)
  PASS  typecheck  (8.0s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  Gate skipped tests because there are no test files directly under `src/agents/gateway/`, so I ran the `src/agents` suite by hand (above).

### Problems / deviations
- The only deviation was the typecheck fix (return type `readonly`), required because `SqlClient` returns a readonly result array. No behaviour change.
- No tests were changed. Tests are unchanged and green.

### Security checklist
- The virtual key is still decrypted in memory only; nothing new logs, stores or returns it.
- All four reads are unchanged in scope and semantics; no new routes or writes.
- Audit/logging untouched.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, no findings. The packet head is db7b3b6f, the current HEAD.
- **Lead check:**
  - three helpers were added to `gateway/db.ts`;
  - the virtual key goes through `loadEncryptedVirtualKey`, and a null key still throws;
  - the delegation flags use `sql.in`, with a list that always holds the session AI;
  - the best-effort catches are kept.
