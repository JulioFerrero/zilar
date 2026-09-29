---
id: T-0079
title: Audit log (M4, server) — an append-only record of who did what, written by approvals and machines, readable by the people who own the AI or the group
status: todo
milestone: M4
branch: task/T-0079-audit-log
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0073, T-0068]
estimate: 1 day
---

# T-0079: Audit log

## Spec (written by Claude, do not edit)

### Goal

`docs/PROJECT_PLAN.md` §15.5: the audit log is **append-only** and visible per room, and it records who asked, which AI, which room, the action, a hash of the arguments, the approval (who, when), the cost and the result. Retention and who may read it are in the decision table (J4): admins, plus the room's own entries for room admins. Today nothing is recorded. This task builds the server side: a table that can only grow, a small service that appends entries, two owner-facing read routes, and the first writers: **approval decisions** (T-0073) and **machine lifecycle** (T-0068).

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §15.5, and the J4/J5 rows of the decisions table (search "Audit log retention")
- `apps/server/src/approvals/service.ts` and `routes.ts` (T-0073: `canDecide`, the visibility rule for AI owner / group owner / group admin) — the read rules below reuse the same idea
- `apps/server/src/machines/routes.ts` and `service.ts` (T-0068)
- `apps/server/src/db/schema.ts` and `apps/server/drizzle/` (how migrations are generated; a custom SQL migration is created with `drizzle-kit generate --custom`)
- `apps/server/src/test-support.ts` (PGlite context), one existing `routes.test.ts`

### Allowed files
- `apps/server/src/audit/` (new: `service.ts`, `service.test.ts`, `routes.ts`, `routes.test.ts`)
- `apps/server/src/db/schema.ts` (add the `audit_log` table only) and migrations under `apps/server/drizzle/` (generated; the append-only trigger goes in a generated **custom** migration)
- `apps/server/src/approvals/routes.ts`, `routes.test.ts` (write one entry per decision)
- `apps/server/src/machines/routes.ts`, `routes.test.ts` (write entries for pair, approve, deny, revoke, delete)
- `apps/server/src/app.ts` (mount the routes and pass the recorder)
- `work/T-0079-audit-log.md`

**Not allowed:** `packages/**`, web, mobile, `docs/**`, other tables, other dependencies, changes to the behavior or response shapes of the existing routes.

### What to build
1. **Table `audit_log`:** `id` (text pk, random), `at` (timestamptz, default now, not null), `actor_user_id` (text, nullable; **no foreign key**, an audit row must survive the deletion of a user, an AI or a group), `ai_id` (text, nullable, no FK), `group_id` (text, nullable, no FK), `action` (text ≤100, not null; dotted names like `approval.decided`, `machine.approved`), `subject_id` (text, nullable: the approval id, machine id and so on), `args_hash` (text, nullable, 64 hex), `cost_currency` + `cost_amount` (nullable pair), `result` (`ok | denied | error`, not null), `detail` (jsonb, nullable, small: at most 2 KB when serialized), indexes on `(group_id, at)`, `(ai_id, at)` and `(actor_user_id, at)`.
2. **Append-only in the database, not just in the code.** A generated custom migration adds a trigger that raises an exception on `UPDATE` and on `DELETE` (and `TRUNCATE` if PGlite supports it) of `audit_log`. A test proves an update and a delete through the Drizzle client both fail. (Foreign-key cascades cannot delete audit rows because there are no FKs.) If PGlite cannot run the trigger, stop and say so in the Report instead of dropping the requirement.
3. **Service (`service.ts`):**
   - `recordAudit(db, entry)`: validates with zod (action pattern `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`, `detail` size cap, hash pattern), inserts one row, returns nothing sensitive. **It must never throw into the caller's request**: wrap it in a small `createAuditRecorder({ db, logger })` that catches, logs `{ action }` only (never the detail) and carries on. A failed audit write must not fail an approval, but the failure is logged at error level.
   - `listAuditForGroup(db, groupId, userId, { limit, before })` and `listAuditForAi(db, aiId, userId, { limit, before })`: newest first, cursor by `at`/`id`, `limit` default 50 and at most 200. Visibility: an AI's entries are visible to **the AI's owner**; a group's entries to **that group's owner and admins** (members and strangers get "not found", the same shape as a missing id). Never return `actor_user_id` of someone else to a non-admin: within these two scopes it is fine to return it.
4. **Routes (`routes.ts`, `requireSession`):** `GET /api/audit?groupId=…` or `GET /api/audit?aiId=…` (exactly one; both or neither is 400), `limit` and `before` query params validated with zod. Response: `{ entries: [...], next: string | null }`.
5. **Writers.**
   - Approvals decision route: after a successful decision write `approval.decided` with `subject_id` = approval id, `ai_id`, `group_id`, `args_hash` (the request's), `actor_user_id` = the decider, `detail: { decision }` (**no note text**), result `ok`. A decision refused with 409 is not logged.
   - Machines routes: `machine.paired` (`subject_id` = machine id, **the owner id as `actor_user_id`**, no key material and no name in `detail`), `machine.approved`, `machine.denied`, `machine.revoked`, `machine.deleted` with the acting user. Ids only in `detail`.
   - `verifyApproval` is not touched here (the engine will log its own use later).

### Tests (Vitest, PGlite)
- Service: valid append; invalid action / oversize detail / bad hash rejected; the recorder swallows a failing insert and logs the action only.
- The append-only trigger: update fails, delete fails.
- Visibility for both list functions: AI owner yes; stranger no (same not-found as unknown id); group owner and admin yes, plain member no; newest first; pagination via `before`.
- Routes: 401 without a session; exactly one of `groupId`/`aiId`; limit bounds; response shape.
- Writers: deciding an approval writes one entry with the right fields and **no note**; a 409 decision writes none; each machine route writes its entry; a failing recorder does not change the response of the route.

### Live check (the lead does it)
Not needed from you; say in the Report that no live proof was done.

### Acceptance criteria
- [ ] The database itself refuses to change or delete audit rows.
- [ ] A failing audit write never breaks approvals or machine routes.
- [ ] Only the AI owner or the group's owner/admin can read entries; others get the same not-found.
- [ ] No secrets, notes, keys, names or free text in audit rows.
- [ ] Migrations generated (the trigger through `--custom`), not hand-edited beyond the SQL body of the custom one.
- [ ] No `any`, no `@ts-ignore`, no new dependencies.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server
pnpm build
```

### Out of scope
- A web page for the log, retention and export, entries written by the engine or the proxy, the kill switch.

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
-

---

## Review (written by Claude)

**Verdict:**
