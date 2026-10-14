---
id: T-1437
title: "Server perf and money batch from the findings sweep: people search without N+1 (SG-7), a short per-user cache for allowedArchives on push publish (PERF-5), the AI budget gate fails closed when a limit is set (AI-15)"
status: merged
milestone: M5
branch: task/T-1437-server-perf-batch
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1437: Server perf and money batch

## Spec (written by Claude, do not edit)

### Why
The findings sweep (`docs/audit/findings-sweep-server.md`, merged) left these partly open. Full texts:
- SG-7: `docs/audit/social-graph-audit.md`;
- PERF-5: `docs/audit/performance-audit.md`;
- AI-15: `docs/audit/ai-features-audit.md`.

### Facts (the lead read them on main, 2026-10-15)
- **SG-7:** `apps/server/src/contact-requests/search.ts:75-84` (86 lines) loops over up to `USER_SEARCH_LIMIT` rows and calls `await relationFor(db, viewerId, row.userId)` once per row. That makes 3-4 queries per row.
- **PERF-5:**
  - `allowedArchives(db, config, userId)` (`apps/server/src/search/service.ts:77`) runs on every push publish IQ, called from `apps/server/src/push/api-handlers.ts:170` and `apps/server/src/push/archive-scan.ts:62`;
  - it runs about 3 base queries each time, once per device per message;
  - T-1184 batched its inner pass (`search/service.ts:130`), but nothing caches the answer.
- **AI-15:** `apps/server/src/agents/gateway/budget.ts` (266 lines).
  - On a usage read error it logs "AI usage check failed; failing open" and returns not-limited (`:80-88`). The second gate does the same (`:183-189`).
  - So a database hiccup lets an AI with a spend limit run past it.

### What to build
1. **SG-7:** replace the per-row `relationFor` with one batched read: a `relationsFor(db, viewerId, userIds[])` next to `relationFor`, with the same result per user. Output order and content stay identical.
2. **PERF-5:**
   - cache `allowedArchives` per user in memory for **15 s**, in a small TTL map local to the push module, capped at 5,000 entries with the oldest evicted first;
   - drop a user's entry when their group or topic membership changes, if there is one place where that is easy to hook; otherwise the 15 s TTL alone is acceptable, and say so in the Report;
   - search (not push) keeps calling the uncached function.
3. **AI-15:** when the AI **has** a daily or monthly limit and the usage read fails, the gate fails **closed** (limited) and logs at warn, for both gates. With no limit set, keep today's behaviour (fail open). Find out where the AI's limits are known in `budget.ts`, and keep the file at 400 lines or fewer.

### Tests (money and the message pipeline are crucial)
- `budget`: a failing usage read with a limit set is limited; without a limit it is not.
- `relationsFor` gives the same relations as `relationFor` for 3 users.
- The `allowedArchives` cache returns the cached value within the TTL and refetches after it.

Put them next to the code, in the existing test files where possible.

### Allowed files
- `apps/server/src/contact-requests/search.ts`, `apps/server/src/contact-requests/reads.ts` (`relationFor` lives there), `apps/server/src/contact-requests/contact-requests.test.ts`
- `apps/server/src/push/api-handlers.ts`, `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/archives-cache.ts`, `apps/server/src/push/archives-cache.test.ts`
- `apps/server/src/agents/gateway/budget.ts`, `apps/server/src/agents/gateway/budget.test.ts`
- `work/T-1437-server-perf-batch.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/contact-requests src/push src/agents/gateway/budget --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- The new tests pass.
- No behaviour change except AI-15's fail-closed path.

---

## Report (written by the worker when done)

### What I did
- **SG-7:** Added `relationsFor(db, viewerId, otherIds[])` next to `relationFor` in `apps/server/src/contact-requests/reads.ts`. It resolves `self` first, then one batched `user_blocks`, one `contacts` and one `contact_requests` read over the whole set, and builds a `Map<userId, ViewerRelation>` with the same per-user answer and precedence as `relationFor` (`blocked` > `contact` > pending direction > `none`). Extracted the shared `ViewerRelation` union so both functions return the same type.
- `searchUsers` (`apps/server/src/contact-requests/search.ts`) now makes one `relationsFor` call for the page instead of one `relationFor` per row. Output order and content are unchanged (`?? 'none'` keeps the old default).
- **PERF-5:** Added `apps/server/src/push/archives-cache.ts` with `createArchivesCache` / `cachedAllowedArchives`: a 15 s TTL map (`ARCHIVES_CACHE_TTL_MS`), capped at 5,000 entries (`ARCHIVES_CACHE_MAX_ENTRIES`) with the oldest entry evicted first, keyed per database via a `WeakMap` (the map is also keyed by user id inside a database). Both push call sites (`push/api-handlers.ts:170`, `push/archive-scan.ts:62`) now call `cachedAllowedArchives`; search does not — `search/service.ts` is untouched, so routes/other callers keep the uncached `allowedArchives`.
- Membership-change invalidation: **not hooked**. Contacts, blocks, AI creation, group membership and topic visibility each change the scope from a different module, none of them in this task's Allowed files, so there is no single easy hook. The 15 s TTL alone is used, which the spec allows. `invalidate(db, userId)` exists on the cache for a future hook.
- **AI-15:** Added a private `limitsFor(db, aiId)` in `apps/server/src/agents/gateway/budget.ts` that reads only `ai_limits.per_day_usd` / `per_month_usd`. When a usage read fails, both gates now: (a) read the bounds; (b) fail **closed** (limited) and `logger.warn` when a daily or monthly bound is set; (c) keep the old fail-open path when a readable row shows no bound. An **unreadable** bound (the limit read also fails) counts as set, so a DB outage never lets a limited AI past its cap. `checkDailyLimit` still sends the fixed `dailyLimitReply` once per AI/chat/day on the fail-closed path; `checkDmRoundGate` returns the same fixed reply. `budget.ts` is 353 lines (≤ 400).

### Files changed
- `apps/server/src/contact-requests/reads.ts`, `search.ts`, `contact-requests.test.ts`
- `apps/server/src/push/archives-cache.ts` (new), `archives-cache.test.ts` (new), `api-handlers.ts`, `archive-scan.ts`
- `apps/server/src/agents/gateway/budget.ts`, `budget.test.ts` (new)
- `work/T-1437-server-perf-batch.md` (this file)

### Commands and real results
- `pnpm install` — done (14.5s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/contact-requests` — 1 file, **10 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/budget.test.ts` — 1 file, **4 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/archives-cache.test.ts` — 1 file, **2 passed**.
- `pnpm gate` (from repo root) — summary:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (3.1s)
  PASS  format  (3.4s)
  PASS  lint  (3.0s)
  PASS  typecheck  (14.0s)
  PASS  effect  (1.4s)
  PASS  tests @zilar/server  (28.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Tests added
- `contact-requests.test.ts`: `relationsFor` answers for `contact`, `request_sent`, `request_received`, `blocked`, `none` and `self` match `relationFor` one by one for all six users.
- `archives-cache.test.ts`: cached value served within the TTL and refetched at the boundary; per-user caching and oldest-first eviction past a cap.
- `budget.test.ts`: the usage read is mocked to fail; with a limit set `checkDailyLimit` is limited and sends one notice, `checkDmRoundGate` returns the limited reply, both logging at warn; with no limit both stay open.

### Deviations / notes
- `archives-cache.ts` starts with `// effect-plain: a small in-memory TTL cache; the Effect read it wraps stays in search/service.` This is the repo's sanctioned marker for a deliberately plain module; without it the Effect ratchet flags the new file's `async`/`await` (the cache contains no Effect code).
- Unreadable bound handling (limit read fails too → fail closed) is a judgement call made inside the spec's "fails closed" intent, not an explicit spec line. Money-safety wins over availability on an unknown bound.
- The cache is keyed by database and user id, not by config; config does not change at runtime, so this is not expected to matter.

### Open questions
- None blocking. If the lead wants membership-change invalidation wired, it needs an Allowed-file/hook outside this task's scope; say so and I can follow up.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 3.
- Local tests: contact-requests, push and budget (15 files, 94).
- SG-7: one batched `relationsFor`.
- PERF-5: a 15 s per-user `allowedArchives` cache for push only.
- AI-15: the budget gate fails closed when the AI has a limit, or when its limits can't be read; with no limit it keeps failing open.
