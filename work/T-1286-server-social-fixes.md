---
id: T-1286
title: "Server social-graph fixes: a person the owner blocked or removed can't rejoin by public join or invite link (SG-8); a failed sign-up no longer burns an invite use (SG-9); people search stops enumerating by display-name prefix (SG-7); tested"
status: merged
milestone: M5
branch: task/T-1286-server-social-fixes
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1286: Joins respect blocks, invites survive failed sign-ups, search by handle

## Spec (written by Claude, do not edit)

### Why
`docs/audit/social-graph-audit.md`:
- **SG-8** (P2, `:109`): `joinPublicGroup` (`apps/server/src/groups/join.ts`) and `joinByInviteLink` (`apps/server/src/invite-links/join.ts`) check only visibility, link validity and the cap. A user the group owner has **blocked** can join; and since `removeGroupMember` deletes the row, a removed person can rejoin with the same link.
- **SG-9** (P2, `:145`): `databaseHooks.user.create.before` runs `consumeInvite` (`apps/server/src/auth/auth.ts`, with `uses = uses + 1` in `invites.ts`) **before** Better Auth inserts the user, so a failed insert keeps the use.
- **SG-7** (P2, `:157`): `searchUsers` (`apps/server/src/contact-requests/search.ts`) matches `lower(u.name) LIKE` prefixes over every user with a handle, so anyone can enumerate people by name.

**First recheck each finding on main** (line numbers moved). For any already fixed, say so with `file:line` and skip it.

### What to build
1. **SG-8:**
   - both joins refuse when the joiner and the group owner have a block in either direction (use the existing blocks table or helper; cite it), with the same error shape the routes use today for a refused join;
   - **removals:** if a "removed members" record exists, honour it. If none exists, **don't add a schema in this task**: say so in the Report, so the lead can plan a migration.
2. **SG-9:** consume the invite only after the user row exists (`databaseHooks.user.create.after`, or the same transaction), keeping the check that the invite is valid **before** the insert so an invalid invite still refuses sign-up. Cite both hooks.
3. **SG-7:** search matches only by handle (an exact handle, or a prefix of 3 or more characters), not by display name, and keeps the existing result shape. If the web or mobile search UI says "name", leave the UI alone: list it in the Report.
4. **Tests** (permissions and auth), up to 4, in the nearest existing test files (cite them):
   - a blocked user can't join a public group, and can't join by link;
   - a failed user insert leaves `uses` unchanged;
   - a name-only query returns nothing.

### Read first
`AGENTS.md`, `docs/audit/social-graph-audit.md` (`:32-42`, `:109-160`), `apps/server/src/groups/join.ts`, `apps/server/src/invite-links/join.ts`, `apps/server/src/auth/auth.ts`, `apps/server/src/contact-requests/search.ts` and the blocks module (find it).

### Allowed files
`apps/server/src/groups/*.ts`, `apps/server/src/invite-links/*.ts`, `apps/server/src/auth/*.ts`, `apps/server/src/contact-requests/*.ts`, `apps/server/src/blocks/*.ts`, `work/T-1286-server-social-fixes.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups src/invite-links src/auth src/contact-requests --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. No migration.

---

## Report (written by the worker when done)

### What I did

I rechecked all three findings on `main` first; all were still present.

**SG-8 — joins respect blocks.** Confirmed on `main`: `joinPublicGroup` (`apps/server/src/groups/join.ts`) and `joinByInviteLink` (`apps/server/src/invite-links/join.ts`) checked only visibility, link validity and the cap.
- Added `pairHasBlock(db, userId, otherId)` in `apps/server/src/blocks/service.ts` — the same either-direction `user_blocks` read as `isDmBlocked` (`blocks/service.ts:70-98`).
- Added `groupOwnerId(db, groupId)` in `apps/server/src/groups/queries.ts` (the single `group_members` row with role `owner`).
- Both joins now refuse when a block exists in either direction between the joiner and the owner, using the error shape each route already uses for a refused join: `joinPublicGroup` → 404 `not_found` "Group not found" (same as private/unknown); `joinByInviteLink` → `toInvalidLink()` 404 `invalid_link`. A refusal writes nothing and consumes no invite use.
- **Removals:** there is no "removed members" / ban record anywhere (searched the schema and migrations: no such table or column; `removeGroupMember` deletes the `group_members` row at `groups/members.ts:163-164`). Per the spec I did **not** add a schema. A removed person can still rejoin a public group or a still-valid link until a migration adds a removal/ban record. Flagged for the lead to plan the migration.

**SG-9 — a failed sign-up no longer burns an invite use.** Confirmed on `main`: `databaseHooks.user.create.before` ran `consumeInvite` before Better Auth inserted the user. Now `before` only validates with `findUsableInvite` (an invalid/expired/used-up invite still refuses with 400 before the insert) and `after` consumes with `consumeInvite`, so a use is spent only once the user row exists. A lost race (another sign-up took the last use) only logs a warning; it never fails sign-up. Both hooks cited: `apps/server/src/auth/auth.ts` (`create.before` and `create.after`); the atomic conditional UPDATE is unchanged in `apps/server/src/auth/invites.ts:89-105`.

**SG-7 — search by handle only.** Confirmed on `main`: `searchUsers` matched `lower(u.name) LIKE 'xyz%'` / `'% xyz%'`. Dropped both display-name clauses; a query now matches an exact handle or a handle prefix (3+ characters, unchanged minimum). The result shape (`userId`, `name`, `handle`, `image`, `relation`), the self/block exclusions and the 10-row cap are unchanged; ordering is exact handle first, then by name. Updated the stale route comment in `contact-requests/api.ts`.

**UI copy:** the people-search UI does not say "name" — web `SearchBar.tsx` and mobile `search-header.tsx` say "Search, or type @username", `AddContactDialog` says "Type their @username". The "Search by name or @handle" placeholders in `ExplorePage.tsx` / mobile `explore.tsx` belong to the group **directory** search (a different endpoint), so they are left alone. No UI change made.

### Files changed
- `apps/server/src/blocks/service.ts` — new `pairHasBlock`.
- `apps/server/src/groups/queries.ts` — new `groupOwnerId`.
- `apps/server/src/groups/join.ts` — block refusal on public-group join.
- `apps/server/src/invite-links/join.ts` — block refusal on link join.
- `apps/server/src/auth/auth.ts` — validate in `create.before`, consume in `create.after`.
- `apps/server/src/contact-requests/search.ts` — handle-only query.
- `apps/server/src/contact-requests/api.ts` — comment only.
- Tests: `groups/visibility.test.ts`, `invite-links/invite-links.test.ts`, `auth/auth.test.ts`, `contact-requests/contact-requests.test.ts`.
- `work/T-1286-server-social-fixes.md` — this report.

### Tests added (in the nearest existing files)
- `groups/visibility.test.ts`: "refuses a join by a user the owner blocked (T-1286, SG-8)" — 404 `not_found`, no membership written.
- `invite-links/invite-links.test.ts`: "refuses a link join by a user the owner blocked, consuming no use (T-1286, SG-8)" — 404 `invalid_link`, `uses` stays 0.
- `auth/auth.test.ts`: "(T-1286, SG-9) a failed user insert leaves the invite use unchanged" — forces the insert to fail (test-only CHECK constraint on one sentinel email), asserts no user row and `uses` 0.
- `contact-requests/contact-requests.test.ts`: "returns nothing for a display-name-only match (T-1286, SG-7)"; and the existing prefix test was updated to handle-only expectations.

### Commands run (real results)
- `pnpm install` — done (pnpm 10.32.1).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/contact-requests/contact-requests.test.ts` — 9 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/visibility.test.ts` — 26 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/invite-links/invite-links.test.ts` — 22 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/auth.test.ts` — 37 passed.
- `pnpm --filter @zilar/server exec vitest run src/groups src/invite-links src/auth src/contact-requests --reporter=dot --maxWorkers=2` — 16 files, 145 passed.
- `pnpm gate` (repo root):
  ```
  PASS  install (frozen)  (1.1s)
  PASS  format  (0.7s)
  PASS  lint  (0.9s)
  PASS  typecheck  (5.1s)
  PASS  effect  (3.0s)
  PASS  tests @zilar/server  (46.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Problems / deviations / open questions
1. **No removed-members schema** (SG-8 removal half): no ban/removal record exists, and the spec said not to add one. The "removed member can rejoin" half is therefore unfixed; it needs a migration the lead should plan.
2. **SG-9 race:** consuming in `after` (the spec's option) keeps the atomic `uses` cap (uses never exceeds `max_uses`), but in a race where two sign-ups both pass `before` holding the last use, both user rows can be created and only one use is consumed — the pre-insert claim was the stronger gate. The existing test "(d) lets exactly one of two concurrent sign-ups consume the last use" still passes on PGlite (no regression reproduced here), but I am flagging it because it is a real weakening of the invite cap under a real-Postgres race.
3. The SG-9 test forces the insert failure with a test-only CHECK constraint on the `user` table; it exercises the real hook order (validate in `before`, insert fails, `after` never runs).

### Security checklist
- A block refusal is the same 404 a private/unknown group or an unusable link answers, so a block is never an oracle; the refusal writes nothing and consumes no invite use.
- No secrets in logs: the search query is still never logged, and the invite code stays redacted by request logging.
- No new routes, so no new 401/rate-limit surface; existing join rate limits are unchanged.

### Round 2 (fix round)

Findings fixed: **finding 1 (should-fix), the SG-9 race.** I implemented the spec's other option — the *same-transaction* consume — instead of accepting the weakening.

- The invite is now consumed **inside the same `sql.withTransaction` as the user insert**, in the SQL adapter's `create` (`apps/server/src/auth/sql-adapter.ts`). `create.before` validates the invite (so an invalid/expired/used-up code still refuses sign-up) and hands the code to the adapter through a per-auth `pendingInviteCodes` map keyed by the lowercased email (`apps/server/src/auth/auth.ts`).
- Consequences: a failed insert rolls the consume back (SG-9 preserved), and two racing sign-ups serialize on the invite row, so the loser's conditional `UPDATE ... WHERE uses < max_uses` returns no row and its sign-up is refused with the existing 400 — the cap can no longer be exceeded. The `after`-hook consume was removed.
- `consumeInvite` in `apps/server/src/auth/invites.ts` was refactored to expose `consumeInviteEffect(code)` so the adapter can run the atomic UPDATE on the ambient `SqlClient` (the transaction connection); the exported `consumeInvite` is unchanged in behaviour for its other callers.
- The `effectSqlAdapter` signature gained the `pendingInviteCodes` map; its two call sites in `sql-adapter.test.ts` pass `new Map()`.

Tests: adjusted `auth/auth.test.ts` SG-9 test to also prove the untouched use is still spendable — after the forced insert failure (`uses` 0, no user), a later sign-up with the same invite succeeds and consumes it exactly once (`uses` 1). The existing `(d)` concurrent-sign-up test is unchanged and passes.

Nits 2–4 were not touched (not in lines I changed). No "Disagreements".

Gate (repo root), after `prettier --write apps/server/src/auth/sql-adapter.ts`:
```
PASS  install (frozen)  (5.3s)
PASS  format  (4.5s)
PASS  lint  (2.1s)
PASS  typecheck  (9.9s)
PASS  effect  (2.7s)
PASS  tests @zilar/server  (68.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```
Single tests run: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/auth.test.ts` (37 passed) and the task Checks (`pnpm --filter @zilar/server exec vitest run src/groups src/invite-links src/auth src/contact-requests --reporter=dot --maxWorkers=2`, 16 files, 145 passed).

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (2 nits, 1 follow-up).**
- **Lead's reading of SG-9 (auth):**
  - `create.before` validates with `findUsableInvite` and hands the code to the SQL adapter, which consumes it and inserts the user in one `withTransaction`;
  - a failed insert rolls the use back, and concurrent sign-ups serialize on the invite row;
  - the after-hook's contact setup reads the invite with `findInviteByCode` (no usability filter), so a single-use invite still links the inviter;
  - a leftover pending entry is harmless: every sign-up needs a code, and the before-hook overwrites the entry for that email.
- **Lead's checks after the rebase:** server vitest (groups, invite-links, auth, contact-requests, blocks): 17 files, 148 tests pass. server tsc: 0 errors.
- **Follow-up:** SG-8's removal half needs a removed-members record, which is a migration. It's planned as its own schema task.
