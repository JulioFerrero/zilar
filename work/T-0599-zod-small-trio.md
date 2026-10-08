---
id: T-0599
title: "Effect Schema: three small zod leftovers: drafts/events.ts (draft SSE event schemas), auth/invite-cli.ts (CLI options), routines/service.ts (title check with its three texts); same accept/reject and texts; hub.test parse calls switch to Effect"
status: merged
milestone: M5
branch: task/T-0599-zod-small-trio
model: auto
effort: low
depends_on: [T-0571]
estimate: 0.5 day
---

# T-0599: three small zod leftovers

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod. These are three small, independent leftovers (plan `docs/audit/tool-args-schema-plan.md`, §5.2 and §5.3).

### Verified facts (do not re-derive)
1. **`apps/server/src/drafts/events.ts`:**
   - zod import at line 1;
   - `DraftEventSchema`: `{ type: 'draft', chatJid: min 1, turnId: uuid, text: string }`;
   - `DraftEndEventSchema`: `{ type: 'end', chatJid: min 1, turnId: uuid, outcome: 'sent' | 'failed' }`;
   - `DraftHubEventSchema`: a discriminated union of the two;
   - the three types (`DraftEvent`, `DraftEndEvent`, `DraftHubEvent`) are used by `drafts/hub.ts`, `drafts/api.ts` and `agents/gateway.test.ts` (type-only). **Keep the names and shapes.**
   
   **Test change allowed:** `apps/server/src/drafts/hub.test.ts:198-210` calls `.safeParse(...).success` on the three schemas; change those calls to `Exit.isSuccess(Schema.decodeUnknownExit(X)(value))`, with the same expectations. For the uuid check, use the Effect equivalent (`Schema.isUUID` or a pattern); the test at 205-210 must still reject a missing `text` and the outcome `'maybe'`.
2. **`apps/server/src/auth/invite-cli.ts`:**
   - zod import at line 1;
   - `inviteCliOptionsSchema` (9-12): `uses` and `days` use `z.coerce.number()` (that is, `Number(string)`) with `.int()`, `uses` in 1..1000 and `days` in 1..365, each with a default (`DEFAULT_INVITE_MAX_USES`, `DEFAULT_INVITE_TTL_DAYS`);
   - it is parsed with `.parse(raw)` at line 48, which **throws** on failure.
   
   `apps/server/src/auth/invite-cli.test.ts:8-31` checks:
   - the defaults;
   - `'5'`/`'30'` and `'2'`/`'3'` parse;
   - `'0'` for uses and `'9999'` for days throw (any error).
   
   Keep the coercion with `Number(value)`, so that `'abc'` (NaN) and `'2.5'` (not an int) also throw.
3. **`apps/server/src/routines/service.ts`:**
   - zod import at line 8;
   - `titleSchema` (70-78), with the messages **"title must not be empty"**, **"title must be at most ${MAX_ROUTINE_TITLE_CHARS} characters"** and **"title must not contain control characters"**;
   - it is used at line 101, where a failure throws `RoutineServiceError('invalid_request', <first issue message> ?? 'Invalid title')`.
   
   **These three texts reach the API**, so keep them byte-identical. Effect 4.0.2 drops `{ message }` on length checks (the guide's "Schema, custom messages"), so use `makeFilter` or the codebase message helper, and probe each text once.
   
   A plain function returning the first failing text is also fine, if it is simpler.

### What to build
1. Convert all three files to Effect Schema with the same behaviour, so that none of them imports zod.
2. The only test change is `drafts/hub.test.ts:198-210`.
3. **Tests:** every other test passes **unchanged**:
   - `apps/server/src/drafts/*.test.ts`;
   - `apps/server/src/auth/invite-cli.test.ts`;
   - `apps/server/src/routines/*.test.ts`;
   - `apps/server/src/agents/gateway.test.ts`.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` ("Effect 4 facts" and "Schema, custom messages"), the three files, and `apps/server/src/drafts/hub.test.ts` (lines 190-215).

### Allowed files
`apps/server/src/drafts/events.ts`, `apps/server/src/drafts/hub.test.ts`, `apps/server/src/auth/invite-cli.ts`, `apps/server/src/routines/service.ts`, `work/T-0599-zod-small-trio.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot drafts auth/invite-cli routines agents/gateway
pnpm gate
```

### Acceptance
- There is no zod in the three files, with the same accept/reject behaviour and the same routine title texts.
- Only the listed test lines changed.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Converted the three zod leftovers to Effect Schema; no zod import remains in
the three files.

### Files changed
- `apps/server/src/drafts/events.ts`: `DraftEventSchema`, `DraftEndEventSchema`
  are `Schema.Struct`s (`Schema.Literal`, `Schema.isMinLength(1)`,
  `Schema.isUUID()`, `Schema.Literals(['sent','failed'])`); `DraftHubEventSchema`
  is `Schema.Union([...])`. Type names (`DraftEvent`, `DraftEndEvent`,
  `DraftHubEvent`) and shapes are unchanged.
- `apps/server/src/auth/invite-cli.ts`: `Schema.Struct` with
  `Schema.String.pipe(Schema.decodeTo(Schema.Int, …), range checks)` and
  `withDecodingDefaultKey` defaults. Coercion is `Number(value)` (not
  `parseInt`), so `'2.5'` and `'abc'` still fail; parsed with
  `Schema.decodeUnknownSync` (throws, like `.parse`).
- `apps/server/src/routines/service.ts`: `titleSchema` is a `Schema.String`
  with a single `Schema.makeFilter` that returns the three old texts in the old
  order; the failure message is read from the first `InvalidValue` annotation
  (`firstIssueMessage`), falling back to `'Invalid title'`.
- `apps/server/src/drafts/hub.test.ts` (only lines 198-210, as allowed): the
  three `safeParse(...).success` checks became
  `Exit.isSuccess(Schema.decodeUnknownExit(X)(value))`, same expectations.

### Title texts proof
Ran a temporary `tsx` probe (file deleted afterwards) calling `createRoutine`
with an invalid title; each produced the exact expected text:
- `""` → `title must not be empty`
- 81 chars → `title must be at most 80 characters`
- `"a\u0001b"` → `title must not contain control characters`

### Commands run
- `pnpm install`: done.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot drafts auth/invite-cli routines agents/gateway`:
  **9 test files passed (9), 255 tests passed (255)**.
- `pnpm gate` (repo root), summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (3.2s)
  PASS  format  (72.2s)
  PASS  lint  (2.2s)
  PASS  typecheck  (28.7s)
  PASS  tests @zilar/server  (705.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- `DraftHubEventSchema` uses `Schema.Union` rather than a tagged
  `Schema.toTaggedUnion`; decode behaviour and the emitted TypeScript union are
  the same, and the union order keeps the `type` discriminator.
- No new test files: the task constrained test changes to
  `drafts/hub.test.ts:198-210`; the title texts were proven with a throwaway
  probe instead.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 3 nits. The packet (14:26) is newer than HEAD ef379c8c.
- **Lead check:**
  - the only test change is `hub.test.ts:196-233`, inside the allowed lines, with the same four expectations (two accepted, two rejected);
  - the three title texts are kept, in the same order.
- **Accepted differences:**
  - `isUUID` also accepts the uppercase max-UUID;
  - a non-string title falls back to `Invalid title`, which no typed caller can reach.
- **Follow-up:** the walker is copied again, so it joins the shared-walker follow-up.
