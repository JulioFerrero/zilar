---
id: T-0164
title: Public and private groups and channels (handles, directory, open join)
status: review
milestone: M5
branch: task/T-0164-public-groups-and-channels
model: meta/muse-spark-1.3-contributor
effort: high
depends_on: [T-0163]
estimate: 2 days
---

# T-0164: Public and private groups and channels (handles, directory, open join)

## Spec (written by Claude, do not edit)

### Why
Groups and channels (`groups.kind` is `group` or `channel`) exist, but they are all private: members are added by an admin or through an invite link, and nothing can be found or joined by someone who is not already inside. Julio wants both **private** and **public** groups and channels. A public one has its own `@handle` (the same namespace as `@usernames` from T-0163), can be found in a directory and joined with one tap. A private one stays exactly as it is today: invisible and invite-only.

### What to build

**1. Data (server, one migration).**
- `groups.visibility text not null default 'private' check in ('private','public')`. Every existing group stays private.
- No new handle table: use the `handles` table from T-0163, which already has the `group_id` column and its exactly-one check. A public group has exactly one handle row; a private group has none.
- Member counts are computed from `group_members` (no new column).

**2. Rules.**
- A group can be made public only by its owner, and needs a valid handle (T-0163 rules, same reserved words, same case-insensitive uniqueness through the primary key; `handle_taken` / `handle_invalid` / `handle_reserved`).
- Public to private: the handle row is moved to `retired_handles` (reserved 30 days for this group), members stay members, the group disappears from the directory at once. Private to public again may reuse the reserved handle. A handle can be changed at most once every 14 days (same rule as users).
- A **public channel** keeps the channel rule: only owner and admins post, members read. A **public group** lets members post according to the existing roles.
- Joining a public group or channel is **open**: any signed-in user may join with one request, no invite. Joining reuses the existing function that adds a member and the XMPP room affiliation (see `invite-links/service.ts` `joinByInviteLink` and `groups/service.ts` `addGroupMembers`); do not duplicate the XMPP logic. A user already in the group gets the same answer as a success (idempotent). Leaving works as today.
- Approval-based joining, banning, reports and public message preview before joining are explicitly out of scope (listed below).

**3. API (server, session required, rate limited, audit with ids only).**
- `PATCH /api/groups/:id` (existing route) gains `visibility` and `handle`. Only the owner may change them; non-owners and non-members get the same 404/403 as the other group settings today (follow the existing pattern in that route). The change is one transaction: handle insert or retire, visibility update, unique violation mapped to 409 `handle_taken`, interval rule 409 `handle_change_too_soon` with `nextChangeAt`.
- `GET /api/handles/check?handle=&kind=group` (extends T-0163's route) says whether a handle is free for a group.
- `GET /api/directory?q=&kind=&cursor=`: searches **public groups and channels only**, by handle or title prefix (case-insensitive), `q` at least 2 characters, optional `kind` filter, 20 per page with a cursor, newest first when `q` is empty. Returns `{ id, kind, title, handle, description, memberCount, joined: boolean }` per row. Never returns users, never private groups. 30 requests per 10 minutes per user.
- `GET /api/groups/by-handle/:handle`: exact match of a public group, same shape as one directory row. A private group and an unknown handle answer the same 404.
- `POST /api/groups/:id/join` for public groups only (private or unknown: same 404). 30 per hour per user. Capped by an existing member limit if the project already has one; if not, add a constant `PUBLIC_GROUP_MAX_MEMBERS` of 5000 and answer 409 `group_full` beyond it, counted atomically inside the join transaction.
- The group detail responses already shown to members gain `visibility` and `handle` (null for private).

**4. Web.**
- Create flow (`NewGroupDialog` and the channel creation): a **Private / Public** choice (default Private). Public asks for a handle with the live availability check from T-0163 and a one-line description.
- Group settings (owner): visibility switch with a confirmation explaining what public means ("Anyone can find and join this group"), handle with live check and the "next change possible on" message, copy button for the share link `<origin>/@handle`.
- **Explore** (an overlay or page reachable from the chat list, the + new chat menu and the empty state): a search box and a Groups / Channels filter, a list with title, `@handle`, description, member count and a Join button (or Open when already joined). Empty state and error state are real messages, not blank.
- The route `/@handle` (T-0163) resolves a person or a public group: a group opens a card with title, description, member count and Join. Logged out goes to login and comes back.
- Show a small "Public" label next to the title of public groups in the group header and list. Match the neighbouring components. Vitest + Testing Library tests for every new component and flow.

**5. Docs.** Nothing beyond comments; no install-guide change.

### Read first
`AGENTS.md` (the whole security checklist), `work/T-0163-usernames-and-contact-requests.md` (the handle rules, table and the Report once merged), `work/T-0124-*.md` (channels), `work/T-0115-*.md` (invite links), `apps/server/src/groups/service.ts` and `routes.ts`, `apps/server/src/invite-links/service.ts`, `apps/server/src/db/schema.ts` (groups, group_members, handles), `apps/server/src/rate-limit.ts`, `apps/server/src/authz-sweep.test.ts`, `apps/web/src/components/NewGroupDialog.tsx`, the group settings components, `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/lib/api.ts`.

### Allowed files
`apps/server/src/directory/**` (new), `apps/server/src/groups/**`, `apps/server/src/handles/**` (extend), `apps/server/src/invite-links/service.ts` (only to export what joining needs), `apps/server/src/db/schema.ts` and exactly one new migration (+ journal and snapshot), `apps/server/src/app.ts`, `apps/server/src/authz-sweep.test.ts`, the web files for create flow, settings, Explore, the `/@handle` group card, labels, `apps/web/src/lib/api.ts` and its test, `work/T-0164-public-groups-and-channels.md`. No new dependencies, no mobile.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2 src/directory src/groups src/handles src/invite-links src/authz-sweep.test.ts
pnpm --filter @zilar/web test --maxWorkers=2 src/routes src/components src/lib/api.test.ts
```

### Acceptance
- An existing group is still private and behaves exactly as before (existing group tests pass unchanged).
- The owner makes a group or channel public with a handle; it appears in Explore search by title or handle prefix; another user joins with one tap and can read (and post, in a public group); a private group never appears in any directory or lookup result and answers the same 404 as an unknown handle.
- Two groups (or a group and a user) choosing the same handle at the same moment: exactly one wins.
- Making a group private again removes it from the directory immediately, keeps its members, and reserves the old handle for 30 days.
- Joining twice is harmless; joining a full group is refused atomically (concurrent joins never exceed the cap).
- Every new route is in the 401 sweep and rate limited; audit entries carry ids only; no response ever lists users.

### Out of scope
Join requests that an admin approves, banning users from a public group, reporting abuse, previewing a channel's messages before joining, a "featured" or trending list, public groups for AIs, mobile.

---

## Report (written by the worker when done)

Done. Public and private groups and channels work end to end: the owner flips a group/channel public with a `@handle` (same namespace as `@username`s), it appears in Explore search, another user joins with one tap, going private hides it at once while keeping members and reserving the handle 30 days.

**Server** (`apps/server/src/`):
- `db/schema.ts` + migration `0036_loose_wendell_vaughn.sql` (one migration only, journal + snapshot, prettier-written like T-0124): `groups.visibility` (`private`/`public`, default `private`; every existing group stays private). No handle-table change — the T-0163 `handles.group_id` column + exactly-one check is reused as specced.
- `groups/visibility.ts` (new): `setGroupVisibility` in one tx under a per-group advisory lock (all decision rows read INSIDE): owner-only (non-owner/stranger = same 404 as missing, like `changeMemberRole`), public needs a valid handle (`handle_invalid` 400 / `handle_reserved` / `handle_taken` 409, same rules/reserved words/case-insensitive PK as users), same-handle is a no-op (casing-only change obeys the 14-day interval, updates casing, retires nothing — like users), 14-day interval on changes (409 `handle_change_too_soon` + `nextChangeAt`), public→private moves the handle row to `retired_handles` (30-day reservation for this group; reclaimable), plus `handleForGroup`. Audits `group.visibility_changed` (ids only) from the route after commit.
- `groups/join.ts` (new): `joinPublicGroup` — open join for public groups only (private/unknown = same 404). Reuses the invite-link join pieces (`syncPublicTopicsByLink`, same room affiliation + direct invitation + audit shape, new action `group.joined_public` ids-only) without duplicating XMPP logic; `addGroupMembers`/`joinByInviteLink` are not reused because they enforce the contacts/manager/link-claim rules that don't apply (same reason T-0115 didn't reuse `addGroupMembers`). Idempotent (`alreadyMember: true`). Cap `PUBLIC_GROUP_MAX_MEMBERS` 5000 (people+AIs share it via one `countOccupants` helper used by the pre-check and the tx alike): refused before the tx, and the tx takes a per-group `pg_advisory_xact_lock` BEFORE counting (same style as `visibility.ts`), so concurrent joins serialize and never exceed the cap. Test-only `maxMembers` seam on the service deps (route uses the default).
- `groups/service.ts`: `GroupDetail` + `ChatGroup` gain `visibility`/`handle` (null while private); `createGroup` accepts `visibility`+`handle` (public create claims the handle in the same tx, `handle_taken` on a race; validated up front for shape/reserved). `directory/service.ts` (new): `searchDirectory` (public only, handle/title prefix case-insensitive with LIKE-escaping, q>=2 chars, kind filter, 20/page newest-first cursor, exact-handle-first in-page ranking, counts from `group_members`, `joined` per row) + `publicGroupForHandle` (exact case-insensitive; users/private/unknown = same 404) + `PUBLIC_GROUP_MAX_MEMBERS`.
- Routes: `PATCH /groups/:id` gains `visibility`+`handle` (owner-only 404 path; other settings keep the 403 pattern; `visibility` without `handle` value pairing validated); `POST /groups/:id/join` (30/hr per user); `GET /directory` + `GET /groups/by-handle/:handle` (30/10min per user, shared limiter); `GET /handles/check?kind=group` via new `checkGroupHandleAvailability` (own group reservation reads available). `POST /groups` accepts `visibility`+`handle`. `chats/routes.ts` entries gain `visibility`+`handle`. `app.ts` mounts the directory router. `invite-links/service.ts`: only `export` added on `syncPublicTopicsByLink` + `assertGroupHasRoom` (no behavior change).
- Tests `groups/visibility.test.ts` (22): private-by-default, one-request public create (+taken race on create, private+handle 400), owner make-public + directory by handle/title prefix, non-owner same-404, invalid/reserved/taken (incl. a user's handle), two-racing-groups one-winner + group-vs-user race one-winner (shared PK decides across the two locks), private-again (immediate hide, members kept, stranger refused, owner reuses), 14-day `nextChangeAt`, one-tap idempotent join + member room affiliation + private/unknown same-404 (code+message equality), by-handle exact/case-insensitive/no-prefix/users-share-404/private-shares-404, q>=2 + kind filter + newest-first cursor, LIKE-wildcard escaping, `kind=group` check, audits ids-only (asserts no handle/title text), public channel join keeps subscriber rule (empty audience, member row, public detail), raw-SQL visibility CHECK rejection (+ both legal values write), 401 on new routes. New `join cap` block (service-level, injectable cap): two simultaneous joins at the last seat → exactly one wins + 409 `group_full` + member rows never exceed the cap (3/3 stable runs); AIs count toward the cap in pre-check and tx (AI fills the last seat, then refuse; AIs-alone-full refuses with rows unchanged).

**Web** (`apps/web/src/`):
- `lib/api.ts`: `visibility`/`handle` on group entries + details (optional → older servers parse), `searchDirectory`/`lookupGroupByHandle`/`joinPublicGroup`/`setGroupVisibility`/`checkGroupHandle` + zod schemas.
- Create flow: `NewGroupDialog` Private/Public choice (default Private) for groups and channels; public asks handle (live `kind=group` check) + one-line description (groups too). Channel create passes visibility/handle through (fixed mid-task: first version silently dropped them in channel mode). Tests `NewGroupDialog.test.tsx` (3, new): default-private call shape, public call shape, no-handle refusal. `NewChatButton.test.tsx` + `Channels.test.tsx` assertions updated for the new call args.
- Settings: `VisibilitySection.tsx` (new, in `GroupPanel` + `ChannelPanel`, owner only): switch with public-explainer ("Anyone can find and join…"), private confirmation (leaves-at-once + members-stay + 30-day reservation), handle live check, `nextChangeAt` message, copy share link `<origin>/@handle`. Tests (6, new).
- Explore: `ExplorePage.tsx` (new, overlay): search (debounced, 2-char min, empty = newest), Groups/Channels filter, rows (title, @handle, description, count, Join/Open), Show more, real empty/error states with Retry. Reachable from chat-list menu ("Explore groups"), + new chat menu, empty state (`EmptyState onExplore`). Tests (6, new).
- `/@handle` (`GroupHandleRoute.tsx`, new, via `AtHandleGate`): logged in resolves group card (title, description, count, Join/Open; channel wording); only a 404 falls back to Add contact — 500/429/network show an error card with Retry (never a contact prompt against a group handle); while checking, the prefilled Add contact dialog shows at once (no flash for persons). Logged out → login → back. `/u/:handle` unchanged (persons only). Tests (7, new: card, Open-when-joined, person fallback, 500/429/network error + Retry re-runs lookup, guest→login stub). T-0163's `HandleGate.test.tsx` `/@handle` test now pins the 404 fallback via a partial api mock (the route does a group lookup first; offline fetch would otherwise error).
- Labels: `PUBLIC` tag next to the title in `ChatListItem` + `ChatHeader` (same tag style as `CHANNEL`); store maps `visibility`/`handle` from entries (incl. topic rows). Tests in `ChatListItem.test.tsx` + `ChatView.test.tsx`.
- Mock: `c-acme` channel seeded public `@acme`; `chatEntries` carries visibility/handle; mock `GET /directory` (real base64url offset cursor, parsed back; bogus cursor 400), `GET /groups/by-handle/:handle`, `POST /groups/:id/join`, PATCH visibility/handle (taken/invalid/reserved mapping), `handles/check?kind=group` reports `acme` taken. `mock.test.ts` gains a directory block: 21 public groups page 20 + cursor → 1 with no repeats, bogus cursor 400, seeded `@acme` exact lookup.
- `lib/api.test.ts`: new `public groups API` block (6 tests: paths, methods, bodies).
- Store: `createGroup`/`createChannel` options, `setGroupVisibility` (refreshes detail + list), `joinPublicGroup` (joins, refreshes, returns General chat id); mock store implements `setGroupVisibility` via mock PATCH. Test ApiClient stubs extended.

**Commands (real results):**
- `pnpm install`: exit 0.
- `pnpm format:check`: pass ("All matched files use Prettier code style!", incl. prettier-written drizzle meta).
- `pnpm lint`: pass (fixed 3 findings: sync setState-in-effect in ExplorePage moved into the timeout callback, unused import, no-useless-spread).
- `pnpm typecheck`: pass (11 tasks; fixed ApiClient stub gaps + guest-auth shape).
- Migration `0036` now carries `CHECK (visibility IN ('private','public'))` on the column (schema uses an explicit `check()`, folded into 0036 in place since unmerged; `db:generate` confirms "No schema changes"; snapshot id/chain kept, prettier-written).
- Server: `src/directory src/groups src/handles src/invite-links src/authz-sweep.test.ts` — 6 files, 108 passed (sweep: `/api/directory`, `/api/groups/by-handle/:handle`, `/api/groups/:id/join` all 401, no allowlist change). Neighbours `src/chats src/contact-requests src/auth`: 8 files, 115 passed.
- Web: `src/routes src/components src/lib/api.test.ts` — 77 files, 777 passed; `src/store src/mock src/auth` — 240 passed.
- Not run: full `turbo test` / `pnpm build` (per AGENTS.md the lead runs full suites).

**Security checklist:** no secrets in new responses/logs/audits (audits `{groupId}` / `{groupId, visibility}` only; handles are public by design; `logPath` needs no change — no bearer tokens in new paths); writes scoped by groupId (+userId for joins); uniqueness/caps atomic (handle PK race + in-tx retired re-read; join cap under a per-group advisory lock taken before counting, same style as `visibility.ts`); permission before effect (owner/member/visibility read INSIDE the tx before any write); unknown = not-allowed 404s (join, by-handle, visibility — code+message equality tested); every new route in the 401 sweep with a rate limit (directory/by-handle 30/10min, join 30/hr) or cap (14-day interval, 30-day reservation, 5000 cap, 10/day handle-claim untouched); audits ids-only (asserted).

**Notes/deviations:**
1. Scope sign-off recorded by the lead: `packages/chat-core/src/types.ts`, `apps/web/src/mock/api.ts`, `apps/web/src/mock/groups.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/store.ts` (non-test parts) are approved. Additionally touched and needing sign-off: `apps/server/src/chats/routes.ts` (visibility/handle on entries), `apps/server/src/invite-links/service.ts` (two `export` keywords only), `apps/web/src/store/*test*` stubs + `NewChatButton/Channels/ChatListItem/ChatView/HandleGate` test edits, `apps/web/src/mock/mock.test.ts` (new directory block). Nothing else touched.
2. `POST /groups` accepting `visibility`+`handle` is not literally in the API list but the create flow ("Public asks for a handle") requires it; one transaction, no private-then-public window.
3. Directory ranking reorders only inside each page (exact handle → handle prefix → title prefix); across cursor pages a later page's handle-match can outrank an earlier page's title-match. Accepted as a cosmetic quirk.
4. `GET /api/handles/check?kind=group` takes no group id (create-flow checks run before the row exists); the asker's own retired reservation therefore reads as `taken` in the create dialog, but claiming still succeeds when it is theirs (the store re-checks ownership inside the tx). Only affects the live hint, never the outcome.
5. OOM flake (shared machine, load ~12): `GroupHandleRoute.test.tsx` crashed the worker once with heap OOM; passed on retry after load dropped. No code change.
6. Correction of the previous report's false claim: the first version said "counted atomically inside [the join tx], so concurrent joins never exceed it" — wrong. A bare in-tx count under READ COMMITTED lets two concurrent txs both read under the cap and both insert (lead finding 1). The fix is the per-group `pg_advisory_xact_lock` taken BEFORE counting. Honest limitation: PGlite runs one connection per database, so concurrent txs serialize there — the last-seat test (exactly one wins + 409 + rows == cap, stable 3/3) pins the contract but passes with or without the lock on PGlite (verified by removing the lock: still green). The lock is verified by inspection + real-Postgres semantics (same pattern as `visibility.ts`/handle store); only a real-Postgres run can observe it.
7. Acceptance re-check (spec list, each against a test): existing groups private + old suites green (1); make-public → Explore by title/handle prefix → one-tap join → member affiliation asserted (posting = room voice, like invite joins) → private/unknown same 404 (2); group/group + group/user handle races → one winner (3); private-again hides at once, members kept, 30-day reservation + reclaim (4); join-twice harmless, last-seat concurrency → one wins + 409 + rows == cap (5); sweep 401s + rate limits + ids-only audits + no user rows in directory/by-handle payloads (6).

## Review (written by Claude)
