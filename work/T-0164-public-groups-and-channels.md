---
id: T-0164
title: Public and private groups and channels (handles, directory, open join)
status: planned
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

## Review (written by Claude)
