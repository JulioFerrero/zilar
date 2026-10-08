---
id: T-0579
title: "Review follow-ups: two stale comments (transcription provider 'validated with zod', push config failedKeysOf 'missing') and one new test pinning that parseListenerOutput rejects an excess top-level key"
status: merged
milestone: M5
branch: task/T-0579-server-review-followups
model: auto
effort: low
depends_on: [T-0570, T-0561]
estimate: 0.25 day
---

# T-0579: small follow-ups from the 2026-10-08 reviews

## Spec (written by Claude, do not edit)

### Why
The pre-reviews of T-0569 and T-0570 found three small leftovers. None of them changes behaviour.

### Verified facts (do not re-derive)
1. **`apps/server/src/voice-transcription/provider.ts:5`** says "The provider's response shape is validated with zod". Since T-0569 it is Effect Schema (`transcriptionResponseSchema`).
2. **`apps/server/src/push/config.ts:85-86`:** the comment on `failedKeysOf` says it returns "`missing` for an absent required key, the field name for anything else". The function returns the field name in every case; there is no `'missing'` literal. Read the function and make the comment say what it does.
3. **`apps/server/src/agents/listener/score.ts`:** `parseListenerOutput` decodes with `{ onExcessProperty: 'error' }`, keeping zod's old `.strict()`, so an output with an extra top-level key returns `null`.
   - **No test pins this.** The `describe('parseListenerOutput')` block in `apps/server/src/agents/listener/score.test.ts:192` covers a valid object, the fence, unknown ids, and out-of-range values and garbage.
   - **Add one test** in that block: `'{"scores": {"a": 0.5}, "reason": "r", "message_ids": [], "extra": 1}'` with roster `['a']` gives `null`.
   - **Prove it fails without the option:** remove `onExcessProperty` locally, run the test, see it fail, then restore it. Say so in the Report.

4. **`PATCH /api/me` name messages.** These texts, from `apps/server/src/auth/api.ts` (T-0561), are shown to users:
   - `name must not be empty`;
   - `name must be at most 64 characters`;
   - `name must not contain control characters`.
   
   The tests in `apps/server/src/auth/auth.test.ts` (around lines 685-715: "rejects an empty or whitespace-only name", "rejects a name longer than 64 characters", "rejects control characters") assert **only the 400 status**. Effect 4.0.2 once dropped exactly these texts (the T-0561 pre-review), and nothing would catch it.
   - In each of those three tests, also assert the JSON body's `error.message` equals the text, using the `{ error: { code, message } }` envelope.
   - Do not add new tests there, and change nothing else.

### What to build
1. Fix the two comments, editing the comment text only.
2. Add the one listener test. Change nothing else in that test file.
3. Add the message assertions in the three `auth.test.ts` tests (fact 4).

### Read first
`AGENTS.md`, the three source locations above and `apps/server/src/agents/listener/score.test.ts` (lines 185-240).

### Allowed files
`apps/server/src/voice-transcription/provider.ts`, `apps/server/src/push/config.ts`, `apps/server/src/agents/listener/score.test.ts`, `apps/server/src/auth/auth.test.ts`, `work/T-0579-server-review-followups.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/listener/score auth/auth
pnpm gate
```

### Acceptance
- Both comments are accurate.
- The new test passes and is proven to fail without `onExcessProperty: 'error'`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

- Fixed the two stale comments (comment text only):
  - `apps/server/src/voice-transcription/provider.ts:5`: "validated with zod" -> "validated with Effect Schema (`transcriptionResponseSchema`)".
  - `apps/server/src/push/config.ts:85-86` (`failedKeysOf`): now says it returns the field name (dotted for nested structs) for each failure; no `'missing'` literal.
- Added one test in `describe('parseListenerOutput')` (`apps/server/src/agents/listener/score.test.ts`): `'{"scores": {"a": 0.5}, "reason": "r", "message_ids": [], "extra": 1}'` with roster `['a']` gives `null`. Nothing else changed in that file.
- Added `error.message` assertions (`{ error: { code: 'invalid_request', message } }` envelope) to the three PATCH /api/me tests in `apps/server/src/auth/auth.test.ts`: empty/whitespace -> 'name must not be empty'; 65 chars -> 'name must be at most 64 characters'; control chars -> 'name must not contain control characters'. No new tests there.
- Proven the excess-key test fails without the option: temporarily replaced `{ onExcessProperty: 'error' }` with `({})` in `score.ts:159`, ran `agents/listener/score` -> 1 failed / 13 passed, failing test "rejects an output with an extra top-level key"; restored the file (`git checkout -- score.ts`); `git status` confirms `score.ts` unmodified.
- Security checklist: no secrets touched; no deletes/updates; no new routes; no caps changed; no audit entries; error messages are the fixed user-facing sentences (no raw server text leaked).
- Commands:
  - `pnpm install`: ok (12.2s).
  - `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/listener/score auth/auth`: 2 files, 50 passed.
  - Negative proof run (option removed): 1 failed (extra top-level key), 13 passed.
  - `pnpm gate`: PASS install (1.9s), PASS format (26.6s), PASS lint (1.2s), PASS typecheck (14.5s), PASS tests @zilar/server (487.0s); scope: every changed file inside Allowed files; GATE PASS.
  - Changed files (5): the 4 Allowed source/test files + this task file. No files outside Allowed files.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (09:04) is newer than HEAD 63a77a6f.
- **Lead check:** the lead read the whole diff.
  - The two comments are now accurate.
  - The excess-key test was proven to fail without the option (the worker removed it, saw 1 failure, then restored it).
  - The three `/me` name texts are now asserted exactly in `auth.test.ts`.
