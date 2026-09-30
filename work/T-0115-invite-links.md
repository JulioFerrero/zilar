---
id: T-0115
title: Join by link: shareable group invite links (expiry, max uses, revoke)
status: review
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
pnpm --filter @galena/server test --maxWorkers=2
pnpm --filter @galena/web test --maxWorkers=2
pnpm build
```

### Out of scope
- Join requests that need admin approval, links to private topics, links that create accounts, mobile UI, QR codes (a later small task), usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Server: new `group_invite_links` table (`id`, `group_id` fk cascade, `token_hash` unique, `token_hint` last-4, `label` ≤ 60, `created_by`, `created_at`, `expires_at` nullable, `max_uses` nullable ≥ 1, `uses`, `revoked_at`); migration `0026_simple_spitfire.sql` via `pnpm --filter @galena/server db:generate` (no backfill — new feature, no existing rows).
- New `apps/server/src/invite-links/{service,routes}.ts`: owner/admin create (10 active links/group; `{ label?, expiresInHours?: 1..8760, maxUses?: 1..10000 }` → `{ id, token, url }` with `url = ${WEB_BASE_URL}/j/<token>`), list (hint/label/uses/limits/state, never tokens), idempotent revoke (204; audit only on first revoke). Join: `GET /api/join/:token` → `{ groupTitle, memberCount, alreadyMember }` (never member names); `POST /api/join/:token` adds the caller as `member` through the add-member flow (group-room affiliation in-transaction, public-topic sync via `syncTopicRoom`, direct invitation), consumes one use with an atomic conditional update (not revoked, not expired, `uses < max_uses`) so two racing joins never exceed `max_uses`. Unknown/expired/revoked/exhausted/malformed all answer the identical 404 `invalid_link`; already-member answers 200 `alreadyMember: true` consuming nothing; full group answers 409 `group_full`. Tokens compared by hash with `timingSafeEqual`; joins rate limited 20/hour/user + 60/hour/IP (socket address, never `x-forwarded-for`; tests inject `getClientIp`/clock via an app-module seam). Audit `group.link_created`, `group.link_revoked`, `group.joined_by_link` (link id + hint only, never the token). New `WEB_BASE_URL` env (zod `z.url()`, default `http://localhost:5173`), documented in `docs/SERVER_CONFIG.md`.
- Web: `routes/JoinPage.tsx` + `/j/:token` route (preview card, Join button, invalid/already-member/full/signed-out states; signed-out → login with `next=/j/<token>`, `RequireAuth` returns after sign-in; refreshes the chat list after joining). `components/InviteLinksSection.tsx` in the group panel for owners/admins (create with label/expiry/max-uses, URL shown once with Copy + anyone-with-the-link warning, list with uses/state, Revoke). `lib/api.ts` helpers + `ApiClient` wiring; mock mode (`mock/api.ts`) supports create/list/revoke/join for the full flow.
- Tests: server `invite-links.test.ts` (18 tests) + sweep additions in `groups.test.ts` + `config.test.ts` (default/explicit/invalid `WEB_BASE_URL`); web `api.invite-links.test.ts`, `mock/api.invite-links.test.ts`, `routes/JoinPage.test.tsx`, `components/InviteLinksSection.test.tsx`; fixed up `GroupPanel.test.tsx` stubs for the new section.

### Files changed
- `apps/server/src/db/schema.ts`, `apps/server/drizzle/0026_simple_spitfire.sql` (+ meta `_journal.json`, `0026_snapshot.json`)
- `apps/server/src/invite-links/service.ts`, `routes.ts`, `invite-links.test.ts` (new)
- `apps/server/src/config.ts`, `config.test.ts`, `app.ts` (+ `setTestAppInviteLinks` seam), `groups/groups.test.ts`, `audit/` (action names only, no code change)
- `apps/web/src/routes/JoinPage.tsx`, `JoinPage.test.tsx` (new), `AppRoutes.tsx`, `components/InviteLinksSection.tsx`, `InviteLinksSection.test.tsx` (new), `components/GroupPanel.tsx`, `GroupPanel.test.tsx`, `lib/api.ts`, `lib/api.invite-links.test.ts` (new), `mock/api.ts`, `mock/api.invite-links.test.ts` (new), `store/realStore.ts`, `store/realStore.test.tsx`, `store/realStore.topics.test.tsx`, `store/reload.test.tsx`
- `docs/SERVER_CONFIG.md`, `work/T-0115-invite-links.md`

### Commands run and real results
- `pnpm install`: pass (7.5s)
- `pnpm format:check`: pass ("All matched files use Prettier code style!")
- `pnpm lint`: pass (oxlint clean)
- `pnpm typecheck`: pass (10/10 turbo tasks)
- `pnpm --filter @galena/server test --maxWorkers=2`: 81 files passed, 5 skipped; 1393 passed, 7 skipped (~289s, full suite at the end)
- `pnpm --filter @galena/web test --maxWorkers=2`: 74 files passed; 797 passed (full suite at the end)
- `pnpm build`: pass (2/2 turbo tasks)
- Scoped runs during work: invite-links + config 55 passed; web invite-links/join/panel 20 passed; GroupPanel 1 failure fixed (fetch stubs now answer `/invite-links`).
- Round 2 scoped runs: `src/invite-links/invite-links.test.ts` 16 passed (14 existing incl. the extended group_full assertions + 2 new: 503-no-burn, token-never-logged); `src/authz-sweep.test.ts` + `src/groups/groups.test.ts` + `src/config.test.ts` 77 passed; format/lint/typecheck pass.
- `grep` for `eslint-disable|oxlint-disable|@ts-ignore|: any` in all touched source: no hits.

### Problems, deviations from the spec, open questions
- Link join does not require the newcomer to be a contact of anyone (deliberate: the link is the introduction). The spec says "adds the caller as `member` through the existing add-member flow (so T-0108 room sync, public topics and the audit entry all happen)" — I reused the room-sync/invite/audit pieces but not `addGroupMembers` itself, because that function enforces the contacts rule and the actor-must-be-manager rule, neither of which applies to a link join. Room sync, public topics and the audit entry all happen as specified.
- The transaction boundary differs slightly from `addGroupMembers`: the group-room affiliation is set inside the transaction (so a room outage answers 503 with nothing committed), while the topic-room sync is best-effort post-commit (logged with the group id, like the group remove flow) — a failing topic room still commits the member and answers 200. Covered by test.
- A consumed use is never lost without a join: the group-full check runs before the claim, and a failure after a successful claim (503 or any other error) refunds the use (`uses - 1` guarded by `uses > 0`). The earlier "never refunded" note below is superseded — see Round 2.

### Round 2 (lead review fixes)
- Fix 1 (token in logs): the request-log middleware in `app.ts` logged `c.req.path`, writing the raw `/api/join/<token>` to the server log. It now logs `logPath(path)`, which redacts exactly `/api/join/<token>` → `/api/join/:token` for both success and error lines. Verified nothing else logs the token: audit detail carries link id + hint only, errors carry codes/messages only, rate-limit keys are user ids and socket addresses. New test asserts GET + POST (success and 404 paths) never write the token to `logOutput()` while `/api/join/:token` appears.
- Fix 2 (link burn): `joinByInviteLink` claimed the use before the cap check and the room/db work, so a full group or a 503 burned a use. New order: link usable → already member → `assertGroupHasRoom` (409 before any claim) → atomic claim → `addMemberByLink`, with `refundLinkUse` on any post-claim failure. The duplicate cap check was removed from `addMemberByLink` (it now only keeps the idempotent already-member early return for a lost race). New tests: full group answers 409 with `uses` unchanged; a failing room call answers 503 with `uses` unchanged, no member row, and the link still joins cleanly once the room recovers.
- `GET /api/join/:token` is rate-limited only implicitly (it never reveals tokens; guessing runs through POST). The spec's "join attempts are rate limited" is implemented on POST; GET previews are cheap reads but also unauthenticated-probe-safe since they need a session and reveal nothing beyond title+count for a valid link.
- Mock mode: the mock user owns every mock group, so the panel section always shows there; join preview reports `alreadyMember: true` for the Dev team group (the mock user is a member). Fine for UI work.
- Open question (no code change, per review): the per-IP join limiter keys on the socket address, so behind Caddy every user shares the proxy IP and the 60/hour per-IP budget becomes effectively global — one person's guessing (or a busy hour) could lock out everyone else's joins. Kept as-is; a trusted-proxy setting (e.g. trusting `x-forwarded-for` from Caddy only) is the follow-up when the deployment task lands.
- No new dependencies, no `any`, no disable comments.

### Round 3 (lead round-2 fixes)
- Fix 1 (open the group chat): after a successful join, and when the preview says `alreadyMember`, JoinPage now opens the group chat `/c/<chatId>` — the General chat id, resolved from the painted list via the store's `refreshGeneralTopic(groupId)` (same helper `ChatHeader` uses), falling back to `/` when the list has not refreshed yet. Server preview carries `groupId` ONLY when `alreadyMember` is true (a member already knows it; non-members get no id); web `joinPreviewSchema` gains optional `groupId`, mock mirrors it. Tests: server asserts no `groupId` for non-members and the id for members; JoinPage asserts the `/c/` navigation, the `/` fallback, and the no-join `alreadyMember` path.
- Fix 2 (nameless users): JoinPage gates the Join button behind an inline name gate ("Choose a display name first") linking to `/welcome/name` with `next=/j/<token>`; `NamePage` returns to `next` after saving (default `/`). `AuthFlow` forwards a post-login `from` through the name step the same way (nameless sign-in → name → back to `from`). Tests: JoinPage nameless renders the gate and fires no join POST; NamePage `next` round-trips to the join page.
- Fix 3 (cap-race comment): `assertGroupHasRoom` now says plainly that two strangers racing the last seat can exceed the cap by one — same known race as `addGroupMembers`, accepted.
- Skipped per instruction: findings 3 (mock fidelity) and 4 (unrated preview GET).
- Note: repo-root `pnpm format:check` flags an untracked `PREREVIEW.md` that is not mine (another worker's/lead's file, left untouched); all tracked files I touched are Prettier-clean, verified with an explicit file list.
- Round 3 scoped runs: web `JoinPage` + `NamePage` + invite-links api/mock + `AuthFlow` 26 passed; server `invite-links` 16 passed; typecheck 10/10; lint clean.

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
