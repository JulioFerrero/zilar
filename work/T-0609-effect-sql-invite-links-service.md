---
id: T-0609
title: "effect/sql: invite-links/service.ts fully off drizzle; the join transaction (in-tx membership re-check, conditional claim UPDATE, room affiliation call, ON CONFLICT DO NOTHING insert, rollback on 404/503) keeps every race guarantee in its comment; caps and counts unchanged; tests unchanged"
status: merged
milestone: M5
branch: task/T-0609-effect-sql-invite-links-service
model: auto
effort: low
depends_on: [T-0596]
estimate: 1 day
---

# T-0609: the invite-link service on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example at `apps/server/src/pins/service.ts:179`. **No caller passes a transaction into this module**, which the lead checked with grep. `groups/join.ts:115` calls `syncPublicTopicsByLink(linkDeps, groupId)` with the deps' top-level `db`.

### Verified facts (do not re-derive; read the whole file, 548 lines, with 26 query sites)
**`joinByInviteLink`** (the comment at 365-387 is the contract; read it word by word). The fast path, before any transaction:
- `findLinkRow`, then `linkIsUsable`; a failure gives 404 `invalid_link`;
- the group by id;
- `isGroupMember`, which answers `alreadyMember: true` and consumes nothing;
- `assertGroupHasRoom`, which gives 409 `group_full`.

**The transaction (408-448), in this order:**
1. re-check the membership (`LIMIT 1`); if the user is already a member, return `false`;
2. `claimLinkUse(txDb, link.id, now)`, a conditional `UPDATE` that is the **at-most-`max_uses`** backstop; if nothing was claimed, throw 404 `invalid_link`;
3. `adminClient.setAffiliation(...)` (a network call inside the transaction, as today). A non-`HttpError` failure becomes **503 `xmpp_unavailable`**;
4. insert into `group_members` with `ON CONFLICT (group_id, user_id) DO NOTHING RETURNING`. No row means another writer won, so return `false`.

**Every thrown error inside the transaction must roll the claim back.** With `sql.withTransaction`, make sure both a typed failure and a thrown `HttpError` (a defect) roll back, and that the **same `HttpError`** reaches the caller with the same status and code. Read how pins and chat-folders surface errors from inside `withTransaction`.

**`claimLinkUse`** (find it) takes a database today, with `txDb` cast inside the transaction. As an effect/sql statement it simply runs inside the transaction; keep its `WHERE` exactly.

**Counts** (186, 306, 486, 491): use `count(*)::int AS total`. The comment at 482 accepts that the cap check runs before the transaction without a lock; keep that.

**The other exports** — `createInviteLink`, `listInviteLinks`, `revokeInviteLink`, `previewInviteLink`, `assertGroupHasRoom` and `syncPublicTopicsByLink` — keep their signatures and results.

**The recipe:** `sql.withTransaction`; a private `runSql(db, effect)`; `SqlError` maps to the module's existing errors; rows are camelCase through `snakeToCamel`, typed with the drizzle inferred types (type-only imports).

**Tests (all unchanged):**
- `apps/server/src/invite-links/*.test.ts` (including the race and claim tests);
- `apps/server/src/groups/*.test.ts`;
- the authz sweep (`authz-sweep`).

### What to build
1. Convert the whole file with every race guarantee in the 365-387 comment kept, and the same errors. It keeps no value import from `drizzle-orm` or `db/schema`.
2. In the Report, name the test that proves a 503 from the room call consumes no use. If none exists, say so; do **not** add one.
3. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section: transactions and race recovery), `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/pins/service.ts` (lines 150-230), `apps/server/src/chat-folders/service.ts` (lines 150-280) and `apps/server/src/invite-links/service.ts`.

### Allowed files
`apps/server/src/invite-links/service.ts`, `apps/server/src/invite-links/invite-links.test.ts` (the "loser of a same-user race" test only, per the lead 2026-10-08), `work/T-0609-effect-sql-invite-links-service.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot invite-links groups authz-sweep
pnpm gate
```

### Acceptance
- The invite-link service runs on effect/sql with the same join guarantees, errors and caps.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What was done

- `apps/server/src/invite-links/service.ts`: converted fully to `effect/sql`.
  - No value import from `drizzle-orm`/`db/schema` remains; only `import type { groupInviteLinks, groups }` and `import type { TopicRow } from '../topics/access'`.
  - Added the private `runSql<A, E>(db, effect)` (`sqlRuntimeFor(db).runPromise`), `SqlClient`/`SqlError`, `Effect`.
  - All 26 query sites are tagged-template statements with `count(*)::int AS total`; rows stay camelCase via the runtime's `transformResultNames`; inserted timestamps go in as ISO strings (same as `contact-requests`, `blocks`, `chat-folders`).
  - `joinByInviteLink` uses `sql.withTransaction`: same order (in-tx `LIMIT 1` membership re-check → conditional `claimLinkUse` → `setAffiliation` → `ON CONFLICT (group_id, user_id) DO NOTHING ... RETURNING`), the 365-387 comment is kept verbatim, and a typed `Effect.fail(toInvalidLink())` or a failing room call aborts the transaction so the claim rolls back.
  - `claimLinkUse(sql, linkId, now)` is now an effect on the transaction connection with the same `WHERE` (`revoked_at IS NULL`, expiry, `uses < max_uses`) and `uses = uses + 1`.
  - Room call: `Effect.tryPromise` whose `catch` returns the **same `HttpError`** when the client throws one and the fixed `503 xmpp_unavailable` otherwise, so the same status/code reaches the caller and the claim rolls back either way.
  - `createInviteLink`, `listInviteLinks`, `revokeInviteLink`, `previewInviteLink`, `assertGroupHasRoom`, `syncPublicTopicsByLink`, `joinUrlFor` keep signatures and results; caps, error codes and audit entries unchanged.
- `apps/server/src/invite-links/service.ts`: added the optional, test-only `beforeJoinTransaction?: () => Promise<void>` to `InviteLinkServiceDeps` (documented; production never sets it). `joinByInviteLink` awaits it after the pre-transaction checks (`findLinkRow` + usability, group, fast-path member check, `assertGroupHasRoom`) and immediately before `sql.withTransaction` — the point where the old test parked the drizzle transaction.
- `apps/server/src/invite-links/invite-links.test.ts`: re-seamed only the test "the loser of a same-user race answers alreadyMember and consumes no use" (lead's option 1, following the T-0519 `contact-requests` precedent). It no longer monkey-patches `db.transaction`; it calls `joinByInviteLink(deps, link.token, friend.id)` directly, with deps built from the test context (`context.db`, `context.adminClient`, `TEST_XMPP_DOMAIN`, `context.logger`) and the seam set on the first call only. The comment explaining why PGlite cannot run a true interleave is kept. The HTTP status/body checks became checks on the returned values; the membership-count and `uses === 1` assertions are unchanged. No other test changed.

### The join transaction and rollback

Inside `sql.withTransaction`: (1) `SELECT user_id ... LIMIT 1` re-check; (2) `claimLinkUse` conditional `UPDATE ... RETURNING id` (same `WHERE`); (3) `adminClient.setAffiliation` through `Effect.tryPromise`; (4) `INSERT ... ON CONFLICT (group_id, user_id) DO NOTHING RETURNING user_id`. A typed 404 (`Effect.fail(toInvalidLink())` when the claim wins no row) and a failing room call both abort the transaction, so the claimed use is refunded. `@effect/sql-pg` has no `fromClient`, so the runtime cannot be bound to a drizzle transaction; the join is one effect/sql transaction on one connection in both PGlite and production.

### Report item 2 (503 consumes no use)

The test exists: `apps/server/src/invite-links/invite-links.test.ts:494` — `it('a failing room call answers 503 without burning the use')` (asserts 503 `xmpp_unavailable`, `uses === 0`, no membership, and that the link still works afterwards). No test was added.

### Commands and real results

- `pnpm install` — done.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/invite-links/invite-links.test.ts` — **1 file passed, 21 passed** (after the re-seam).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot invite-links groups authz-sweep` — **4 files passed, 106 passed**.
- `pnpm gate` (repo root) — the first run FAILed `format` on `service.ts`; fixed with `pnpm exec prettier --write apps/server/src/invite-links/service.ts`. Final run:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (2.1s)
PASS  format  (26.9s)
PASS  lint  (0.7s)
PASS  typecheck  (1.0s)
PASS  tests @zilar/server  (256.4s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / open questions

- The only test change is the one the lead allowed; `apps/server/src/invite-links/invite-links.test.ts` was added to the Allowed files in its own commit (`T-0609: lead allows the invite-links race test in scope`) before this change.
- `beforeJoinTransaction` is a test-only seam with the same shape as `contact-requests`' `onInsert`/`onRecovery`; it is never set in production.
- No new dependency.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (17:43) is newer than HEAD 7fb23a01.
- **Lead check:**
  - the only test change is the lead-allowed one: the race test now calls `joinByInviteLink` directly, through the test-only `beforeJoinTransaction` seam;
  - its five checks keep their meaning (parked once, second joins, first is `alreadyMember`, one membership, one use);
  - the 503 no-burn test exists (`invite-links.test.ts:494`);
  - the gate passes.
