---
id: T-1184
title: "PERF-5 (first step): the per-push archive scan computes the user's allowed rooms with one batched topic-visibility pass (T-1175's visibleTopicsForGroups) instead of one query set per group, and the mute check reads both chat_prefs rows in one query — same rules, no cache"
status: merged
milestone: M5
branch: task/T-1184-push-scan-batched
model: auto
effort: default
depends_on: [T-1175]
estimate: 0.2 day
---

# T-1184: Fewer queries per push

## Spec (written by Claude, do not edit)

### Why
`docs/audit/performance-audit.md` PERF-5 (P1, confirmed).
- **Every push publish IQ** (one per device per message) runs `newestMessageForUserEffect` (`apps/server/src/push/archive-scan.ts`).
- **It first calls `allowedArchives`** (`apps/server/src/search/service.ts`), which calls `visibleTopics` once **per group** (`search/service.ts:128-134`): the same N+1 that PERF-4 removed from `/api/chats` with `visibleTopicsForGroups` (`apps/server/src/topics/visible-batch.ts`, T-1175, merged).
- **The mute check reads `chat_prefs` twice:** `isMuted` (`apps/server/src/push/candidates.ts:141-176`) reads it for the topic, then for the group's General room.
- **The lead decided: no cache of `allowedArchives`.** A cache would keep sending a removed member's push previews for up to its TTL.

### What to build
1. **`search/service.ts`:** replace the per-group loop (`:128-134`) with one `visibleTopicsForGroups(db, groups.map(g => g.id), userId)` call, keeping the exact rooms list: each group's General room, then its visible topics. Search uses the same function, so search gets faster too.
2. **`candidates.ts` `isMuted`:** one query, `WHERE user_id = $1 AND chat_jid IN (chatJid, generalJid)`, with the same precedence: the chat's own row wins when present; otherwise the General row.
3. **Tests:** no new tests. The existing pipeline tests must pass: `apps/server/src/push/candidates.test.ts` and `apps/server/src/push/delivery.test.ts`, plus any `search` test.

### Read first
`AGENTS.md`, `docs/audit/performance-audit.md` (PERF-5), `apps/server/src/search/service.ts`, `apps/server/src/topics/visible-batch.ts`, `apps/server/src/push/archive-scan.ts` and `apps/server/src/push/candidates.ts`.

### Allowed files
`apps/server/src/search/service.ts`, `apps/server/src/push/candidates.ts`, `work/T-1184-push-scan-batched.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/candidates.test.ts src/push/delivery.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report states the query count per push scan, before and after, for a user in N groups.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/search/service.ts`: `allowedArchives` no longer loops `visibleTopics` per group. It now makes one `visibleTopicsForGroups(db, groups.map(g => g.id), userId)` call (T-1175) and rebuilds the same rooms list per group, in the same order: the group's General room first, then its visible topics. The `visibleTopics` import was replaced by `visibleTopicsForGroups`.
- `apps/server/src/push/candidates.ts`: `isMuted` reads `chat_prefs` once with `WHERE user_id = $1 AND chat_jid IN (chatJid, generalJid)` (the General JID is only added when it differs from the chat JID). Precedence is unchanged: the chat's own row wins when present, otherwise the General row decides; no row at all is not muted.
- No new tests, per the spec.

### Files changed
- `apps/server/src/search/service.ts`
- `apps/server/src/push/candidates.ts`
- `work/T-1184-push-scan-batched.md`

### Query count per push scan, user in N groups
One publish IQ runs `newestMessageForUserEffect`, which calls `allowedArchives` once and `resolveCandidate` once per candidate row.
- `allowedArchives`, before: 3 fixed queries (contacts, AIs, `listGroupsForUser`) + per group a `visibleTopics` pass = 1 topics + 1 membership, + 2 more (topic_members, topic_role_access) when the group has any private topic. That is `3 + 2N` (no private topics) up to `3 + 4N`.
- `allowedArchives`, after: 3 fixed + one `visibleTopicsForGroups` = 4 queries, or 6 when any private topic exists across the groups. Constant in N.
- `isMuted`, before: 1 query when the chat has its own row or is a General room, 2 when a topic has no own row (its own row then the General row). After: exactly 1 query in every case.
- Per scan total: before `~3 + 2N..4N` plus 1-2 mute queries per candidate row; after `4 or 6` plus exactly 1 mute query per row. For a user in 10 groups with no private topics and M candidate rows that is ~23 + 1-2M queries before versus ~4 + M after.

### Commands and results
- `pnpm install` — done (14.5s, peer-dependency warning for `@types/react-dom` in `apps/mobile`, unrelated to this change).
- `pnpm --filter @zilar/server exec vitest run src/push/candidates.test.ts src/push/delivery.test.ts --maxWorkers=2 --reporter=dot` — 2 test files passed, 12 tests passed.
- `pnpm exec prettier --write apps/server/src/push/candidates.ts` — run once after the first gate flagged a format issue on that file; the second gate is clean.
- `pnpm gate` (repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.9s)
  PASS  lint  (1.5s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (6.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- None. No new tests (spec says so). No cache of `allowedArchives` was added, as the lead decided.

### Open questions
- None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 nit.**
- **`allowedArchives`** uses one `visibleTopicsForGroups` pass, so the room order per group is unchanged: General first, then the visible topics. Search benefits too.
- **`isMuted`:** one `chat_prefs` read over both JIDs; the chat's own row wins, then General.
- **No cache,** as the lead decided, so a removed member gets no previews.
- **Tests:** the pipeline tests (candidates and delivery), 12 of 12 in the branch, run by the lead.
