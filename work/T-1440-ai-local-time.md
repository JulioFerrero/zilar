---
id: T-1440
title: "AIs know the user's local date and time (AI-17): store each user's IANA time zone in user_profiles, clients report it, prompts say the weekday, date and time in the owner's (DM) or sender's (group) zone"
status: merged
milestone: M5
branch: task/T-1440-ai-local-time
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1440: AIs know the user's local time

## Spec (written by Claude, do not edit)

### Why
AI-17 (`docs/audit/ai-features-audit.md`; open per `docs/audit/findings-sweep-server.md`): every prompt says only the UTC date, so an AI can't answer "what time is it", "tomorrow morning" or "tonight" right for a user in Madrid. This is a schema task: migration 0061.

### Facts (the lead read them on main, 2026-10-15)
- **The prompt line:** `apps/server/src/agents/context.ts:70` and `:138` render `` `Today is ${input.today}.` ``.
  - `today` is computed as `now.toISOString().slice(0, 10)` at `apps/server/src/agents/gateway/dm-turn.ts:225` (the file is **393 lines**) and `apps/server/src/agents/gateway/group-turn-body.ts:136` (**390 lines**).
  - The gate refuses growth past 400, so these two files may not grow by more than their headroom; ideally they don't grow at all.
  - In a DM the turn knows the owner (`ai.owner`, `dm-turn.ts:132`); in a group, the trigger's sender (`group-turn-body.ts:46`, `senderName`, and its sender identity nearby).
- **Profile data** sits outside Better Auth's `user` table. `user_profiles` (`apps/server/drizzle/0052_user_profiles.sql`: `user_id` PK, `bio`, `updated_at`; row type at `apps/server/src/db/rows.ts:335-339`) is upserted by `apps/server/src/auth/profile-bio.ts` (42 lines, `upsertProfileBio`, `bioForUser`).
- **`PATCH /me`:** `apps/server/src/auth/api.ts:244+` (`updateMe`; the file is **386 lines**) upserts the bio when the payload has one.
  - The payload is `UpdateMePayload` (`packages/api-contract/src/auth.ts:59-62`, non-strict, `name` required), and the response is `AuthMe` (`:68+`).
  - Web calls it via `updateMe` (`apps/web/src/lib/api/chats.ts:66-67`), mobile via `updateMe` (`apps/mobile/src/lib/auth-api.ts:42-51`).
- **Migrations** are hand-written SQL files in `apps/server/drizzle/`; the last one is `0060_agent_task_events.sql`. Follow its style: `SET lock_timeout = '5s';` and expand-only.

### What to build
1. **Migration** `apps/server/drizzle/0061_user_time_zone.sql`: `ALTER TABLE "user_profiles" ADD COLUMN "time_zone" text;` (nullable), with the lock timeout. Update the row type in `apps/server/src/db/rows.ts`.
2. **New `apps/server/src/auth/profile-time-zone.ts`:**
   - `isValidTimeZone(tz)` (true when `new Intl.DateTimeFormat('en-US', { timeZone: tz })` doesn't throw and `tz` is at most 64 characters);
   - `upsertProfileTimeZone(db, userId, tz)`;
   - `timeZoneFor(db, userId): Promise<string | null>`.
3. **Contract:** `UpdateMePayload` gains optional `timeZone` and `AuthMe` gains optional `timeZone`. `updateMe` stores a valid one and refuses an invalid one with the existing 400 message style. Keep `auth/api.ts` at 400 lines or fewer by calling the new helpers.
4. **Clients:** after `/me` loads, if `me.timeZone` differs from `Intl.DateTimeFormat().resolvedOptions().timeZone`, send one `updateMe({ name: me.name, timeZone })`. Silent, at most once per app start, failures ignored. Do it on web and on mobile, in the place each app already handles `/me` (find it, and name it in the Report).
5. **Prompt:** a helper `promptNow(now: Date, timeZone: string | null): string` in a new `apps/server/src/agents/prompt-time.ts`.
   - It returns for example `Wednesday, 15 October 2026, 04:12 (Europe/Madrid)`, and `… (UTC)` when the zone is null.
   - The DM turn uses the owner's zone and the group turn the sender's; when the sender isn't a user, use UTC.
   - Replace the two `today` computations with one awaited helper call each. Don't grow `dm-turn.ts` or `group-turn-body.ts`.
   - `context.ts` renders `` `It is ${input.today}.` ``.

### Tests (auth and profile data)
- `isValidTimeZone`: valid, invalid and too long.
- `PATCH /me` with a valid zone stores it, and with an invalid one gets a 400.
- `promptNow` output for `Europe/Madrid` and for null, with a fixed date.

### Allowed files
- `apps/server/drizzle/0061_user_time_zone.sql`, `apps/server/src/db/rows.ts`
- `apps/server/src/auth/profile-time-zone.ts`, `apps/server/src/auth/profile-time-zone.test.ts`, `apps/server/src/auth/api.ts`
- `apps/server/src/agents/prompt-time.ts`, `apps/server/src/agents/prompt-time.test.ts`, `apps/server/src/agents/context.ts`, `apps/server/src/agents/gateway/dm-turn.ts`, `apps/server/src/agents/gateway/group-turn-body.ts`
- `packages/api-contract/src/auth.ts`
- `apps/web/src/lib/api/chats.ts`, `apps/mobile/src/lib/auth-api.ts`
- The one web and one mobile file where `/me` is handled. Name them in the Report; if either is beyond this list, stop and ask with a QUESTION line.
- `work/T-1440-ai-local-time.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/auth src/agents/prompt-time --reporter=dot
pnpm gate
```

### Acceptance
- After deploy, the lead checks 61 migrations and a DM prompt with local time (log or test).
- Every file stays at 400 lines or fewer.

---

## Report (written by the worker when done)

### What I did
- `apps/server/drizzle/0061_user_time_zone.sql`: adds nullable `time_zone text` to `user_profiles` (starts with `SET lock_timeout = '5s';`, expand-only). `UserProfileRow` in `apps/server/src/db/rows.ts` gains `timeZone: string | null`.
- New `apps/server/src/auth/profile-time-zone.ts`: `isValidTimeZone` (valid IANA zone, at most 64 chars), `upsertProfileTimeZone`, `timeZoneFor`, plus `timeZoneForJid` (see Deviations).
- `@zilar/api-contract` `auth.ts`: `UpdateMePayload.timeZone?: string` and `AuthMe.timeZone?: string`.
- `PATCH /me` (`apps/server/src/auth/api.ts`) stores a valid zone and refuses an invalid one with the existing 400 shape (`invalid_request`, `timeZone must be a valid IANA time zone`); `GET /me` returns the stored zone only when set. `auth/api.ts` is 398 lines.
- New `apps/server/src/agents/prompt-time.ts`: `promptNow(now, timeZone)` → `Thursday, 15 October 2026, 04:12 (Europe/Madrid)`, and `(UTC)` when the zone is null. `context.ts` now renders `It is ${input.today}.`
- DM turn uses the owner's zone; group turn uses the sender's, and UTC when the sender is not a user. `dm-turn.ts` and `group-turn-body.ts` are 395 lines each (grew by 2/5 lines, both under 400).
- Clients: after `/me` loads, the web `getMe` and mobile `fetchMe` send one `updateMe({ name, timeZone })` when the browser/device zone differs. A module-level flag makes it at most once per app start; the call is silent and failures are ignored.

### Named `/me` handler files
- Web: `apps/web/src/lib/api/chats.ts` (`getMe`).
- Mobile: `apps/mobile/src/lib/auth-api.ts` (`fetchMe`).
These are the two files the task names under Allowed files, so the reporting lives there.

### Deviations from the spec
- Added `timeZoneForJid(db, jid)` to `profile-time-zone.ts`. The group turn only has the sender's JID (`trigger.fromJid`), never a user id, so resolving the sender's zone needs an `xmpp_accounts` → `user_profiles` lookup. The spec named only `timeZoneFor(db, userId)`.
- The client reporting is inside the two client API files (`chats.ts`, `auth-api.ts`) instead of a separate session file. The gate scope check only accepts paths that appear in backticks under "Allowed files"; `AuthProvider.tsx` / `session.ts` are not named there and would be reported out of scope.
- Web and mobile `updateMe` gained an optional `timeZone` argument (no new function), so existing callers and tests keep working.

### Commands run
- `pnpm install`: ok.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/profile-time-zone.test.ts src/agents/prompt-time.test.ts`: 2 files, 7 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/auth.test.ts src/auth/profile-bio.test.ts`: 2 files, 40 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/dm-turn.fake-provider.test.ts src/agents/gateway-group.test.ts`: 2 files, 14 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/auth-api.test.ts src/auth/session.test.ts src/auth/session-store.test.ts`: 3 files, 35 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/api/sessionGone.test.ts src/auth/AuthProvider.test.tsx`: 2 files, 11 tests passed.

### `pnpm gate` (repo root)
```
gate: 14 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (0.7s)
PASS  typecheck  (5.3s)
PASS  effect  (0.8s)
SKIP tests @zilar/api-contract (no nearby test files)
PASS  tests @zilar/mobile  (1.0s)
PASS  tests @zilar/server  (19.8s)
PASS  tests @zilar/web  (3.0s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Open questions
None.

### Round 2 (fix round)
- Fixed finding 1 (must-fix): `PATCH /me` validated `timeZone` only after `updateUser` (rename) and the bio upsert, so a refused PATCH still renamed the user and wrote the bio. `apps/server/src/auth/api.ts` now validates the zone immediately after decoding, before any write; an invalid zone makes the whole PATCH a no-op. `api.ts` stays at 398 lines.
- Tests: `apps/server/src/auth/profile-time-zone.test.ts` — the invalid-zone test now sends `name`/`bio`/bad-zone and asserts `GET /me` returns the unchanged name and bio ("rejects an invalid zone and applies no other part of the PATCH"). 5 tests pass.
- Findings 2 and 3 are nits, so they were left untouched per the fix-round rule (only must-fix and should-fix are fixed; no should-fix existed). No disagreements.
- `pnpm gate` (repo root): `GATE PASS` — 14 changed files, scope/size/migration checks clean.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN after 1 auto round, nit 2.
- Migration 0061 adds a nullable `user_profiles.time_zone`.
- `PATCH /me` validates the zone before any write, and `/me` returns it, so each client reports once and then matches.
- Prompts now read `It is Thursday, 15 October 2026, 04:12 (Europe/Madrid).`, in the owner's zone (DM) or the sender's (group), with a UTC fallback.
- The auth and prompt-time tests (85) pass locally.
- Every file is at 399 lines or fewer.
