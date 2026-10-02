---
id: T-0116
title: Group roles (Designers, Devs …): grant access to private topics and approver rights by role
status: merged
milestone: M5
branch: task/T-0116-group-roles
model: meta/muse-spark-1.3-contributor
depends_on: [T-0108, T-0110, T-0111]
estimate: 2 days
---

# T-0116: Custom group roles

## Spec (written by Claude, do not edit)

### Why
D29 mentions roles that can grant topic access and be approvers ("designers approve UI merges, developers approve backend"). Today there are only `owner`, `admin` and `member`. This task adds **custom roles as labels with two powers**, not a full Discord permission matrix: (1) a role can be **added to a private topic** (everyone holding it gets access, now and later); (2) a topic can name an **approver role** whose holders may decide approval cards in that topic. The built-in owner/admin/member stay as they are.

### Data (migrations only via `pnpm --filter @zilar/server db:generate`)
- `group_roles`: `id`, `group_id` (fk cascade), `name` (1–30 chars, unique per group ignoring case, no control characters), `created_by`, `created_at`. Max 20 roles per group.
- `group_member_roles`: `role_id` (fk cascade), `user_id` (fk cascade), `assigned_by`, `assigned_at`, pk `(role_id, user_id)`. The user must be a group member (deleted when they leave the group: extend the remove/leave flow).
- `topic_role_access`: `topic_id` (fk cascade), `role_id` (fk cascade), pk both; only meaningful for private topics.
- `topics.approver_role_id` (fk `group_roles`, nullable, on delete set null).

### Rules
- **Manage roles** (create, rename, delete, assign/unassign): group owner/admin. Every group member can read the list of roles and who holds them (role membership is not secret; no special cases).
- `canSeeTopic` (T-0108) becomes: public, or in `topic_members`, or holds a role in `topic_role_access`. `desiredMembers` for a private topic = `topic_members` ∪ holders of its roles; assigning/unassigning a role, adding/removing a role from a topic, deleting a role, and a member leaving all re-sync the affected topic rooms (same sync function).
- **Approvals:** in `canDecide` (T-0110) add: the approval's topic has `approver_role_id` and the user holds that role **and can see the topic**. The role does **not** widen anything else (a role holder cannot manage the AI, change rules, or see other topics). Creating an "Always allow" rule still needs a group admin (T-0101).
- Setting a topic's roles/approver role: topic manager (T-0108 rule) who can see the topic. Deleting a role removes it everywhere and re-syncs.
- Audit: `group.role_created/renamed/deleted`, `group.role_assigned/unassigned`, `topic.role_added/removed`, `topic.approver_role_set` (ids only; no role or topic names for private topics).

### Routes
`GET/POST /api/groups/:id/roles`, `PATCH/DELETE /api/groups/:id/roles/:roleId`, `PUT /api/groups/:id/roles/:roleId/members` `{ userIds }` (replace the assignment set), `GET /api/groups/:id/members` gains `roles: [{ id, name }]`; `PUT /api/topics/:id/roles` `{ roleIds, approverRoleId }`; topic JSON gains `roles` and `approverRole`. Same 404 shapes as elsewhere; sweep updated.

### Web
- Group panel: **Roles** section for admins (create, rename, delete, assign with a member multi-select); role chips next to member names for everyone.
- Topic info panel and new-topic dialog: for private topics a **Roles** picker next to the people list ("Designers (3)"); an **Approvers** select (one role or "Owner and admins only").
- Approval cards show "Approvers: Designers" when the topic has one (the server already tells the viewer whether they may decide).
- Mock mode support.

### Read first
- `AGENTS.md`; `work/T-0108`, `T-0110`, `T-0111` (Specs + Reviews), `T-0101` (admin-only always-allow)
- `apps/server/src/topics/{access,rooms,routes}.ts`, `approvals/service.ts` (`canDecide`), `groups/{service,routes}.ts`, `authz-sweep.test.ts`; `apps/web/src/components/{GroupPanel,TopicPanel,NewTopicDialog,ApprovalCard}.tsx`, `lib/api.ts`, `mock/*`

### Allowed files
- `apps/server/src/roles/**` (new), `apps/server/src/topics/**`, `apps/server/src/approvals/**` (only `canDecide` and its callers), `apps/server/src/groups/service.ts`, `db/schema.ts` + migration, `app.ts`, `audit/**`, `authz-sweep.test.ts`
- `apps/web/src/**` (components, lib, mock, tests)
- `work/T-0116-group-roles.md`

**Not allowed:** mobile, packages, dependencies.

### Tests
- Server: CRUD and limits, assignment sync (holder joins/leaves the private topic room), a role added to a private topic gives access to all current and future holders and removes it when unassigned, leaving the group drops role rows, deleting a role re-syncs, `approver_role_id` lets a holder who can see the topic decide and nobody else, a holder who cannot see the topic still gets 404, always-allow still needs an admin, audit without names, 404 shapes, sweep.
- Web: panels, chips, pickers, approver line, mock mode.

### Acceptance criteria
- [ ] Roles grant exactly two things: private-topic access and approver rights in the topics they are attached to.
- [ ] Every role change is reflected in the rooms; nothing leaks to non-holders.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; full suites once at the end, `--maxWorkers=2`)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2
pnpm --filter @zilar/web test --maxWorkers=2
pnpm build
```

### Out of scope
- A full permission matrix, per-role colors/icons, workspaces (a separate, bigger decision), mobile UI, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Server: new `apps/server/src/roles/` module (service + routes + 12 tests).
  `group_roles` / `group_member_roles` / `topic_role_access` tables plus
  `topics.approver_role_id` (SET NULL) in `db/schema.ts`, with generated
  migration `0027_nice_roland_deschain.sql` (see "After the rebase" below).
  - CRUD: manager-only create/rename/delete/assign (replace-the-set PUT);
    names 1–30 chars, unique per group ignoring case, no control chars, max
    20 roles/group; every member reads the list with holders. 409
    `role_exists`, 400s, 403 for plain members, same 404s as elsewhere.
  - `canSeeTopic`/`visibleTopics`: private topic visible via
    `topic_members` OR a role in `topic_role_access`; `desiredMembers`,
    `countTopicMembers`, `listTopicMembers` and the AI rule
    (`allowedTopicAiIds`) all count role holders (still group members).
    Assign/unassign, topic attach/detach, role delete and group leave all
    re-sync the affected rooms through the same `syncTopicRoom`.
  - `canDecide`: holder of the topic's `approver_role_id` who can see the
    topic may decide; blind holders get the same false as missing ids.
    `approve_always` still needs a group admin (unchanged T-0101 path).
  - `PUT /api/topics/:id/roles` `{roleIds, approverRoleId}`: topic manager
    who can see the topic, private-only, group-local roles; re-syncs.
  - Group leave flow drops the member's role rows and re-syncs; role delete
    captures affected topics first (cascade would erase them), syncs each
    room and audits `topic.role_removed` per topic.
  - Audit: `group.role_created/renamed/deleted/assigned/unassigned`,
    `topic.role_added/removed`, `topic.approver_role_set` — ids only, never
    names. Audit list filter also counts role holders for hidden topics.
  - `GET group detail` members gain `roles: [{id, name}]`. Note: there is no
    `GET /api/groups/:id/members` route on this codebase — the member list
    rides the group detail, so the roles land there.
  - Routes mounted in `app.ts`; all require a session (sweep passes).
- Web: `lib/api.ts` roles helpers + `roles`/`approverRole` on `Topic`
  (optional, old servers still parse) and `roles` on `GroupMember`;
  `setTopicRoles` in both stores; GroupPanel Roles section (manager CRUD +
  multi-select assign) with chips for everyone; TopicPanel Roles section
  (attached `Name (count)`, Add-roles picker, Approvers select, read-only
  approver line for non-managers); NewTopicDialog roles picker + Approvers
  select applied after create (failure keeps the topic); ApprovalCard
  "Approvers: Name" line via one `getTopic` read; full mock-mode support
  (seeded Designers/Devs roles, handlers for all new routes).
- Tests: server `roles/roles.test.ts` (12: CRUD/limits, access for current
  and future holders, unassign removal, leave cleanup, delete re-sync,
  approver decide + blind-holder 404, always-allow still admin-gated,
  id-only audit, auth + 404 shapes). Web: mock API (4), GroupPanel (4:
  chips, manager CRUD, member hiding, roles + invite-links coexistence),
  TopicPanel (3), NewTopicDialog (1), ApprovalCard (2), lib/api (6), store
  (1). Existing suites updated where the panel's new roles fetch needed a
  stub (`GroupPanel.test.tsx`), and `setTopicRoles` added to ApiClient
  fakes.

### After the rebase (T-0115 merged, branch rebased by the lead)
- Ran `pnpm --filter @zilar/server db:generate`: produced exactly
  `drizzle/0027_nice_roland_deschain.sql` + snapshot + journal entry, with
  only the three roles tables, the `topics.approver_role_id` column and
  their FKs/index — nothing unrelated. Verified the SQL by reading it.
- `backfill.test.ts` now excludes `0027_` (was the temporary `0026_`
  exclusion) from the pre-T-0108 simulation, with the reason in a comment.
- The lead's merge kept both sides in `app.ts`, `GroupPanel.tsx` and
  `mock/api.ts`: invite-links section and roles section both render (new
  coexistence test proves it); both keep their tests. Only follow-up edit
  on my side was prettier import collapsing in `GroupPanel.tsx`.

### Review round 2 (findings 1–4 fixed, one test each; 5 blessed as-is)
1. Stale-baseline race: `setRoleMembers` and `setTopicRoles` now read the
   current set INSIDE the advisory-lock transaction and diff from that
   read; `setTopicRoles` gained the same per-group `pg_advisory_xact_lock`
   (its approver update rides the same transaction). Tests: sequential
   replacements from different baselines end exactly last-writer-wins, and
   two concurrent PUTs end as exactly one of the two sets (probed first:
   PGlite serializes the pair, so the assertion is deterministic here; on
   Postgres the lock gives the same guarantee).
2. `dropMemberRoles` returns the removed role ids and `removeGroupMember`
   audits one id-only `group.role_unassigned` per dropped role (subject =
   role id, detail = `{groupId, subjectUserId}`). Deviation: groups routes
   are outside my Allowed files, so the recorder could not be threaded
   through `createGroupsRoutes` — the write uses `recordAudit` directly
   with try/catch + warn in the best-effort post-commit section, where
   sync failures are already swallowed the same way. The lead may want to
   rewire it through the routes file. Test pins the row + id-only detail.
3. `schema.ts` comment rewritten: names the real unique index and the
   advisory-lock cap check instead of the stale "enforced in code"
   wording. No migration change (comment only).
4. `holdersOfRole` joins `groupMembers`, so a departed user is never
   listed even if their row survived leave cleanup. Test: stale row for a
   non-member is excluded from the list.
- Nit 5 (backfill scope touch) skipped per instruction — unchanged.

### Files changed
- Server: `apps/server/src/roles/service.ts`, `roles/routes.ts`,
  `roles/roles.test.ts` (new); `db/schema.ts` + generated migration
  `drizzle/0027_nice_roland_deschain.sql` (snapshot + journal);
  `topics/access.ts`, `topics/rooms.ts`, `topics/routes.ts`,
  `topics/service.ts`, `topics/backfill.test.ts` (excludes `0027_` from the
  pre-T-0108 simulation); `approvals/service.ts` (`canDecide` only);
  `groups/service.ts` (member `roles`, leave cleanup); `audit/service.ts`
  (hidden-topic filter); `app.ts` (mount).
- Web: `lib/api.ts`, `store/store.ts`, `store/realStore.ts`,
  `components/GroupPanel.tsx`, `components/TopicPanel.tsx`,
  `components/NewTopicDialog.tsx`, `components/ApprovalCard.tsx`,
  `mock/api.ts`, `mock/groups.ts`, plus tests listed above.

### Commands run and real results (post-rebase, final)
- `pnpm install`: ok.
- `pnpm --filter @zilar/server db:generate`: produced
  `drizzle/0027_nice_roland_deschain.sql` (roles tables/columns only, read
  and verified) + `drizzle/meta/0027_snapshot.json` + journal entry.
- `pnpm format:check`: pass. `pnpm lint` (oxlint): pass. `pnpm typecheck`
  (10 tasks): pass.
- `pnpm --filter @zilar/server test --maxWorkers=2`: 82 files passed,
  5 skipped; 1408 passed, 7 skipped, 0 failed.
- `pnpm --filter @zilar/web test --maxWorkers=2`: 75 files passed;
  822 passed, 0 failed.
- `pnpm build`: pass.
- Pre-rebase history (kept for the record): the full server suite failed
  once in `backfill.test.ts` under my temporary local-only `0026`
  migration (since deleted); fixed via the exclusion mechanism above. One
  backfill timeout was contention from my own concurrent runs.

### Review round 2 commands (final)
- Touched files: `roles/roles.test.ts` (21 passed), `topics/topics.test.ts`
  + `groups/groups.test.ts` (63 passed), `approvals/service.test.ts` +
  `approvals/routes.test.ts` + `db/migrate.test.ts` +
  `topics/backfill.test.ts` (69 passed) — each run as
  `pnpm --filter @zilar/server test --maxWorkers=2 <path>`.
- `pnpm format:check`: pass. `pnpm lint`: pass. `pnpm typecheck`
  (10 tasks): pass.
- Full `pnpm --filter @zilar/server test --maxWorkers=2`: 82 files
  passed, 5 skipped; 1417 passed, 7 skipped, 0 failed.
- Web untouched this round (review fixes are server-only).

### Problems, deviations from the spec, open questions
- Spec route `GET /api/groups/:id/members` does not exist in this codebase;
  member roles ride the group detail (`GET /api/groups/:id`), which is the
  only member-read path. Same coverage, different shape location.
- `memberCount` on `roles[]` counts role holders (per the "Designers (3)"
  example), not topic members.
- `deleteRole` audits one `topic.role_removed` per affected topic (subject
  = topic id, detail carries topic/role/group ids) — the spec lists the
  action but not the subject; topic id matches the `topic.*` convention.
- Finding 7 (N+1 `getTopic` per ApprovalCard) skipped per instruction —
  follow-up: batch the approver name via the approvals list payload if
  card lists grow.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:** merged after three rounds and a lead fix. Security code read twice.

### Findings
- Round 1 (pre-review): leaving one group deleted the leaver's role rows in every group (must-fix); a drained private topic was archived even with role holders; a room-sync failure skipped the audit; role name and cap races; `canDecide` did not tie the approver role to the group. All fixed with tests; the unique `lower(name)` index is in migration 0027.
- Round 2: a stale-baseline race in `setRoleMembers` and `setTopicRoles` (now read inside the advisory lock); leaver role audit; holder list joins group membership.
- Lead fix: making a private topic public left its attached roles and approver role behind, so re-privatizing brought them back silently. Going public now clears both, with `topic.role_removed` audit rows (test fails without the fix). Also updated a stale comment in search.
- Blessed scope touch: `topics/backfill.test.ts` excludes migration 0027 from the pre-T-0108 simulation.
- Not live-checked: UI verified by tests and mock mode only.

### Follow-ups
- ApprovalCard fires one `getTopic` per card (N+1); T-0134 puts approver names in the list payload.
- The concurrent role tests document that PGlite serializes writes; a real Postgres race test is still missing.
