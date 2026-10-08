---
id: T-0569
title: "Effect Schema, server leaf batch 2: git/token.ts, web-tools/prices.ts, voice-transcription/provider.ts and agents/listener/score.ts drop zod for Effect Schema; same accept/reject rules and branches; tests unchanged"
status: merged
milestone: M5
branch: task/T-0569-effect-schema-server-leaf-batch-2
model: auto
effort: low
depends_on: [T-0563]
estimate: 0.5 day
---

# T-0569: four server leaf parsers on Effect Schema

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod everywhere. Each of these four files uses zod only for one private response parser. No other file imports those schemas; I checked with grep.

The idioms to copy:
- `Schema.decodeUnknownExit` with `Exit.isSuccess` for a `safeParse`;
- `Schema.decodeUnknownSync` (it throws) for a `parse` inside a `try`.

### Verified facts (do not re-derive)
**Two zod rules matter for the rewrite:**
- **zod `z.number()` rejects `NaN` and `±Infinity`; `Schema.Number` accepts them.** Wherever the zod schema has `z.number()`, use a finite number schema (`Schema.Finite`, or `Schema.Number` with a finite check). Then `.int()`, `.min()` and `.max()` become the matching checks.
- **zod `z.object` strips unknown keys; `.strict()` rejects them; `.catchall(z.unknown())` keeps them.** Effect `Schema.Struct` ignores unknown keys by default. For `.strict()`, decode with `{ onExcessProperty: 'error' }`.

The four files:
1. **`apps/server/src/git/token.ts`**:
   - `InstallationTokenSchema` (line 31) is `{ token: string min 1, expires_at: string min 1 }`;
   - it is used once, at line 104 (`safeParse`); a failure throws `GitTokenError('GitHub token response had an unexpected shape')`.
2. **`apps/server/src/web-tools/prices.ts`**:
   - `coingeckoSchema` (57) is `record<string, { usd: finite number, last_updated_at?: int >= 0 }>`;
   - `.parse` at line 86 runs inside a `try`, and **any** failure goes to the "unavailable" branch;
   - the type annotation at line 84 is `z.infer<typeof coingeckoSchema>`, so replace it with the Effect Schema type;
   - `stooqRowSchema` (65) is `{ symbol: string min 1, date: string, time: string, close: finite number }`, with `safeParse` at line 165; a failure is `continue`.
3. **`apps/server/src/voice-transcription/provider.ts`**:
   - `transcriptionResponseSchema` (17) is `{ text: string, language?: string }` with `.catchall(z.unknown())`;
   - it is used at line 101, where a failure is `ProviderRejected`;
   - only `text` and `language` are read afterwards, so a plain `Schema.Struct` that ignores extra keys is enough.
4. **`apps/server/src/agents/listener/score.ts`**:
   - `ListenerOutputSchema` (119) is `.strict()` `{ scores: record<string, number 0..1>, reason: string, message_ids: string[] }`;
   - it is used at line 156, where a failure is `null`;
   - **extra keys must still fail** (`onExcessProperty: 'error'`), and so must `NaN` and out-of-range scores.
- **Tests (all unchanged):**
  - `apps/server/src/git/token.test.ts`;
  - `apps/server/src/web-tools/prices.test.ts`;
  - `apps/server/src/voice-transcription/provider.test.ts` and `apps/server/src/voice-transcription/provider.effect.test.ts`;
  - `apps/server/src/agents/listener/score.test.ts`.

### What to build
1. **Replace zod with Effect Schema** in the four files, keeping the same accept and reject rules and the same branches. Leave no `zod` import in any of the four.
2. **Tests:** every listed test passes **unchanged**.
3. **Report:** give one line per schema, saying how each zod rule maps.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, and the four files (the schemas and their call sites).

### Allowed files
`apps/server/src/git/token.ts`, `apps/server/src/web-tools/prices.ts`, `apps/server/src/voice-transcription/provider.ts`, `apps/server/src/agents/listener/score.ts`, `work/T-0569-effect-schema-server-leaf-batch-2.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot git/token web-tools/prices voice-transcription/provider agents/listener/score
pnpm gate
```

### Acceptance
- The four parsers use Effect Schema with the same behaviour and no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Replaced the single private zod response parser in each of the four files with
Effect Schema, keeping the same accept/reject rules and the same branches. No
`zod` import remains in any of the four. No test file changed.

### Files changed
- `apps/server/src/git/token.ts`
- `apps/server/src/web-tools/prices.ts`
- `apps/server/src/voice-transcription/provider.ts`
- `apps/server/src/agents/listener/score.ts`
- `work/T-0569-effect-schema-server-leaf-batch-2.md`

### Rule -> Effect Schema mapping (one line per schema)
- `token.ts` `InstallationTokenSchema`: `z.object` strips extras -> `Schema.Struct`
  (ignores unknown keys); `z.string().min(1)` ->
  `Schema.String.pipe(Schema.check(Schema.isMinLength(1)))`; `safeParse` ->
  `Schema.decodeUnknownExit` + `Exit.isSuccess` (failure still throws the same
  `GitTokenError('GitHub token response had an unexpected shape')`).
- `prices.ts` `coingeckoSchema`: `z.record(z.string(), z.object({...}))` ->
  `Schema.Record(Schema.String, Schema.Struct({...}))`; `z.number().finite()` ->
  `Schema.Finite`; `z.number().int().nonnegative().optional()` ->
  `Schema.optional(Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))))`;
  `.parse` -> `Schema.decodeUnknownSync` (throws) inside the existing `try`, so
  any failure still takes the "unavailable" branch; the `z.infer` annotation ->
  `typeof coingeckoSchema.Type`.
- `prices.ts` `stooqRowSchema`: `z.object` -> `Schema.Struct`; `z.string().min(1)`
  -> min-length check; `z.number().finite()` -> `Schema.Finite`; `safeParse` ->
  `decodeUnknownExit` + `Exit.isSuccess` (failure still `continue`).
- `provider.ts` `transcriptionResponseSchema`: `.object({text, language?}).catchall(z.unknown())`
  -> a plain `Schema.Struct` that ignores unknown keys (only `text` and `language`
  are read afterwards); `z.string().optional()` -> `Schema.optional(Schema.String)`;
  `safeParse` -> `decodeUnknownExit` + `Exit.isSuccess` (failure still `ProviderRejected`).
- `score.ts` `ListenerOutputSchema`: `z.object(...).strict()` -> `Schema.Struct`
  decoded with `{ onExcessProperty: 'error' }`; `z.record(z.string(), z.number().min(0).max(1))`
  -> `Schema.Record(Schema.String, Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))))`
  (the range plus `Finite` rejects `NaN` and `±Infinity` as well as out-of-range);
  `z.array(z.string())` -> `Schema.Array(Schema.String)`; failure still returns `null`.

### Commands and results
- `pnpm install`: done, 1173 packages, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot git/token web-tools/prices voice-transcription/provider agents/listener/score`:
  `5 passed` test files, `35 passed` tests (exit 0).
- First `pnpm gate`: `PASS install`, `FAIL format` on
  `apps/server/src/agents/listener/score.ts`; fixed with
  `pnpm exec prettier --write apps/server/src/agents/listener/score.ts`.
- `pnpm gate` (second attempt): `PASS install`, `PASS format`, `PASS lint`,
  `PASS typecheck`, then the run exceeded the 15-minute tool timeout during the
  test step while three other workers' gates ran on the shared machine.
- `pnpm gate` (final, run in the background to completion):
  ```
  PASS  install (frozen)  (4.3s)
  PASS  format  (93.0s)
  PASS  lint  (1.6s)
  PASS  typecheck  (1.8s)
  PASS  tests @zilar/server  (1220.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- None functional. The only failure was the Prettier formatting of `score.ts`,
  fixed by running Prettier on that one file.
- No tests were changed; all listed tests pass unchanged.

### Security checklist
- No secrets, tokens, URLs or message text are introduced into logs, errors or
  audit. The parsers only decode provider/upstream response bodies, as before.
  No new routes, DB writes, caps or permission checks are involved.



**2026-10-08, lead:** approved.
- **Pre-review:** 0 must-fix. The packet (07:57) is newer than HEAD 4a4effaf.
- **No test file changed.**
- **Lead check:** the lead read the diff.
  - `Schema.Finite` replaces `z.number()` for `usd`, `close` and the scores, with the 0..1 bounds kept.
  - The listener decode uses `onExcessProperty: error` for zod `.strict()`.
  - The Struct schemas ignore extra keys where zod stripped or kept them.
- **Accepted nit:** `voice-transcription/provider.ts:5` still says "validated with zod". It is logged for a cleanup.
- **Follow-up:** a test that pins the excess-key rejection in `score.test.ts`.
