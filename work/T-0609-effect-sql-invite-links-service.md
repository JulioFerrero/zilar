---
id: T-0609
title: "effect/sql: invite-links/service.ts fully off drizzle; the join transaction (in-tx membership re-check, conditional claim UPDATE, room affiliation call, ON CONFLICT DO NOTHING insert, rollback on 404/503) keeps every race guarantee in its comment; caps and counts unchanged; tests unchanged"
status: todo
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
`apps/server/src/invite-links/service.ts`, `work/T-0609-effect-sql-invite-links-service.md`.

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

## Review (written by Claude)
