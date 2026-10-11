---
id: T-1108
title: "Dedup S7: the hand-written per-user rate-limit layers in groups, topics, invite-links (and integrations if identical) use the shared rateLimitLayer, moved unchanged"
status: todo
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

## Review (written by Claude)
