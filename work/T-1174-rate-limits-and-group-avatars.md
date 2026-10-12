---
id: T-1174
title: "SEC-7 + SEC-8: per-user budgets on invite creation (10/day), profile edits (10/10 min), group creation (20/h) and avatar reads; a group's avatar and background are served only to its members"
status: merged
milestone: M5
branch: task/T-1174-rate-limits-and-group-avatars
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1174: Budgets on writes, private group pictures

## Spec (written by Claude, do not edit)

### Why
`docs/audit/security-audit.md` SEC-7 and SEC-8 (P2, confirmed by code).
- **SEC-7, no limiter on these:**
  - `createInvite` (`apps/server/src/auth/api.ts:121-131`; the contract group declares only `Session`, `packages/api-contract/src/auth.ts:92-93`), so one account mints unlimited one-use sign-up codes;
  - `patchMe` (`auth/api.ts:107-120`), which pushes the nickname into every contact's roster through ejabberd;
  - group create (`apps/server/src/groups/api.ts:67-91`), which creates a MUC room;
  - avatar reads (`apps/server/src/avatars/api.ts:165-187`).
- **The existing pattern to copy:**
  - the contract middleware classes are in `packages/api-contract/src/middleware.ts:110-127` (`GroupsRoleRateLimit`, `GroupsJoinRateLimit`), attached with `.middleware(...)` (`packages/api-contract/src/groups.ts:174,201`);
  - the server builds them with `createRateLimiter` (`apps/server/src/rate-limit.ts`; used at `groups/api.ts:85-95`) and provides them with `rateLimitLayer(...)` (`groups/api.ts:318-321`).
- **SEC-8:** `GET /api/avatars/:id` serves any avatar to any signed-in user (`avatars/api.ts:159-164`, the comment says so), and backgrounds do the same (`apps/server/src/backgrounds/api.ts:125-133`). That's fine for user pictures, but weak for private groups. `apps/server/src/avatars/service.ts:119-140` already has the owner-kind lookup.

### What to build
1. **Three contract middlewares** in `middleware.ts`, following `GroupsRoleRateLimit`: `AuthInviteRateLimit`, `AuthMeRateLimit` and `GroupsCreateRateLimit`. Attach them to `createInvite` and `patchMe` (`packages/api-contract/src/auth.ts`) and to group create (`packages/api-contract/src/groups.ts`).
2. **Server limiters**, per user:
   - invites: 10 per 24 h;
   - me: 10 per 10 min;
   - group create: 20 per hour.
   Provide them with `rateLimitLayer` where the auth and groups APIs are built. The messages read "Too many …, try again later", like the existing ones.
3. **Avatar reads:** an in-handler limiter in `avatars/api.ts` `serve`, 600 per 10 min per user. Over the budget, answer 429 as the other limiters do.
4. **SEC-8:** in `serve` (avatars) and the background read (backgrounds), when the file belongs to a **group** (owner kind `group`), check that the viewer is a member of that group. If not, answer the **same 404** as an unknown id. User and AI avatars stay as they are.
   - Put the membership query in `avatars/service.ts` (and reuse it for backgrounds if the owner model matches; otherwise cite the backgrounds owner model and do the same there).
5. **Tests** (permissions), at most 2, in the nearest existing server test files, or a new `apps/server/src/avatars/access.test.ts`:
   - a non-member gets 404 for a group avatar, and a member gets 200;
   - the 11th invite in a day gets 429.

### Read first
`AGENTS.md`, `docs/audit/security-audit.md` (SEC-7, SEC-8), `packages/api-contract/src/middleware.ts`, `packages/api-contract/src/auth.ts`, `packages/api-contract/src/groups.ts:1-30,160-206`, `apps/server/src/auth/api.ts`, `apps/server/src/groups/api.ts:60-100,300-327`, `apps/server/src/rate-limit.ts`, `apps/server/src/avatars/api.ts`, `apps/server/src/avatars/service.ts` and `apps/server/src/backgrounds/api.ts`.

### Allowed files
`packages/api-contract/src/middleware.ts`, `packages/api-contract/src/auth.ts`, `packages/api-contract/src/groups.ts`, `apps/server/src/auth/api.ts`, `apps/server/src/groups/api.ts`, `apps/server/src/avatars/api.ts`, `apps/server/src/avatars/service.ts`, `apps/server/src/avatars/access.test.ts`, `apps/server/src/backgrounds/api.ts`, `apps/server/src/backgrounds/service.ts`, `apps/server/src/auth/invites.test.ts`, `work/T-1174-rate-limits-and-group-avatars.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/avatars/access.test.ts src/auth/invites.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.

---

## Report (written by the worker when done)

### What I did

- **SEC-7, contract middlewares** (`packages/api-contract/src/middleware.ts`): added three
  tags after `GroupsJoinRateLimit`, same shape as `GroupsRoleRateLimit` /
  `GroupsJoinRateLimit` (`{ requires: CurrentUser }`): `AuthInviteRateLimit`,
  `AuthMeRateLimit`, `GroupsCreateRateLimit`.
- Attached them in the contract:
  - `packages/api-contract/src/auth.ts`: `.middleware(AuthMeRateLimit)` on `patchMe`,
    `.middleware(AuthInviteRateLimit)` on `createInvite`.
  - `packages/api-contract/src/groups.ts`: `.middleware(GroupsCreateRateLimit)` on `create`.
- **SEC-7, server limiters** (per user, `createRateLimiter` + `rateLimitLayer`):
  - `apps/server/src/auth/api.ts`: invites `10 / 24 h`, me `10 / 10 min`; messages
    `Too many invites, try again later` and `Too many profile changes, try again later`.
    Exported `AUTH_INVITE_RATE_LIMIT_MAX`/`_WINDOW_MS` and the me constants; added an
    optional `now?: () => number` dep for tests.
  - `apps/server/src/groups/api.ts`: group create `20 / h`, message
    `Too many group creations, try again later`. Exported the constants and added an
    optional `createLimiter?: RateLimiter` dep.
- **SEC-7, avatar reads** (`apps/server/src/avatars/api.ts`): an in-handler limiter in
  `serve`, `600 / 10 min` per user (`AVATAR_READ_RATE_LIMIT_MAX`/`_WINDOW_MS` in
  `avatars/service.ts`), charged before the lookup; over budget answers
  `429 rate_limited "Too many avatar reads, try again later"`, like the existing limiters.
- **SEC-8** (`apps/server/src/avatars/service.ts`): `readAvatarFile` takes the viewer id and,
  when the row's `ownerKind === 'group'`, reads the group's `visibility` and the viewer's
  membership in the same `groups LEFT JOIN group_members` query. The picture is served to a
  member, and to anyone when the group is public (Explore, people/group search and the
  `/@handle` join card show a public group's picture to non-members). A private group's
  non-member gets `null`, so `serve` answers the same `404 not_found` as an unknown id. User
  and AI avatars are unchanged.
- **SEC-8, backgrounds:** no change needed. `backgrounds/service.ts` `readBackgroundFile`
  already answers the same `null` for anyone who is neither the owner nor a member of a
  group that uses the image as its background (`T-0463`, the `groups.background_image_id`
  owner model). Backgrounds are personal rows referenced by groups, not group-owned rows,
  so the avatars neighbour-query does not apply there; the existing check is the equivalent gate.
  (Allowed-but-untouched: `backgrounds/api.ts`, `backgrounds/service.ts`.)
- **Tests** (2, as the spec asks):
  - `apps/server/src/avatars/access.test.ts` (new): a non-member gets 404 for a **private**
    group avatar, a member gets 200, and a non-member gets 200 for a **public** group avatar.
    Uploads real group avatars through `PUT /api/avatars/group/:id` (a 24-byte PNG header
    passes the header-only probe) into a per-test temp storage dir.
  - `apps/server/src/auth/invites.test.ts`: the 11th `POST /api/invites` in a day gets 429.

### Files changed

`packages/api-contract/src/middleware.ts`, `packages/api-contract/src/auth.ts`,
`packages/api-contract/src/groups.ts`, `apps/server/src/auth/api.ts`,
`apps/server/src/groups/api.ts`, `apps/server/src/avatars/api.ts`,
`apps/server/src/avatars/service.ts`, `apps/server/src/avatars/access.test.ts` (new),
`apps/server/src/auth/invites.test.ts`, `work/T-1174-rate-limits-and-group-avatars.md`.
Every touched file is <= 400 lines (`avatars/service.ts` is 399).

### Commands and results

- `pnpm --filter @zilar/server exec vitest run src/avatars/access.test.ts src/auth/invites.test.ts --maxWorkers=2 --reporter=dot`
  -> `Test Files 2 passed (2)`, `Tests 9 passed (9)`.
- Fix round: `pnpm --filter @zilar/server exec vitest run src/avatars/access.test.ts --maxWorkers=2 --reporter=dot`
  -> `Test Files 1 passed (1)`, `Tests 1 passed (1)` (private 404 / member 200 / public 200).
- First `pnpm gate` run: `PASS install`, `FAIL format` (4 files), scope OK, `GATE FAIL`.
  Fixed with `pnpm exec prettier --write` on those 4 files.
- `pnpm gate` (final):
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (0.8s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.6s)
  PASS  effect  (1.6s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (24.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes

- No change in `backgrounds/*`: SEC-8's background half is already enforced (T-0463); see above.
- Group-create (`GroupsCreateRateLimit`) and profile-edit (`AuthMeRateLimit`) budgets have no
  test — the spec asked for at most 2 (avatar membership, 11th invite), which are the two added.
- The three new server limiters use the existing in-memory `createRateLimiter` (per process),
  like every other budget on these routes.

### Round (fix round after prereview)

- **Finding 1 (must-fix, fixed):** `readAvatarFile` now serves a group picture only to a member.
  The public-group exemption and the `visibility` lookup are gone from
  `apps/server/src/avatars/service.ts`; the query is a plain `group_members` membership check, so
  a non-member of a public group and an unknown id both get `null` -> the same 404. The spec
  ("served only to its members") is followed; the earlier public exemption contradicted it. The
  `serve` comment in `apps/server/src/avatars/api.ts` already said "a group picture is served only
  to a member", so it now matches the code without an edit.
- **Finding 2 (should-fix, fixed):** `apps/server/src/avatars/service.ts` is now 398 lines
  (`wc -l`), under the 400-line cap. The finding-1 change already took it from 406 to 399; a small
  comment trim (module header) added margin to 398.
- **Nits:** nit 4 (stale test name) is covered by the renamed test below. Nit 3 (`readLimiter` not
  injectable) is not on a line this round changed, so it is left as is per the round rules.
- **Test adjusted:** `apps/server/src/avatars/access.test.ts` — the non-member case now also asserts
  404 for a **public** group's picture; the test is renamed to
  `'serves a group picture to a member and answers 404 to any non-member'`.
- **Commands:** `vitest run src/avatars/access.test.ts src/auth/invites.test.ts --maxWorkers=2
  --reporter=dot` -> `Test Files 2 passed (2)`, `Tests 9 passed (9)`. `pnpm gate` -> `GATE PASS`.
- **Gate summary:** `PASS install/format/lint/typecheck/effect`, `SKIP tests @zilar/api-contract`,
  `PASS tests @zilar/server (16.9s)`, `scope: every changed file is inside the Allowed files`,
  `GATE PASS`.
- No disagreements.

### Round 2 (lead override of the PREREVIEW finding on public groups)

**Lead override of the PREREVIEW finding on public groups.** The lead decided that commit
`524c3c85e` ("serve group avatars only to members") reverts the intended round-1 fix
(`cb4c4cd49`) and must come back: the spec's "members only" means **private** groups. This
overrides PREREVIEW finding 1. A future pre-review must not flag public-group avatar reads as a
bug — they are deliberate product behaviour.

- **Behaviour restored** in `apps/server/src/avatars/service.ts`: a **public** group's avatar is
  served to any signed-in user; a **private** group's avatar only to a member; a non-member of a
  private group and an unknown id both get `null` -> 404. The `groups LEFT JOIN group_members`
  query from `cb4c4cd49` is back.
- **Comments trimmed, not logic** to keep `service.ts` at **399** lines (`wc -l`), under the
  400-line cap: module header, `deleteAvatar` and the SEC-8 block.
- **`apps/server/src/avatars/api.ts`:** the `serve` comment now documents the public/private rule
  (public -> any signed-in user, private -> member only), so no future reader sees a contradiction.
- **Test** (`apps/server/src/avatars/access.test.ts`): a member gets 200 for a private group; a
  non-member gets 404 for a private group and **200** for a public group; an unknown id gets 404
  (the pre-review nit). Renamed to
  `'serves a private group picture to a member and a public one to a non-member'`.
- **Command:** `vitest run src/avatars/access.test.ts --maxWorkers=2 --reporter=dot` ->
  `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- **Gate:** `PASS install/format/lint/typecheck/effect`, `SKIP tests @zilar/api-contract`,
  `PASS tests @zilar/server (20.9s)`, `scope: every changed file is inside the Allowed files`,
  `GATE PASS`.
- `status: review` kept.

## Review (written by Claude)

**Lead, 2026-10-12: approved, after 2 lead rounds and 1 auto round (the auto round had reverted the lead's public-group fix; the lead overrode it).**
- **SEC-7, per-user budgets:**
  - `AuthInviteRateLimit`, 10 per 24 h;
  - `AuthMeRateLimit`, 10 per 10 min;
  - `GroupsCreateRateLimit`, 20 per hour;
  - an in-handler avatar read budget, 600 per 10 min.
- **SEC-8, group avatars:**
  - a private group's picture goes only to members;
  - a public group's picture goes to any signed-in user (Explore, search, the `/@handle` card);
  - a non-member and an unknown id get the same 404;
  - backgrounds were already members-only (T-0463).
- **Tests:** 9 of 9 in the branch, run by the lead (member 200, private non-member 404, unknown 404, public non-member 200, the 11th invite 429).
- **Size:** `service.ts` is at 399 lines.
