---
id: T-0115
title: Join by link: shareable group invite links (expiry, max uses, revoke)
status: planned
milestone: M5
branch: task/T-0115-invite-links
model: meta/muse-spark-1.3-contributor
depends_on: [T-0108]
estimate: 1.5 days
---

# T-0115: Group invite links

## Spec (written by Claude, do not edit)

### Why
D28: to feel like Telegram, "send this link to your friends" must work. Today people are added only by contacts and invites-to-sign-up. This task adds shareable links for **groups** (public topics come with joining the group; private topics are never joined by link).

### Server
- Table `group_invite_links`: `id`, `group_id` (fk cascade), `token_hash` (SHA-256 of a 32-byte random token; the token itself is shown once at creation and never stored), `token_hint` (last 4 chars, for the admin list), `label` (≤ 60), `created_by`, `created_at`, `expires_at` (nullable), `max_uses` (nullable, ≥ 1), `uses` (int), `revoked_at`. Migration via `pnpm --filter @galena/server db:generate`.
- **Who creates/lists/revokes:** group owner/admin. Limits: 10 active links per group.
- `POST /api/groups/:id/invite-links` `{ label?, expiresInHours?: 1..8760, maxUses?: 1..10000 }` → `{ id, token, url }` where `url = ${WEB_BASE_URL}/j/<token>`; `GET /api/groups/:id/invite-links` (no tokens; hint, label, uses, limits, state); `DELETE /api/groups/:id/invite-links/:linkId` (revoke, idempotent).
- **Join:** `GET /api/join/:token` (signed-in user) → `{ groupTitle, memberCount, alreadyMember }` **only**, never member names; `POST /api/join/:token` → adds the caller as `member` through the existing add-member flow (so T-0108 room sync, public topics and the audit entry all happen), increments `uses` atomically (conditional update: not revoked, not expired, `uses < max_uses`; two racing joins never exceed `max_uses`). Unknown/expired/revoked/exhausted → the same `404 invalid_link` (no leak of which). Already a member → 200 with `alreadyMember: true`, no use consumed. Group at the member cap (`MAX_GROUP_MEMBERS`) → 409 `group_full`.
- Tokens are compared by hash with a constant-time check; join attempts are rate limited (20 per hour per user, 60 per hour per IP) so tokens cannot be guessed.
- Audit: `group.link_created`, `group.link_revoked`, `group.joined_by_link` (ids and the link's hint only, never the token).
- New env `WEB_BASE_URL` (zod, default `http://localhost:5173`) documented in `docs/SERVER_CONFIG.md`.
- A person without an account still needs a sign-up invite (invite-only sign-up is unchanged); the web `/j/<token>` page sends a signed-out visitor to the login with `next=/j/<token>` and returns them after sign-in.

### Web
- Route `/j/:token` (`routes/JoinPage.tsx`): preview card (group title, "N members"), **Join** button, states (invalid link, already a member → opens the group, group full, signed out).
- Group panel (owners/admins): "Invite links" section: create (label, expiry, max uses) → shows the URL once with a Copy button and a plain warning that anyone with the link can join; list with uses, state and Revoke.
- Mock mode support for the create/list/revoke/join flow.

### Read first
- `AGENTS.md`; `work/T-0108-topics-server.md`; `apps/server/src/groups/{service,routes}.ts` (add-member flow, `MAX_GROUP_MEMBERS`), `rate-limit.ts`, `config.ts`, `auth/` (how `requireSession` and login `next` work), `authz-sweep.test.ts`
- `apps/web/src/components/GroupPanel.tsx`, `InviteDialog.tsx`, `routes/AppRoutes.tsx`, `routes/InvitePage.tsx`, `lib/api.ts`

### Allowed files
- `apps/server/src/invite-links/**` (new), `apps/server/src/groups/service.ts` (only to expose the add-member flow if needed), `apps/server/src/db/schema.ts` + migration, `apps/server/src/config.ts` (+ test), `apps/server/src/app.ts`, `authz-sweep.test.ts`, `apps/server/src/audit/**` (names)
- `apps/web/src/**` (routes, components, lib, mock, tests)
- `docs/SERVER_CONFIG.md`, `work/T-0115-invite-links.md`

**Not allowed:** mobile, packages, dependencies.

### Tests
- Server: token shown once, hash stored, join adds the member and syncs rooms (fake admin client), atomic `max_uses` under concurrency (two parallel joins on a 1-use link → exactly one), expiry, revoke, exhausted, invalid all identical 404, already member consumes nothing, `group_full`, rate limits, audit without the token, 401 without session, sweep.
- Web: JoinPage states, signed-out redirect and return, panel create/copy/revoke, mock mode.

### Acceptance criteria
- [ ] A link joins exactly the group it was made for, as `member`, within its limits; revoking works at once.
- [ ] The token is never stored, logged or audited; failure answers do not reveal why.
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
- Join requests that need admin approval, links to private topics, links that create accounts, mobile UI, QR codes (a later small task), usage or cost tracking.

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
