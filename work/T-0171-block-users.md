---
id: T-0171
title: Block users, part 1 (blocklist, requests, web UI)
status: planned
milestone: M5
branch: task/T-0171-block-users
model: meta/muse-spark-1.3-contributor
effort: high
depends_on: [T-0163]
estimate: 1.5 days
---

# T-0171: Block users, part 1

## Spec (written by Claude, do not edit)

### Why
With `@usernames` and contact requests (T-0163) and public groups (T-0164), strangers can now reach people. Julio wants to block users. Decisions taken by the lead (change any by telling the lead): blocking is **silent** (the blocked person is never told); it is done in **two parts**: this part is the blocklist, contact requests and the web experience, part 2 (later task) enforces it at the ejabberd level (`mod_blocking` is already enabled in `deploy/ejabberd/ejabberd.yml`) so a blocked person's direct messages stop being delivered at all. Until part 2, delivery still happens but the blocker's apps hide it.

### What to build

**1. Data (one migration).** `user_blocks(user_id text not null references user(id) on delete cascade, blocked_user_id text not null references user(id) on delete cascade, created_at timestamptz not null default now(), primary key (user_id, blocked_user_id))` with a check that the two ids differ and an index on `blocked_user_id`.

**2. API (session required, rate limited, audit with ids only).**
- `PUT /api/blocks/:userId`: block (idempotent, 200). Unknown id and blocking yourself: same 404 / 400 as the contact request routes use. Effects inside one transaction: the pair's pending contact requests in either direction become `cancelled`.
- `DELETE /api/blocks/:userId`: unblock (idempotent).
- `GET /api/blocks`: `{ blocked: [{ userId, name, handle, image }] }` newest first, capped at 500. Never an email.
- 30 writes per 10 minutes per user. Audit `user.blocked` / `user.unblocked`, ids only.
- `GET /api/users/by-handle/:handle` (T-0163) gains `relation: 'blocked'` when the caller blocked that person; and when the target blocked the caller it answers exactly as for an unknown handle (same 404), so a block cannot be probed.

**3. Contact requests.** A request created BY a blocked person to the blocker answers the sender exactly like success (201, a normal-looking request) but is stored already `declined`, never appears in the blocker's list and never counts toward their badge. Blocking a person with whom a request is pending cancels it (above). The blocker cannot send a request to someone they blocked (409 `blocked`, message "Unblock this person first").

**4. Web.**
- A "Block" action in the person's profile card (the card shown from the member list and the contact dialog) and a "Blocked people" list in Settings with Unblock; both with a confirmation that explains what blocking does and does not do yet ("They are not told. Their messages are hidden from you.").
- Hiding: in a direct chat with a blocked person the thread shows a banner "You blocked this person" with Unblock, incoming messages are not rendered and do not raise unread counts, notifications or the chat list preview; the composer is disabled with the same banner. In groups, a blocked person's messages collapse into one line "Message from a blocked person" with a "Show" toggle for that message. The blocklist is loaded once at start and kept in the store, updated on block/unblock.
- Match the style of the neighbouring components; Vitest and Testing Library tests for each new component and flow.

**5. Docs.** A short "Blocking" note in `docs/USER_GUIDE.md` (the page exists) that states plainly what part 1 does and does not do.

### Read first
`AGENTS.md` (whole security checklist), `work/T-0163-usernames-and-contact-requests.md` (Report and Review), `apps/server/src/contact-requests/`, `apps/server/src/handles/`, `apps/server/src/authz-sweep.test.ts`, `apps/server/src/rate-limit.ts`, `apps/web/src/store/realStore.ts` (incoming message path, unread counts, notifications), the profile card and member list components, `apps/web/src/routes/ProfileSettingsSection.tsx`, `apps/web/src/lib/api.ts`.

### Allowed files
`apps/server/src/blocks/**` (new), `apps/server/src/contact-requests/**`, `apps/server/src/handles/routes.ts` (only the by-handle relation), `apps/server/src/db/schema.ts` and exactly one new migration (+ journal and snapshot), `apps/server/src/app.ts`, `apps/server/src/authz-sweep.test.ts`, the web files for the blocklist state, profile card action, Settings list, direct chat banner, group collapse, unread and notification filtering, `apps/web/src/lib/api.ts` and its test, `apps/web/src/mock/**`, `docs/USER_GUIDE.md`, `work/T-0171-block-users.md`. No new dependencies, no mobile, no ejabberd changes.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2 src/blocks src/contact-requests src/handles src/authz-sweep.test.ts
pnpm --filter @zilar/web test --maxWorkers=2 src/store src/components src/routes src/lib/api.test.ts
```

### Acceptance
- Blocking is idempotent and silent: the blocked person's UI and API answers never reveal it (a request to the blocker looks successful, a by-handle lookup of the blocker answers 404).
- A blocked person's direct messages are not rendered, not counted as unread and raise no notification for the blocker; in groups their messages collapse behind "Show".
- Unblocking restores everything for new messages; the blocklist survives a reload.
- Every new route is in the 401 sweep and rate limited; deletes and updates are scoped by both user ids; audit entries carry ids only.

### Out of scope
Enforcement at ejabberd (part 2), blocking AIs, reporting abuse, mobile, hiding past messages of a person who is blocked later in groups beyond what the live filter does.

---

## Report (written by the worker when done)

## Review (written by Claude)
