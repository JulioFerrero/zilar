---
id: T-0548
title: "Effect C1: ais/usage.ts (getAiUsage) and search/service.ts (allowedArchives' own queries) on effect/sql; same answers, numeric columns still read as numbers; signatures unchanged, tests unchanged"
status: todo
milestone: M5
branch: task/T-0548-effect-sql-ai-usage-search-archives
model: auto
effort: low
depends_on: [T-0535]
estimate: 0.5 day
---

# T-0548: AI usage and search archives on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server service onto effect/sql"**, with examples in `apps/server/src/contacts/service.ts` (T-0522) and `apps/server/src/machines/registry.ts` (T-0535). Since T-0535, `createTestContext` registers the effect/sql runtime, so service tests that never build an app still have one.

### Verified facts (do not re-derive)
- **`apps/server/src/ais/usage.ts`** (163 lines):
  - `getAiUsage(deps: AiUsageDeps, aiId)` (line 48) selects `ai_limits.per_day_usd`, `per_month_usd` and `llm_virtual_keys.litellm_key_id`, with an inner join on `ai_limits` and a left join on `llm_virtual_keys`;
  - it then reads and writes the `ai_daily_spend` baseline (read the rest of the function);
  - `utcDayString` (29) is pure.
  - **Callers:** `apps/server/src/ais/routes.ts:173` and `apps/server/src/agents/gateway/budget.ts:50,152`. All pass the plain `db`; none passes a transaction handle.
- **Numeric columns.** `per_day_usd`, `per_month_usd` (`apps/server/src/db/schema.ts:602-603`) and `baseline_usd` (line 1043) are `numeric(12,2)`. node-postgres returns `numeric` as a **string**. Keep exactly the same number conversion the current code does on the drizzle values, and the same rounding in what you write back.
- **`apps/server/src/search/service.ts`** (130 lines): `allowedArchives(db, config, userId)` (line 65) runs two queries of its own:
  - contacts joined with `user` and left-joined with `xmpp_accounts`, scoped by `contacts.user_id`;
  - `ais` scoped by `owner`.
  
  It also calls `listGroupsForUser(db, …)` and `visibleTopics(db, …)` from other modules. **Leave those two calls on drizzle as they are.** Convert only the two own queries, keep the `Promise.all` shape, and keep the empty-name fallback (`UNNAMED_CONTACT_NAME`).
  - **Callers that stay unchanged:** `apps/server/src/search/routes.ts`, `apps/server/src/files/routes.ts:13`, `apps/server/src/media/routes.ts` and `apps/server/src/push/service.ts:6`.
  - `createArchivePool` (36) and `resolveChatFilter` (116) do not touch drizzle. Leave them as they are.
- **Tests (all unchanged):** `apps/server/src/ais/usage.test.ts`, `apps/server/src/ais/routes.test.ts`, `apps/server/src/agents/gateway.test.ts` (the DM and group budget cases), `apps/server/src/search/*.test.ts`, `apps/server/src/files/*.test.ts`, `apps/server/src/media/*.test.ts` and `apps/server/src/push/*.test.ts`.

### What to build
1. **Both files on effect/sql**, following the recipe:
   - the same exported functions, signatures and return values;
   - the same `WHERE` scoping (**the caller's own rows only**; search must never widen what a user may read);
   - `drizzle-orm` imports dropped where they are no longer used. `search/service.ts` may keep a drizzle *type* import if the helpers need one.
2. **Log lines** keep carrying ids only, never a key or a spend source, as today.
3. **No caller changes.** If one is needed, stop and report BLOCKED.
4. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/effect/sql.ts`, `apps/server/src/machines/registry.ts`, `apps/server/src/ais/usage.ts` (all of it), `apps/server/src/search/service.ts` (all of it).

### Allowed files
`apps/server/src/ais/usage.ts`, `apps/server/src/search/service.ts`, `work/T-0548-effect-sql-ai-usage-search-archives.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot ais search files media push src/agents/gateway.test.ts
pnpm gate
```

### Acceptance
- `getAiUsage` and `allowedArchives`' own queries run on effect/sql, with the same answers, scoping and number handling.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
