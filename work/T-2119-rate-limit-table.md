---
id: T-2119
title: "Server: one RATE_LIMITS table in apps/server/src/rate-limit.ts (name → max + window) and a limiter(name, now) helper replace the 113 per-module *_RATE_LIMIT_MAX / *_WINDOW_MS constants and the 62 five-line createRateLimiter blocks — same numbers, same behaviour"
status: merged
milestone: M5
branch: task/T-2119-rate-limit-table
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2119: One rate-limit table

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down, and the code must be easier for AIs and humans to read. Today every module declares its own budget as two exported constants, then builds the limiter in a five-line block, for example `apps/server/src/push/api.ts:23-30` and `:64-68`:
```ts
export const PUSH_TEST_RATE_LIMIT_MAX = 5;
export const PUSH_TEST_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
…
createRateLimiter({
  max: PUSH_TEST_RATE_LIMIT_MAX,
  windowMs: PUSH_TEST_RATE_LIMIT_WINDOW_MS,
  now,
});
```
The lead counted, at `bb6e319ef`, 62 `createRateLimiter({` blocks and 113 `*_RATE_LIMIT_*` constants across 44 product files. One table also lets a reviewer see every budget in one place, which the security checklist in `AGENTS.md` asks for ("every write has a rate limit or a cap").

### Steps
1. **The table.** In `apps/server/src/rate-limit.ts`, add:
   ```ts
   const MINUTE = 60_000;
   export const RATE_LIMITS = {
     pushTest: { max: 5, windowMs: 10 * MINUTE },
     // … one line per budget, the same numbers as today
   } as const satisfies Record<string, { max: number; windowMs: number }>;
   export function limiter(name: keyof typeof RATE_LIMITS, now?: () => number): RateLimiter {
     return createRateLimiter({ ...RATE_LIMITS[name], now });
   }
   ```
   - Group the entries by module with one short comment line per group, and sort the groups by module name.
   - Name each entry after its constant in camelCase without `RATE_LIMIT` (`PUSH_TEST_RATE_LIMIT_MAX` → `pushTest`).
   - Keep every number exactly as it is today.
2. **Each module.**
   - Replace each `createRateLimiter({ max: X_MAX, windowMs: X_WINDOW_MS, now })` with `limiter('x', now)`, keeping any `deps.someLimiter ??` override in front of it.
   - A block with literal numbers (for example `chats/api.ts`: `createRateLimiter({ max: 60, windowMs: 10 * 60 * 1000, now })`) gets its own table entry too.
   - Delete the module's `*_RATE_LIMIT_MAX` / `*_WINDOW_MS` constants.
3. **Constants used elsewhere.** If a constant is used for something other than building the limiter (an error message, a test loop), read it from `RATE_LIMITS.x.max` or `RATE_LIMITS.x.windowMs`.
4. **Tests.** Tests that import a deleted constant use `RATE_LIMITS.x.*` instead. No new tests.
5. **No behaviour change:** same numbers, same keys, same order of checks. The only change is where the numbers live.
6. **Report** the line counts, and paste the final table into the Report so the lead can compare it with the old constants.

### Allowed files
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/agents/memory/api.ts`
- `apps/server/src/app/routes-messaging.ts`
- `apps/server/src/auth/api.ts`
- `apps/server/src/auth/auth.ts`
- `apps/server/src/auth/export.ts`
- `apps/server/src/auth/invites.test.ts`
- `apps/server/src/avatars/api.ts`
- `apps/server/src/avatars/service.ts`
- `apps/server/src/backgrounds/api.ts`
- `apps/server/src/backgrounds/service.ts`
- `apps/server/src/card-media/api.ts`
- `apps/server/src/chat-folders/api.ts`
- `apps/server/src/chat-prefs/api.ts`
- `apps/server/src/chats/api.ts`
- `apps/server/src/chats/delete-own.ts`
- `apps/server/src/connections/api.ts`
- `apps/server/src/contact-requests/api.ts`
- `apps/server/src/files/api.ts`
- `apps/server/src/gifs/api.ts`
- `apps/server/src/gifs/routes.ts`
- `apps/server/src/groups/api.ts`
- `apps/server/src/groups/visibility.test.ts`
- `apps/server/src/handles/api.ts`
- `apps/server/src/integrations/api.ts`
- `apps/server/src/integrations/routes.ts`
- `apps/server/src/invite-links/api.ts`
- `apps/server/src/invite-links/invite-links.test.ts`
- `apps/server/src/invite-links/tokens.ts`
- `apps/server/src/machines/api.ts`
- `apps/server/src/media/api.ts`
- `apps/server/src/message-blocks/api.ts`
- `apps/server/src/push/api.ts`
- `apps/server/src/rate-limit.test.ts`
- `apps/server/src/rate-limit.ts`
- `apps/server/src/search/api.ts`
- `apps/server/src/search/routes.ts`
- `apps/server/src/setup/api.ts`
- `apps/server/src/stickers/api-handlers.ts`
- `apps/server/src/stickers/api.ts`
- `apps/server/src/stickers/routes.ts`
- `apps/server/src/tools/adapter-support.ts`
- `apps/server/src/tools/routes.ts`
- `apps/server/src/topics/api.ts`
- `apps/server/src/voice-transcription/api.ts`
- `apps/server/src/voice-transcription/routes.ts`
- `apps/server/src/web-tools/shared.ts`
- `apps/server/src/xmpp/api.ts`
- `work/T-2119-rate-limit-table.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and the server tests the gate runs pass.
- Product lines are at least 200 lower.
- **Lead check:** the table holds the same numbers as the old constants, one entry for each.

---

## Report (written by the worker when done)

### What I did

- Added `RATE_LIMITS` (61 named budgets) and `limiter(name, now = Date.now)` to `apps/server/src/rate-limit.ts`.
- Replaced all 61 `createRateLimiter({ max: …, windowMs: … })` call sites in the allowed product files with `limiter('<name>', now)`, keeping every injected `deps.*Limiter` override in front of it.
- Deleted the per-module `*_RATE_LIMIT_MAX` / `*_RATE_LIMIT_WINDOW_MS` constants from the API and route files.
- Updated the two tests that imported deleted constants (`auth/invites.test.ts`, `groups/visibility.test.ts`) to read `RATE_LIMITS.x.max`.
- No numbers, keys, check order or budgets changed; only where the numbers live.

Line counts (`git diff --numstat -- apps/server/src`):

- 44 server files changed: 217 insertions, 595 deletions, net **-378** lines.
- `apps/server/src/rate-limit.ts`: 61 → 163 lines (+102, includes the table).
- `app/routes-messaging.ts`: 683 → 639 lines; `topics/api.ts`: 507 → 489; `stickers/api-handlers.ts`: 414 → 407; `search/routes.ts`: 409 → 407.

Final table (from `apps/server/src/rate-limit.ts`):

```ts
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RATE_LIMITS = {
  // agents
  aiMemoryWrite: { max: 60, windowMs: MINUTE },
  // app
  blockRead: { max: 120, windowMs: MINUTE },
  blockWrite: { max: 30, windowMs: 10 * MINUTE },
  contactsWrite: { max: 30, windowMs: 10 * MINUTE },
  directory: { max: 30, windowMs: 10 * MINUTE },
  pinsWrite: { max: 60, windowMs: MINUTE },
  // auth
  authInvite: { max: 10, windowMs: DAY },
  authMe: { max: 10, windowMs: 10 * MINUTE },
  export: { max: 1, windowMs: HOUR },
  // avatars
  avatarRead: { max: 600, windowMs: 10 * MINUTE },
  avatarUpload: { max: 10, windowMs: HOUR },
  // backgrounds
  backgroundUpload: { max: 20, windowMs: HOUR },
  // card-media
  cardMediaRead: { max: 600, windowMs: 10 * MINUTE },
  // chat-folders
  chatFoldersWrite: { max: 60, windowMs: MINUTE },
  // chat-prefs
  chatPrefsWrite: { max: 60, windowMs: MINUTE },
  // chats
  chatHistoryWrite: { max: 60, windowMs: MINUTE },
  chatRead: { max: 600, windowMs: 10 * MINUTE },
  chatReply: { max: 60, windowMs: 10 * MINUTE },
  // connections
  connectionTest: { max: 5, windowMs: MINUTE },
  connectionWrite: { max: 10, windowMs: MINUTE },
  // contact-requests
  byHandle: { max: 30, windowMs: 10 * MINUTE },
  contactRequestCreate: { max: 20, windowMs: DAY },
  contactRequestRead: { max: 60, windowMs: MINUTE },
  userSearch: { max: 120, windowMs: 10 * MINUTE },
  // files
  files: { max: 600, windowMs: MINUTE },
  // gifs
  gif: { max: 30, windowMs: MINUTE },
  gifMedia: { max: 600, windowMs: MINUTE },
  // groups
  groupCreate: { max: 20, windowMs: HOUR },
  publicJoin: { max: 30, windowMs: HOUR },
  roleChange: { max: 30, windowMs: HOUR },
  // handles
  handleCheck: { max: 30, windowMs: 10 * MINUTE },
  handleClaim: { max: 10, windowMs: DAY },
  // integrations
  integrationsEmail: { max: 5, windowMs: 10 * MINUTE },
  integrationsTelegram: { max: 10, windowMs: 10 * MINUTE },
  // invite-links
  joinPerIp: { max: 60, windowMs: HOUR },
  joinPerUser: { max: 20, windowMs: HOUR },
  joinPreviewPerUser: { max: 120, windowMs: HOUR },
  // machines
  machineWrite: { max: 30, windowMs: MINUTE },
  pairGlobal: { max: 30, windowMs: MINUTE },
  pairIp: { max: 10, windowMs: MINUTE },
  pairingCode: { max: 10, windowMs: HOUR },
  // media
  linkPreview: { max: 60, windowMs: MINUTE },
  media: { max: 30, windowMs: MINUTE },
  // message-blocks
  blocksRespond: { max: 120, windowMs: MINUTE },
  // push
  pushPreview: { max: 120, windowMs: MINUTE },
  pushSettings: { max: 60, windowMs: MINUTE },
  pushSubscribe: { max: 30, windowMs: MINUTE },
  pushTest: { max: 5, windowMs: 10 * MINUTE },
  // search
  search: { max: 30, windowMs: MINUTE },
  // setup
  setup: { max: 5, windowMs: 10 * MINUTE },
  // stickers
  stickerUpload: { max: 60, windowMs: HOUR },
  telegramImport: { max: 3, windowMs: HOUR },
  // tools
  toolRun: { max: 5, windowMs: MINUTE },
  toolRunsPerHour: { max: 6, windowMs: HOUR },
  // topics
  topicCreate: { max: 30, windowMs: HOUR },
  topicJoin: { max: 60, windowMs: HOUR },
  topicPreview: { max: 120, windowMs: HOUR },
  // voice-transcription
  voiceTranscript: { max: 10, windowMs: 10 * MINUTE },
  voiceTranscriptOwner: { max: 10, windowMs: 10 * MINUTE },
  // web-tools
  webActionsPerHour: { max: 30, windowMs: HOUR },
  // xmpp
  token: { max: 120, windowMs: 10 * MINUTE },
} as const satisfies Record<string, { max: number; windowMs: number }>;
```

### Checks run

Single test files while working:

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/rate-limit.test.ts` → 1 file, 8 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/invites.test.ts src/groups/visibility.test.ts` → 2 files, 34 tests passed.

`pnpm gate` (first run failed only on formatting of 4 files; fixed with `prettier --write` on those 4 and reran):

```text
gate: 45 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.6s)
PASS  lint  (1.1s)
PASS  typecheck  (5.0s)
PASS  effect  (2.4s)
PASS  build @zilar/server  (0.7s)
PASS  tests @zilar/server  (256.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
WARN  size: apps/server/src/app/routes-messaging.ts: 639 lines (main 683); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
WARN  size: apps/server/src/search/routes.ts: 407 lines (main 409); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
WARN  size: apps/server/src/stickers/api-handlers.ts: 407 lines (main 414); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
WARN  size: apps/server/src/topics/api.ts: 489 lines (main 507); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Notes for the lead

- `tools/adapter-support.ts` keeps `TOOL_RUNS_PER_HOUR` and `TOOL_RUN_WINDOW_MS` exports because `tools/adapters.ts` (outside Allowed files) re-exports them. They now read from `RATE_LIMITS.toolRunsPerHour` instead of duplicating the numbers.
- `files/api.ts` keeps one `createRateLimiter` call in the `deps.rateLimitMax !== undefined` branch so the existing test override still works; the normal path uses `limiter('files', now)`. Losing that branch would change behaviour.
- `auth/auth.ts` (better-auth's own rate-limit config) and `agents/gateway/group-turn.ts` (a user-facing notice string) had no `createRateLimiter` budget and were left untouched.
- `invite-links/invite-links.test.ts` still builds custom one-off limiters with `createRateLimiter`; it imports no deleted constant.
- Full `pnpm gate` passed; no files outside Allowed files were changed.

## Review (written by Claude)

Approved; the pre-review was clean (1 nit). Net −378 across 44 files. Every server budget now lives in one `RATE_LIMITS` table (61 entries) in `apps/server/src/rate-limit.ts`, built through `limiter(name, now)`.
- **Lead check** (`tmp/cc/rl-compare.py` against a snapshot of the 114 old constant lines taken before launch):
  - 53 entries match an old max and window pair directly.
  - The other 8 were read by hand in main and also match. Their old max and window had different names or a shared window: gif media 600/min, pair global 30/min, pair IP 10/min, join per user 20/h, join per IP 60/h, join preview 120/h, tool runs 6/h, web actions 30/h.
- No `*_RATE_LIMIT_*` constant and no hand-built `createRateLimiter({` block is left outside `rate-limit.ts`. The one exception is `files/api.ts:152`, which keeps its injected `rateLimitMax` override.
- The gate ran the server tests and they passed.
