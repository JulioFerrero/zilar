---
id: T-0171
title: "Block users, part 1a: server (blocklist table, block/unblock API, silent effects on contact requests and handle lookup)"
status: planned
milestone: M5
branch: task/T-0171-block-users
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0163]
estimate: 0.8 day
---

# T-0171: Block users, part 1a (server)

## Spec (written by Claude, do not edit)

### Why
With `@usernames`, contact requests (T-0163) and public groups (T-0164), strangers can reach people; Julio wants to block users. Lead decisions: blocking is **silent** (the blocked person is never told). Split (lead, 2026-10-05): this task is the server only; the web UI (block action, Blocked people list, hiding messages) is the next task; enforcement at ejabberd (`mod_blocking`) comes after. Schema task: the only one running.

### Verified facts (do not re-derive)
- `contact_requests` table: `apps/server/src/db/schema.ts` lines 155-185 (`status` enum `pending|accepted|declined|cancelled`, partial unique indexes on pending). Latest migration `apps/server/drizzle/0038_voice-transcripts.sql`, snapshots in `apps/server/drizzle/meta/`; generate with `pnpm --filter @zilar/server db:generate` (`apps/server/package.json` line 11).
- Contact request routes `apps/server/src/contact-requests/routes.ts`: limiters built at lines 61-80 (`createRateLimiter({ max, windowMs, now })`), `POST /contact-requests` (lines 95-118, by `handle`, 201 or 200 `{ incoming: true }`), `GET /users/by-handle/:handle` (lines 167-173) → `profileForHandle`.
- Service `apps/server/src/contact-requests/service.ts`: `createContactRequest(deps, fromId, handle)` (line 160, resolves the handle inside a transaction under an advisory lock), `relationFor` (line 550, returns `'self'|'contact'|'request_sent'|'request_received'|'none'`), `profileForHandle` (line 575, 404 `not_found` "No user with that username" for unknown handles). The audit helper takes an `action` string (line 82).
- Routes are mounted in `apps/server/src/app.ts` (contact requests at lines 309-312). `apps/server/src/authz-sweep.test.ts` collects every route from `app.routes` (line 79), so new routes are swept automatically.

### What to build
1. **Table** `user_blocks` in `schema.ts` + one generated migration: `user_id` and `blocked_user_id` (text, not null, FK `user.id` on delete cascade), `created_at` (timestamptz, default now), primary key `(user_id, blocked_user_id)`, check `user_id <> blocked_user_id`, index on `blocked_user_id`.
2. **New module** `apps/server/src/blocks/` (`routes.ts`, `service.ts`, `blocks.test.ts`), mounted under `/api` in `app.ts` next to contact requests. Session required on every route, 30 writes per 10 minutes per user (own limiter, injectable like contact requests), audit `user.blocked` / `user.unblocked` with ids only.
   - PUT `/api/blocks/:userId` (new): idempotent, 200 `{ blocked: true }`. Unknown user → 404 `not_found`; yourself → 400 `invalid_request`. In the same transaction, every `pending` contact request between the two (either direction) becomes `cancelled` with `decided_at = now`.
   - DELETE `/api/blocks/:userId` (new): idempotent, 200 `{ blocked: false }`, deletes only the row `(caller, userId)`.
   - GET `/api/blocks` (new): `{ blocked: [{ userId, name, handle, image }] }` newest first, max 500, never an email (`handle` null when the person has none).
3. **Contact requests** (`service.ts`):
   - `createContactRequest`: if the TARGET blocked the sender, insert the request already `declined` (with `decided_at`) and answer exactly like a normal new request (the route still returns 201 with the same JSON shape, `status` shown as `pending` to the sender). If the SENDER blocked the target → 409 `blocked`, message `Unblock this person first`.
   - `listContactRequests`: never list incoming requests from people the viewer blocked.
4. **By-handle**: `profileForHandle` → when the target blocked the viewer, the same 404 as an unknown handle; `relationFor` gains `'blocked'` (checked first after `self`) when the viewer blocked the other.
5. **Tests** (Vitest, the existing DB test setup of `contact-requests.test.ts`): block/unblock idempotent; 404 unknown, 400 self; pending requests cancelled both ways on block; GET list order, cap and no email; a blocked sender's request returns 201 but the blocker's list does not show it and its stored status is `declined`; the blocker's own request → 409 `blocked`; by-handle 404 when blocked by the target and `relation: 'blocked'` for the blocker; 401 for each route without a session (the sweep covers it; add nothing there unless it fails); limiter 429 after 30 writes; audit rows with ids only.

### Read first
`AGENTS.md` (security checklist), `apps/server/src/contact-requests/routes.ts`, `apps/server/src/contact-requests/service.ts`, `apps/server/src/contact-requests/contact-requests.test.ts` (setup), `apps/server/src/db/schema.ts` (lines 80-190), `apps/server/src/app.ts` (lines 280-320).

### Allowed files
`apps/server/src/blocks/routes.ts` (new), `apps/server/src/blocks/service.ts` (new), `apps/server/src/blocks/blocks.test.ts` (new), `apps/server/src/contact-requests/service.ts`, `apps/server/src/contact-requests/routes.ts`, `apps/server/src/contact-requests/contact-requests.test.ts`, `apps/server/src/db/schema.ts`, `apps/server/src/app.ts`, `apps/server/src/authz-sweep.test.ts`, `apps/server/drizzle/0039_*.sql` (new, exactly one), `apps/server/drizzle/meta/_journal.json`, `apps/server/drizzle/meta/0039_snapshot.json` (new), `work/T-0171-block-users.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/blocks src/contact-requests src/authz-sweep.test.ts
pnpm gate
```

### Acceptance
- Blocking is idempotent and silent: a blocked person's request looks successful to them, and their lookup of the blocker's handle answers 404.
- Every new route needs a session, is rate limited, scopes writes by the caller's id, audits ids only.
- No web, mobile or ejabberd change; no new dependency; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Web UI and message hiding (next task), ejabberd enforcement, blocking AIs, abuse reports.

---

## Report (written by the worker when done)

## Review (written by Claude)
