---
id: T-0116
title: Group roles (Designers, Devs …): grant access to private topics and approver rights by role
status: planned
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

### Data (migrations only via `pnpm --filter @galena/server db:generate`)
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
pnpm --filter @galena/server test -- --maxWorkers=2
pnpm --filter @galena/web test -- --maxWorkers=2
pnpm build
```

### Out of scope
- A full permission matrix, per-role colors/icons, workspaces (a separate, bigger decision), mobile UI, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
