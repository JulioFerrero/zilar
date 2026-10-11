---
id: T-1108
title: "Dedup S7: the hand-written per-user rate-limit layers in groups, topics, invite-links (and integrations if identical) use the shared rateLimitLayer, moved unchanged"
status: merged
milestone: M5
branch: task/T-1108-rate-limit-layers-to-factory
model: auto
effort: default
depends_on: [T-1103]
estimate: 0.15 day
---

# T-1108: Rate-limit layers use the shared factory

## Spec (written by Claude, do not edit)

### Why
Julio approved the security dedups, "moved unchanged", on 2026-10-11 (slice S7 in `docs/audit/dedup-status.md` §4).

**The shared factory:** `apps/server/src/effect/rate-limit-middleware.ts:35-56`, `rateLimitLayer(tag, limiter, message)`. It reads `CurrentUser`, and when `!limiter.allow(user.id)` it answers `httpErrorResponse(requestIdOf(request), new HttpError(429, 'rate_limited', message))`; otherwise it runs the endpoint.

**These four functions are the same code** with a fixed tag and message (read by the lead):
- `apps/server/src/topics/api.ts:57-74`, `createRateLimitLayer`: tag `TopicsCreateRateLimit`, message 'Too many topics, try again later', used at `:300`;
- `apps/server/src/groups/api.ts:63-80`, `roleRateLimitLayer`: tag `GroupsRoleRateLimit`, message 'Too many role changes, try again later', used at `:364`;
- `apps/server/src/groups/api.ts:84-101`, `joinRateLimitLayer`: tag `GroupsJoinRateLimit`, message 'Too many join attempts, try again later', used at `:365`;
- `apps/server/src/invite-links/api.ts:82-99`, `previewRateLimitLayer`: tag `InviteLinksPreviewRateLimit`, message 'Too many join attempts, try again later', used at `:222`.

The audit also lists `apps/server/src/integrations/api.ts:62` (`telegramRateLimitLayer`) and `:92` (`emailRateLimitLayer`).

### What to build
1. **Replace each of the four functions** with `rateLimitLayer(<Tag>, <limiter>, '<same message>')` at its use site, and delete the function. Keep each limiter (its `max`, `windowMs` and key, which is `user.id` in all four) and its exact message.
2. **If a tag's type does not fit `rateLimitTag`'s `RateLimitTag`,** see how the already-adopted sites declare theirs (for example `apps/server/src/blocks/api.ts` and `apps/server/src/pins/api.ts`) and declare it the same way, without changing the tag's id string.
3. **`integrations/api.ts:62` and `:92`:** convert them **only if** their body is the same shape (keyed by `user.id`, 429 `rate_limited`, one message). Otherwise leave them and say why in the Report.
4. **Inline `allow(...)` checks inside handlers** (for example `invite-links/api.ts:208,211`) are **out of scope**: their keys differ.
5. **Tests:** run the existing tests next to these modules, `groups`, `topics`, `invite-links` and `integrations` (find them with `ls apps/server/src/<module>/*.test.ts`). Paste the results.
6. **Proof in the Report:** for each converted site, the tag, limiter, key and message before and after (they must be identical), plus `git diff main --stat`.
7. **No other files change.** Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `apps/server/src/effect/rate-limit-middleware.ts`, the four files above, and `apps/server/src/blocks/api.ts` (an adopted example).

### Allowed files
`apps/server/src/topics/api.ts`, `apps/server/src/groups/api.ts`, `apps/server/src/invite-links/api.ts`, `apps/server/src/integrations/api.ts`, `apps/server/src/topics/schemas.ts`, `apps/server/src/groups/schemas.ts`, `work/T-1108-rate-limit-layers-to-factory.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass, and the nearby module tests are green.
- The Report has the before/after table.

---

## Report (written by the worker when done)

### What I did
Replaced the four hand-written per-user rate-limit layers with the shared
`rateLimitLayer(tag, limiter, message)` from
`apps/server/src/effect/rate-limit-middleware.ts:36`, moving them unchanged
(same tag, same limiter, same key `user.id`, same message). Each local layer
function was deleted.

Files changed (`git status --short`):
- `apps/server/src/topics/api.ts`
- `apps/server/src/groups/api.ts`
- `apps/server/src/invite-links/api.ts`
- `work/T-1108-rate-limit-layers-to-factory.md` (status + Report)

`apps/server/src/integrations/api.ts`, `topics/schemas.ts` and `groups/schemas.ts`
were **not** touched. Each file is under 400 lines (topics 285, groups 331,
invite-links 213, integrations 289).

### Before/after proof (tag, limiter, key and message identical)

| Site | Tag | Limiter (max / window / key) | Message | Before | After |
| --- | --- | --- | --- | --- | --- |
| `topics/api.ts` create | `TopicsCreateRateLimit` | `TOPIC_CREATE_RATE_LIMIT_MAX=30` / `60*60*1000` / `user.id` | `Too many topics, try again later` | local `createRateLimitLayer` fn (deleted) | `rateLimitLayer(TopicsCreateRateLimit, createLimiter, '…')` at the provide site |
| `groups/api.ts` role change | `GroupsRoleRateLimit` | `ROLE_CHANGE_RATE_LIMIT_MAX=30` / `60*60*1000` / `user.id` | `Too many role changes, try again later` | local `roleRateLimitLayer` fn (deleted) | `rateLimitLayer(GroupsRoleRateLimit, roleLimiter, '…')` |
| `groups/api.ts` public join | `GroupsJoinRateLimit` | `PUBLIC_JOIN_RATE_LIMIT_MAX=30` / `60*60*1000` / `user.id` | `Too many join attempts, try again later` | local `joinRateLimitLayer` fn (deleted) | `rateLimitLayer(GroupsJoinRateLimit, joinLimiter, '…')` |
| `invite-links/api.ts` preview | `InviteLinksPreviewRateLimit` | `JOIN_PREVIEW_RATE_LIMIT_MAX_PER_USER=120` / `60*60*1000` / `user.id` | `Too many join attempts, try again later` | local `previewRateLimitLayer` fn (deleted) | `rateLimitLayer(InviteLinksPreviewRateLimit, previewLimiter, '…')` |

The factory already answers `429 rate_limited` from `CurrentUser` and `user.id`,
so the behaviour is byte-for-byte the old layers' `if (!limiter.allow(user.id))`
branch. No tag had to be re-declared: `TopicsCreateRateLimit`,
`GroupsRoleRateLimit`, `GroupsJoinRateLimit` and `InviteLinksPreviewRateLimit`
are already `HttpApiMiddleware.Service<Self, { requires: CurrentUser }>` in
`packages/api-contract/src/middleware.ts`, the same shape as the adopted
`BlocksWriteRateLimit` / `PinsWriteRateLimit`, so they fit `rateLimitLayer`'s
`RateLimitTag`. Unused imports (`CurrentUser`, `HttpServerRequest`, `HttpError`,
`httpErrorResponse`, `requestIdOf`, `Effect`, `RateLimiter`) were removed from
the modules that no longer need them.

### `integrations/api.ts` — left unchanged (spec point 3)
`telegramRateLimitLayer` and `emailRateLimitLayer` are **not** the same shape as
the factory. Both first read `isOwner(db, user.id)` and answer 404 for a
non-owner (the Telegram budget explicitly documents the owner check as running
before the limiter), and `emailRateLimitLayer` additionally answers 409
`managed_by_environment` before the limiter. The shared `rateLimitLayer` only
does `!limiter.allow(user.id)` → 429, so converting them would drop the 404
owner gate and the 409 env guard. Left as-is.

### Out of scope (spec point 4)
The inline `userJoinLimiter.allow(user.id)` / `ipJoinLimiter.allow(clientIp(...))`
checks in the invite-links `join` handler (`invite-links/api.ts:186-189`) were
left untouched: the second key is the client IP, so the shapes differ.

### Commands run (real results)
- `pnpm install`: Done in 20s (pnpm v10.32.1), no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/visibility.test.ts src/invite-links/invite-links.test.ts src/invite-links/contract.smoke.test.ts`: Test Files 3 passed (3), Tests 48 passed (48).
- `pnpm gate` (from the repo root), final run:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.7s)
  PASS  lint  (0.6s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/server  (14.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (The first gate run failed on `format` for `groups/api.ts` and on two
  `no-unused-vars` lint errors for the now-unused `Effect` import; both were
  fixed, the run above is green.)

### `git diff main --stat`
```
 apps/mobile/app.json                        |  18 +----
 apps/mobile/src/app/+native-intent.tsx      |   9 ---
 apps/mobile/src/lib/web-link.ts             | 107 ---------------------------
 apps/server/src/groups/api.ts               |  67 +++--------------
 apps/server/src/invite-links/api.ts         |  38 +++-------
 apps/server/src/topics/api.ts               |  38 +++-------
 apps/web/public/.well-known/assetlinks.json |  12 ---
 work/BOARD.md                               |   3 +-
 work/NOW.md                                 |  12 ---
 work/T-1106-android-app-links.md            | 110 +---------------------------
 work/T-1108-rate-limit-layers-to-factory.md |   2 +-
 work/T-1109-xmpp-unavailable-constructor.md |  64 ----------------
```
Only the three `apps/server/src/*` files and this task file are mine; the
`apps/mobile/*`, `apps/web/*`, `work/BOARD.md`, `work/NOW.md` and the T-1106 /
T-1109 entries are other tasks that landed on `main` after this branch was cut
(`git log main ^HEAD` shows f9ab06c4 T-1106, 6f87039b NOW, 61f1fd0e T-1109).
`pnpm gate` diffs against the merge base and reports exactly the 4 files I
changed, all inside the Allowed files.

### Problems / deviations / open questions
None. No dependencies added, no secrets touched, no checks disabled.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** the four hand-written layers (topics create, groups role, groups join and the invite-links preview) are now `rateLimitLayer(<Tag>, <limiter>, '<message>')`. The tag, the limiter (with its `max`, window and `user.id` key) and the message stay the same; the lead read each added line.
- **`integrations/api.ts` is left as it is,** correctly: its two layers have a different shape (a pre-check, and `emailRateLimitLayer` also answers 409).
- **Tests:** the worker ran `groups/visibility`, `invite-links` and `invite-links/contract.smoke`, all 48 green. The gate passed.
