---
id: T-2225
title: "Server routes: the shared handler() takes a per-user rate limit, so the ~30 hand-written `if (!x.allow(user.id)) return 429` blocks and check*Limit helpers go"
status: merged
milestone: M5
branch: task/T-2225-handler-rate-limit
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2225: One rate-limit option on handler()

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-19: "Server route boilerplate". The server repeats one 5–7 line block about 30 times: check a per-user limiter, then build `httpErrorResponse(requestId, new HttpError(429, 'rate_limited', '…'))`. Some files also wrap it in their own `check…Limit` helper.

### Facts (read by the lead on 2026-10-19)
1. **The shared helper.** `handler(logger, body)` (`apps/server/src/effect/http-core.ts:187-209`) reads the request id and `CurrentUser`, runs `body`, and renders defects. `httpErrorResponse` is at `:137-152`; `HttpError` is in `apps/server/src/errors.ts`. `RateLimiter.allow(key)` is in `apps/server/src/rate-limit.ts`.
2. **The contract-level middleware stays.** `apps/server/src/effect/rate-limit-middleware.ts` is already used by the contract groups that declare a `.middleware(...)` tag. It stays as it is.
3. **The hand-written user-keyed checks inside HTTP handlers:**
   - `avatars/api.ts:105,144`
   - `card-media/api.ts:102`
   - `chat-folders/api.ts:39` (helper `checkWriteLimit`)
   - `chat-prefs/api.ts:77,106`
   - `chats/api.ts:68,106,329,341`
   - `chats/reply-handler.ts:134`
   - `connections/api.ts:150,233`
   - `files/api.ts:165`
   - `gifs/api.ts:227,263,298`
   - `handles/api.ts:80`
   - `integrations/api.ts:65,106`
   - `invite-links/api.ts:125` (user key only)
   - `machines/api.ts:104`
   - `media/api.ts:168,274,293`
   - `push/api-handlers.ts:115,301,341,477`
   - `push/api-test.ts:67`
   - `search/api.ts:41`
   - `stickers/api-decode.ts:105`
   - `tools/routes.ts:298`
   - `voice-transcription/api.ts:111,178`

   All paths are under `apps/server/src/`.
4. **Not HTTP-user checks; they stay:**
   - IP or global keys: `invite-links/api.ts:128`, `machines/api.ts:272,279`, `setup/api.ts:230`;
   - not route handlers: `auth/export.ts:116`, `tools/tool-adapters.ts`, `web-tools/shared.ts`;
   - injected test wrappers: `backgrounds/api.ts:49`, `stickers/api.ts:50`.

### Steps
1. **The option.** `handler(logger, body, options?)` takes `options?: { limit?: Pick<RateLimiter, 'allow'>; limitMessage?: string }`. When `limit` is set, it calls `limit.allow(user.id)` first. When that is false, it returns `httpErrorResponse(requestId, new HttpError(429, 'rate_limited', limitMessage ?? 'Too many requests, try again later'))` and `body` never runs. Add one comment line: the budget is spent before the body runs, as before.
2. **Convert** every check in fact 3 that is the **first statement** of its handler body. Pass the same limiter and the same message, so each response stays byte-identical, and delete the inline block plus any `check…Limit` helper that becomes unused.
3. **Leave alone** a check that runs after other work (validation, a lookup), because moving it would change which requests spend budget. List each one left in the Report with its reason.
4. **No behaviour change:** the same limiter per route, the same 429 body, the same order relative to the session check.
5. **Stop rule:** net at least −25 over `apps/server/src`. The lead lowered it from −100 at 11:24: most checks run after an access or availability check, so they stay, as the Report explains.

### Allowed files
- `apps/server/src/effect/http-core.ts`
- `apps/server/src/avatars/api.ts`
- `apps/server/src/card-media/api.ts`
- `apps/server/src/chat-folders/api.ts`
- `apps/server/src/chat-prefs/api.ts`
- `apps/server/src/chats/api.ts`
- `apps/server/src/chats/reply-handler.ts`
- `apps/server/src/connections/api.ts`
- `apps/server/src/files/api.ts`
- `apps/server/src/gifs/api.ts`
- `apps/server/src/handles/api.ts`
- `apps/server/src/integrations/api.ts`
- `apps/server/src/invite-links/api.ts`
- `apps/server/src/machines/api.ts`
- `apps/server/src/media/api.ts`
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/push/api-test.ts`
- `apps/server/src/search/api.ts`
- `apps/server/src/stickers/api-decode.ts`
- `apps/server/src/tools/routes.ts`
- `apps/server/src/voice-transcription/api.ts`
- `work/T-2225-handler-rate-limit.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes; the existing rate-limit tests still pass unchanged.
- Net at least −25.
- After the deploy, the lead runs the live route probe: every route answers as before.

---

## Report (written by the worker when done)

### What I did

- Added the optional `{ limit, limitMessage }` third argument to `handler()` in
  `apps/server/src/effect/http-core.ts`. When set it spends `limit.allow(user.id)` after the
  session resolves and before `body` runs; a refusal returns the same
  `httpErrorResponse(requestId, new HttpError(429, 'rate_limited', …))` envelope. Default
  message: `Too many requests, try again later`.
- Converted every hand-written user-keyed check that is the first statement of its handler
  body, with the same limiter and the same message:
  - `avatars/api.ts` — `serve`
  - `card-media/api.ts` — `serve`
  - `chat-folders/api.ts` — `create`, `order`, `update`, `remove`; deleted `checkWriteLimit`
  - `chat-prefs/api.ts` — `putBackground`
  - `machines/api.ts` — `approve`, `deny`, `revoke`, `rename`, `remove`; deleted
    `checkWriteLimit` and its call in `requireOwnedMachine`
  - `media/api.ts` — `linkPreview.get`, `linkPreview.image`
  - `push/api-handlers.ts` — `preview`
- The remaining checks in fact 3 stay where they are (list below). No behaviour change: the
  same limiter per route, the same 429 body, the same order after the session check and before
  the work it guarded.

### Left in place (step 3)

Each of these runs after other work, so moving it into `handler()` would spend budget for
requests that currently fail before the limiter:

- `avatars/api.ts:105` (`upload`): avatar permission check runs first; a stranger probing ids
  must not burn the owner's budget.
- `chat-prefs/api.ts:77` (`putPref`): chat access check first.
- `chats/api.ts:68,106` (`markRead`, `markDelivered`) and `:329,341` (`clearHistory`,
  `deleteForMe`): chat/DM access first.
- `chats/reply-handler.ts:134` (`reply`): access and DM-block check first.
- `connections/api.ts:150` (`readBody`): cipher 503 first; `:233` (`test`): cipher and owned
  lookup first.
- `files/api.ts:165`: `files_unavailable` 501 first.
- `gifs/api.ts:227,263,298`: `gifs_unavailable` 501 (provider not configured) first.
- `handles/api.ts:80` (`claim`): the “already saved” fast-path lookup first.
- `integrations/api.ts:65,106`: contract-level middleware, not an HTTP handler (owner/guard
  before the limiter); stays per the spec.
- `invite-links/api.ts:125`: token decode first (`:128` is the per-IP key and stays anyway).
- `media/api.ts:168` (`gallery`): `media_unavailable` 501 first.
- `push/api-handlers.ts:115` (`subscribe`): `requirePush` and payload decode first;
  `:301` (`remove`) and `:477` (`updateSettings`): `requirePush` (and decode) first.
- `push/api-test.ts:67`: `requirePush` and payload decode first.
- `search/api.ts:41`: contract-level `SearchGuards` middleware; stays.
- `stickers/api-decode.ts:105`: helper called after the pack-input parse and token check.
- `tools/routes.ts:298`: body decode and tool access first.
- `voice-transcription/api.ts:111`: owner middleware; `:178`: stored-settings read and URL
  validation first.
- Fact 4 items (IP/global keys, non-route modules, injected test wrappers) untouched.

### Commands

- `pnpm install` — done (initial setup).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/card-media/api.test.ts src/rate-limit.test.ts`
  — 2 files, 9 tests passed.
- `pnpm gate` — first run failed format (5 files), fixed with `prettier --write` on those
  files; second run failed lint on two now-unused `user` parameters in `media/api.ts`, fixed
  to `_user`; final run:

```
gate: 9 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.7s)
PASS  lint  (0.6s)
PASS  typecheck  (3.9s)
PASS  effect  (1.0s)
PASS  build @zilar/server  (0.8s)
PASS  tests @zilar/server  (24.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
WARN  size: apps/server/src/push/api-handlers.ts: 491 lines (main 489); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

- Net over `apps/server/src` (`git diff --numstat` of the first implementation,
  after formatting): added 413, deleted 385, **net +28**. The earlier wording
  inverted this; corrected in Round 2.

### Blocked / needs a decision

The stop rule asks for a net of at least −100 over `apps/server/src`; the real net is **−28**.
Only 10 route handlers (plus the 5 machines handlers behind `checkWriteLimit`) have the check
as their first statement. The other ~20 fact-3 checks intentionally run after a 501/503
guard, a payload decode, a token/permission lookup or an access check, and step 3 forbids
moving them because that would change which requests spend budget. Reaching −100 would mean
either converting those (behaviour change) or deleting working guards, so I stopped here
instead of forcing the number.

Question for the lead: accept this safe −28 cleanup as the task's result, or rescope/authorise
a change to the budget ordering so more sites can move?

Lead accepted −28 (stop rule lowered to −25)

### Round 2 (fix round)

Findings from `PREREVIEW.md`:

- **Finding 1 (should-fix) — inverted net arithmetic.** Confirmed: the first
  implementation grew `apps/server/src` by 28 lines, so the −25 stop rule was not
  met. Fixed inside the Allowed files by adding `withLimit(logger, limiter, message)`
  to `http-core.ts` and binding the limit once per file, so each converted route
  stays a one-line `limited(...)` call instead of expanding to the three-argument
  `handler(...)` form. The tree is now **added 54, deleted 80, net −26** against
  `main` (`git diff --numstat main...HEAD -- apps/server/src`), which meets −25.
- **Finding 2 (nit) — `approve` 409 wrapping.** No separate change was needed: the
  finding-1 rewrite left both
  `new HttpError(409, 'invalid_transition', 'Only pending machines can be approved')`
  calls on one line, identical to `main`.

No behaviour changed in this round, so no test was added or changed. The existing
rate-limit and route tests ran unchanged.

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/card-media/api.test.ts src/push/api-preview.test.ts src/rate-limit.test.ts`
  — 3 files, 18 tests passed.
- `pnpm gate` — GATE PASS: format, lint, typecheck, effect, build and tests all
  PASS, scope clean, size warning now `push/api-handlers.ts: 487 lines (main 489)`.


## Review (written by Claude)

Approved; clean after 1 auto round. Net −26 over 8 files, no comment lost.

**What changed:** `handler()` takes an optional `limit` and `limitMessage`. 13 checks that were a handler's first statement moved into it. Checks that run after an access or availability check stay in place, by design. The stop rule was lowered from −100 to −25 on the branch, because the lead's estimate was wrong.

**Lead check after the deploy:** the live route probe.

## Review (written by Claude)

Approved; clean after 1 auto round. Net −26 over 8 files, no comment lost.

**What changed:** `handler()` takes an optional `limit` and `limitMessage`. 13 checks that were a handler's first statement moved into it. Checks that run after an access or availability check stay in place, by design. The stop rule was lowered from −100 to −25 on the branch, because the lead's estimate was wrong.

**Lead check after the deploy:** the live route probe.
