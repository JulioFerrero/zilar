---
id: T-0073
title: Approvals service (M4 foundation, server) — a stored approval request with an integrity hash, expiry, and owner/admin-only decisions
status: review
milestone: M4
branch: task/T-0073-approvals-service
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0054]
estimate: 1 day
---

# T-0073: The approvals service

## Spec (written by Claude, do not edit)

### Goal

The chat already has an `ApprovalCard` and a protocol schema (`packages/protocol/src/approval.ts`), but Approve/Deny are dead buttons: nothing stores a request or a decision. This task builds the **server side**: a table of approval requests, a service that creates them, decides them safely and lets the future engine check "was exactly this action approved?", and the owner-facing routes. It needs neither desks nor the runner. The web wiring is a separate task.

The security model is the point of this task, so read it carefully:
- An approval is bound to one action by `args_hash` (sha256 hex of the exact arguments, computed by the requester). A consumer must present the same hash, or the approval does not apply.
- Only a **human session** may decide. AI accounts have no session, so they can never approve their own request.
- Who may decide: the **owner of the AI** the request is for, and, when the request was raised in a group, that group's **owner or admin**. Nobody else, and a group *member* cannot.
- A request **expires** (`expires_at`): once past, it can't be approved, and reads show it as `expired`.
- A decision is **final and atomic**: only a `pending`, unexpired request can be decided, by a conditional update, so two racing decisions can't both win.
- `approve_once` is **single use**: verifying it consumes it (atomic), a second use fails.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md`: search for "approval" and read those sections (the M4 approvals flow and the trust model)
- `packages/protocol/src/approval.ts` (`ApprovalRequestSchema`, `ApprovalDecisionSchema`, `ARGS_HASH_PATTERN`) — reuse the shapes, do not modify `packages/**`
- `apps/server/src/db/schema.ts` (`ais`, `groups`, `groupMembers`, `groupAis`) and one recent migration under `apps/server/drizzle/`
- `apps/server/src/machines/service.ts` and `routes.ts` (the closest model for a service + owner-only routes + typed errors), `apps/server/src/ais/service.ts` (`getOwnedAi`), `apps/server/src/auth/session.ts`
- `apps/server/src/groups/service.ts` (how membership and roles are read)
- `apps/web/src/components/ApprovalCard.tsx` (only to see what the UI will need; do not edit)

### Allowed files
- `apps/server/src/approvals/` (new: `service.ts`, `service.test.ts`, `routes.ts`, `routes.test.ts`)
- `apps/server/src/db/schema.ts` (add the `approvals` table only) and the generated migration under `apps/server/drizzle/` (generated with the project's `drizzle-kit generate`, never hand-written; keep the journal consistent)
- `apps/server/src/app.ts` (mount the routes)
- `work/T-0073-approvals-service.md`

**Not allowed:** `packages/**`, web, mobile, `docs/**`, any other table, any other dependency.

### What to build

1. **Table `approvals`:** `id` (text pk, random), `ai_id` (fk `ais`, cascade), `group_id` (fk `groups`, cascade, nullable: null means a DM with the AI), `action` (text ≤100), `summary` (≤500), `details` (≤20000, nullable), `args_hash` (64 hex), `worst_case_currency` + `worst_case_amount` (nullable pair, `MoneySchema` shape), `requested_by` (the requesting JID, text), `status` (`pending | approved_once | approved_always | denied | consumed`), `decided_by` (fk `user`, set null, nullable), `decided_at`, `note` (≤500, nullable), `expires_at` (not null), `created_at`. Indexes on `(ai_id, status)` and `(group_id, status)`.
2. **Service (`service.ts`):**
   - `createApproval(db, input, now)` validates with the protocol's field limits (zod at the boundary), requires `expires_at` in the future and at most 24 h ahead, and that the AI exists and (if `group_id` is set) is an AI of that group (`group_ais`). Returns the row. Cap: at most 50 `pending` approvals per AI, else a typed error.
   - `decideApproval(db, { approvalId, userId, decision, note }, now)`: loads the request, checks `canDecide` (owner of the AI, or owner/admin of the group when `group_id` is set), then does one **conditional update** (`WHERE id = ? AND status = 'pending' AND expires_at > now`). No row updated → typed `not_pending` / `expired` error. A user who may not decide gets the same **not found** as a missing id (do not leak existence).
   - `verifyApproval(db, { approvalId, argsHash }, now)`: returns `{ ok: true, decision }` only when the request is `approved_once` or `approved_always` and still unexpired (`expires_at > now`; **standing rules are out of scope**, so treat `approved_always` exactly like a single approval for now and say so in a comment), and `argsHash` equals the stored hash (compare with `timingSafeEqual` on the bytes). For `approved_once` it also flips the status to `consumed` with a conditional update so a second call fails. Any failure returns the same `{ ok: false }` with no detail about why (the engine treats it as "not approved").
   - `listDecidableApprovals(db, userId, now)`: the user's pending, unexpired requests they may decide (their AIs plus groups they own/admin), newest first, max 100.
   - `getDecidableApproval(db, approvalId, userId, now)`: one request by id under the same visibility rule, or null. The read model maps a past-due `pending` row to `expired` without writing.
   - `expireStale(db, now)`: marks past-due `pending` rows `denied` with `note = 'expired'` (used by a later sweeper; here only tested).
3. **Routes (`routes.ts`, all under `/api`, all `requireSession`):**
   - `GET /approvals` → the decidable list.
   - `GET /approvals/:id` → one, or 404.
   - `POST /approvals/:id/decision` with `{ decision: 'approve_once' | 'approve_always' | 'deny', note?: string }` (`strictObject`) → the updated request. 404 for not found/not allowed, 409 (`not_pending`, `expired`) otherwise.
   - **There is no route that creates an approval.** Creation is a server-internal call the future engine makes. Do not add a dev shortcut.
   - Public shape: id, aiId, groupId, action, summary, details, argsHash, worstCase, requestedBy, status, decidedAt, note, expiresAt, createdAt. `decided_by` is not exposed.
4. Mount in `app.ts` next to the machines routes.

### Tests (Vitest, PGlite, as in T-0068)
- create: validation (bad hash, past/too-far expiry, AI not in that group, unknown AI), the 50-pending cap.
- decide: the AI owner can; a group owner and a group admin can; a group **member** cannot (404); a stranger cannot (404); the same 404 for a missing id; double decide → second gets 409; a decide after expiry → 409 `expired`; two concurrent decisions → exactly one wins.
- verify: right hash ok; wrong hash fails; not yet decided fails; denied fails; `approve_once` works once, then fails (consumed); a wrong hash does **not** consume it; expired fails; the failure shape is identical in every case.
- list/get respect visibility and hide others' requests; `expired` shows up in reads; `expireStale`.
- routes: no session → 401; the decision route validates the body; `decided_by` is not in the payload.

### Live check (the lead does it)
Not needed from you; say in the Report that no live proof was done.

### Acceptance criteria
- [ ] Only the AI owner or a group owner/admin can decide; members and strangers get a 404 that looks like "missing".
- [ ] A decision can't be replaced, and `approve_once` can be verified exactly once.
- [ ] The args hash must match; a mismatch never consumes.
- [ ] No route creates approvals; no AI-facing decision path.
- [ ] Migration generated, not hand-written; `pnpm exec turbo test --force --filter=@galena/server` passes.
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
- The web/mobile wiring, notifications of a new request, the XMPP message that carries the card, standing rules for `approve_always`, the engine calling `createApproval`, the sweeper schedule.

---

## Report (written by the worker when done)

### What I did
- Added the `approvals` table to `apps/server/src/db/schema.ts` with the columns the spec requires (`id`, `ai_id`, `group_id` nullable, `action` ≤100, `summary` ≤500, `details` ≤20000 nullable, `args_hash` 64 hex, `worst_case_currency` + `worst_case_amount` nullable pair, `requested_by`, `status` enum, `decided_by` set null on user delete, `decided_at`, `note` ≤500 nullable, `expires_at` not null, `created_at` default now). Foreign keys to `ais` (cascade), `groups` (cascade, nullable) and `user` (set null). Two indexes on `(ai_id, status)` and `(group_id, status)`.
- Generated the migration with `pnpm --filter @galena/server db:generate`. The new file is `apps/server/drizzle/0011_silky_groot.sql`; the journal in `apps/server/drizzle/meta/_journal.json` and the snapshot in `apps/server/drizzle/meta/0011_snapshot.json` are updated by drizzle-kit, not hand-edited.
- Built `apps/server/src/approvals/service.ts` with `createApproval`, `decideApproval`, `verifyApproval`, `listDecidableApprovals`, `getDecidableApproval`, `expireStale`, and `canDecide`. `canDecide` is the single source of truth for the AI owner / group owner+admin visibility rule, used by both `decideApproval` and the read endpoints. The wire enum (`approve_once`/`approve_always`/`deny`) is mapped to the storage enum (`approved_once`/`approved_always`/`denied`) by a tiny `decisionToStatus` helper. `approved_always` is treated identically to a single-use approval today; the standing-rules spec is flagged in a code comment. Hash equality uses `timingSafeEqual` on the decoded bytes, with a length pre-check so `timingSafeEqual` never throws.
- Built `apps/server/src/approvals/routes.ts` exposing `GET /approvals`, `GET /approvals/:id`, and `POST /approvals/:id/decision` (all `requireSession`, decision body a `z.strictObject` so unknown fields 400). There is no creation route — the spec rules that out. The decision body is validated at the boundary; service errors are mapped to HTTP (`expired` and `not_pending` → 409, `invalid_request` / `ai_not_in_group` → 400, missing/unauthorised → 404). `decided_by` is never returned.
- Mounted the routes in `apps/server/src/app.ts` next to the machines and groups routes, with the default `Date.now` clock.
- Wrote 34 service tests covering create (validation, expiry bounds, AI-not-in-group, unknown AI, 50-pending cap), decide (owner / group owner / group admin / group member 404-shape / stranger 404-shape / missing-id 404-shape / second decide → `not_pending` / decide after expiry → `expired` / racing decisions → exactly one winner), verify (right hash ok, wrong hash fails without consuming, not-decided fails, denied fails, `approved_once` consumed once, `approved_always` ok, expired fails, every failure mode returns the identical `{ ok: false }`), list/get visibility and the `expired` mapping on reads, and `expireStale`.
- Wrote 10 routes tests covering 401 on every owner route, the public shape (no `decidedBy`/`decided_by`, the exact key list the spec mandates), decision-body validation (unknown decision 400, unknown extra field 400), a successful decide returning 200 with no `decided_by` and a second decide answering 409 `not_pending`, a missing id answering 404, a stranger answering 404 (not 403), a decide after expiry answering 409 `expired`, a single-id GET answering 404 for a stranger, and a DB-level check that `decided_by` is still stored for the audit while the API never returns it.
- The routes tests use a fresh Hono with only the approvals routes mounted, pointed at a controllable clock. `bootstrapUser` runs against the standard `testApp` (it needs the Better Auth handler), and the resulting cookie is passed straight through to the clock-controllable mount — both apps share the same `auth` and `db`, so the session lookup is the same.

### Files changed
- `apps/server/src/db/schema.ts` — added the `approvals` table and the `approvals_ai_status_idx` / `approvals_group_status_idx` indexes.
- `apps/server/drizzle/0011_silky_groot.sql` — generated migration.
- `apps/server/drizzle/meta/0011_snapshot.json` — generated snapshot.
- `apps/server/drizzle/meta/_journal.json` — generated journal entry.
- `apps/server/src/approvals/service.ts` — new: the approvals service, `ApprovalServiceError`, `CreateApprovalInputSchema`, `PublicApproval`, `toPublicApproval`.
- `apps/server/src/approvals/service.test.ts` — new: 34 service tests.
- `apps/server/src/approvals/routes.ts` — new: the three HTTP routes.
- `apps/server/src/approvals/routes.test.ts` — new: 10 route tests.
- `apps/server/src/app.ts` — mounted the approvals routes between drafts and xmpp.
- `work/T-0073-approvals-service.md` — set status and filled the Report.

### Commands run and real results
- `pnpm install` → Done in 14.1s (Lockfile up to date; 1010 packages installed).
- `pnpm --filter @galena/server db:generate` → `Your SQL migration file ➜ drizzle/0011_silky_groot.sql 🚀` (20 tables; new `approvals` table with 16 columns, 2 indexes, 3 fks).
- `pnpm --filter @galena/server typecheck` → `tsc --noEmit` exited 0 (no output).
- `pnpm --filter @galena/server test src/approvals/service.test.ts` → 34 passed, 0 failed (`Test Files 1 passed`, `Tests 34 passed`, 17.6s).
- `pnpm --filter @galena/server test src/approvals/routes.test.ts` → 10 passed, 0 failed (`Test Files 1 passed`, `Tests 10 passed`, 12.4s).
- `pnpm format` → reformatted the new files; `pnpm format:check` → `All matched files use Prettier code style!`.
- `pnpm lint` → `oxlint .` exited 0 (no output).
- `pnpm typecheck` (top-level turbo) → `Tasks: 9 successful, 9 total`.
- `pnpm exec turbo test --force --filter=@galena/server` → `Test Files 43 passed | 5 skipped (48)` / `Tests 587 passed | 7 skipped (594)` (~99s).
- `pnpm build` → `Tasks: 2 successful, 2 total` (cached, FULL TURBO).

### Problems, deviations from the spec, open questions
- The spec says "No `any`, no `@ts-ignore`, no new dependencies." I added none. Validation at the boundaries uses zod, including a `strictObject` for the decision body so unknown fields 400.
- The spec says the `approve_always` decision "treat it exactly like a single approval for now and say so in a comment." `verifyApproval` does this: `approved_always` returns `{ ok: true, decision: 'approve_always' }` but does NOT consume the row (only `approved_once` flips to `consumed`). This matches the spec line that says "standing rules are out of scope". The code comment at `verifyApproval` and at the `ApprovalStatus` type spells this out.
- The spec says "A user who may not decide gets the same **not found** as a missing id (do not leak existence)." `decideApproval` returns `null` for both. The route maps that to a single 404 with code `not_found`, so the messages and codes are byte-identical for the two cases.
- The spec mentions `note ≤500`. The schema, the zod schema in service.ts, and the decision body schema all use 500 as the max. The `note` column in the DB has no DB-level length cap; the limit is enforced only by zod at the boundary. This matches how every other text column in the schema is shaped (e.g. `invites.code`, `ais.name`).
- The spec lists `worst_case_currency` and `worst_case_amount` as a "nullable pair, `MoneySchema` shape". I store them as two columns (`text` + `numeric(12, 2)`); either both are null or both are set. The Drizzle insert code at `createApproval` enforces this — one is set iff the other is. The public shape joins them back into the `MoneySchema` shape `{ currency, amount }` with `amount` as a JS number.
- The schema enforces the enum for `status` at the DB level (`text` with a `text('status', { enum: [...] })`). The Drizzle insert uses the column's literal types so the wire `approve_once` cannot accidentally land in the column as `approved_once` without going through `decisionToStatus`.
- No live check was done — the spec said the lead does it; saying so explicitly here as the spec asks.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:**
