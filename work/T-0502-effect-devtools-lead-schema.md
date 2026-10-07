---
id: T-0502
title: "Effect lane F: packages/devtools lead CLI zod to Effect Schema (state file, task front matter, rules, opencode envelopes, watch view); every lead test unchanged"
status: merged
milestone: M5
branch: task/T-0502-effect-devtools-lead-schema
model: auto
effort: low
depends_on: [T-0490]
estimate: 0.5 day
---

# T-0502: lead CLI schemas on Effect Schema

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, with Effect Schema replacing zod. Plan `docs/audit/effect-everywhere-plan.md` §1.5 and §4.4 lane F, `packages/devtools`.

**The lead CLI drives every worker.** After this merges, every `lead` command runs the new code, so the state file and the task front matter must parse exactly as before. The tests are the proof.

### Verified facts (do not re-derive)
- **The package:** `packages/devtools/package.json` depends on `zod` ^4.6.5. The zod imports are only in `src/lead/types.ts`, `src/lead/client.ts` and `src/lead/watch.ts`.
- **`src/lead/types.ts`:**
  - **`permissionRuleSchema`** (line 6) is a `z.object` with `action` and `resource` (min 1) and `effect` (enum `allow`/`ask`/`deny`); **`permissionRulesSchema`** is an array of them (line 14).
  - **`taskFrontMatterSchema`** (line 18) is a `z.object`:
    - `id`: a regex `/^T-\d+$/` with the message `'task id must look like T-0038'`;
    - `branch`: min 1, `'branch is required'`;
    - `model`: min 1, `'model is required'`;
    - `effort`: an optional enum of `minimal`/`low`/`medium`/`high`/`xhigh`/`default`;
    - `status`: min 1.
  - **`prereviewRecordSchema`, `doctorRecordSchema` and `taskRecordSchema`** (lines 73-110) are `z.object`s with optional fields and **`.default(...)`** values: `nudgesSent` 0, `prereviewStalledEscalated` false, `autoFixRounds` 0, `escalatedPermissionIds` [], `escalatedQuestionIds` [], `stalledEscalated` false.
  - **`stateFileSchema`** (line 112) is `{ version: literal 1, tasks: record of taskRecordSchema, doctor?: doctorRecordSchema }`.
  - **The hand-written interfaces** `DoctorRecord`, `TaskRecord` and `StateFile` (lines 40-122) are the exported types.
  - **`z.object` strips unknown keys** on parse. Effect Schema's default `onExcessProperty: "ignore"` does the same (`effect/dist/SchemaAST.d.ts:372`); keep that **non-strict** behaviour here.
- **The consumers:**
  - `src/lead/state.ts:31-35` parses the state file and throws `` `invalid state file at ${statePath}: ${issues[0]?.message ?? 'unknown'}` ``;
  - `src/lead/prompts.ts:30-34` parses the rules file the same way (`invalid rules file at …`);
  - `src/lead/task-file.ts:21-29` `parseTaskFrontMatter` throws `` `invalid task front matter: ${issues.map(i => `${path || 'front matter'}: ${message}`).join('; ')}` ``.
- **`src/lead/client.ts`:**
  - `sessionIdSchema = z.object({ id: z.string() })` is at line 24, used at line 182 (`'session.create response has no id'`);
  - `readDataPayload` (lines 29-38) checks a `{ data: unknown }` envelope (`'opencode2 response has no data envelope'`).
- **`src/lead/watch.ts`** (from line 377): `FileSchema`, `SpeedSchema`, `EntrySchema` (with `nullish`/`nullable` fields) and `ViewSchema`; `parseWatchView(line)` returns `null` on any junk.
- **The tests that pin behaviour:**
  - `src/lead/task-file.test.ts:44-61` expects a missing `branch` to throw `/branch/`, a missing `model` to throw `/model/`, and a bad id to throw;
  - `src/lead/state.test.ts:71` expects `/invalid state file/`;
  - `src/lead/prompts.test.ts:189` expects a throw;
  - plus `watch.test.ts`, `watch-format.test.ts`, `client.test.ts` and the autopilot/decide tests that build state.
- **The Effect 4 Schema API** (installed `effect` 4.0.0, `dist/Schema.d.ts`): `Schema.Struct`, `Schema.Literal`/`Literals`, `Schema.Record`, `Schema.Array`, `Schema.optional`/`optionalKey`, `Schema.NullOr`, `Schema.check(...)` with `isPattern` (5346) and `isMinLength` (6134, which accepts a message annotation), `withDecodingDefault` (4773), `decodeUnknownExit` (1223) and `decodeUnknownSync` (1460).

### What to build
1. **Package:** in `packages/devtools/package.json`, remove `zod` and add `effect` at `^4.0.0` (the same range as `apps/server`). Run `pnpm install`.
2. **`types.ts`:**
   - every schema becomes Effect Schema with the same fields, bounds, enums, custom messages and defaults;
   - keep the exported names (`permissionRuleSchema`, `permissionRulesSchema`, `taskFrontMatterSchema`, `stateFileSchema`) and the exported types. `PermissionRule` and `TaskFrontMatter` come from `typeof X.Type`; the hand-written interfaces stay as they are.
   - Unknown keys in the state file are **stripped, not rejected**.
3. **`state.ts`, `prompts.ts` and `task-file.ts`** keep **the exact error text formats** above. Build the issue list from Effect's issue, with each issue's path joined with `.` (or `front matter` when empty), plus its message. A missing `branch` must name `branch`.
4. **`client.ts` and `watch.ts`:** the same checks with Effect Schema. `parseWatchView` still returns `null` on any junk.
5. **Tests:**
   - every test in `packages/devtools/src/**/*.test.ts` passes **unchanged**. If one cannot, stop and report BLOCKED with the file and line;
   - add `packages/devtools/src/lead/types.schema.test.ts`:
     - **a full state-file round trip:** a fixture with two task records (one with `prereview`, `packetReadyForHead` and `lastEscalation` set, one minimal with only the required fields), plus a `doctor` record and **one unknown extra key**. Decoding must give the defaults on the minimal record, keep every set field and drop the unknown key;
     - **front matter:** `effort: default` is accepted and `effort: huge` is rejected with a message naming `effort`.
6. **Smoke test:** after the gate, run `pnpm exec tsx src/lead/cli.ts --help` (or the CLI's no-argument usage) from `packages/devtools`. It must print its usage without a stack trace. Do not run any command that reads or writes `~/.zilar-lead`.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-everywhere-plan.md` §2.5, `packages/devtools/src/lead/types.ts`, `state.ts`, `prompts.ts`, `task-file.ts`, `client.ts:1-60` and `:170-190`, `watch.ts:360-430`.

### Allowed files
`packages/devtools/package.json`, `pnpm-lock.yaml`, `packages/devtools/src/lead/types.ts`, `packages/devtools/src/lead/state.ts`, `packages/devtools/src/lead/prompts.ts`, `packages/devtools/src/lead/task-file.ts`, `packages/devtools/src/lead/client.ts`, `packages/devtools/src/lead/watch.ts`, `packages/devtools/src/lead/types.schema.test.ts`, `work/T-0502-effect-devtools-lead-schema.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --reporter=dot src/lead
pnpm gate
```

### Acceptance
- `@zilar/devtools` has no zod.
- The state file, front matter, rules, envelopes and watch view parse exactly as before (defaults, stripping, error formats).
- The existing tests are untouched and green, and the round-trip test passes.
- The CLI usage prints.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: review.

### What I did
- Replaced zod with Effect Schema in `packages/devtools/src/lead` (types, state, prompts, task-file, client, watch). No zod left in the package; `effect@^4.0.0` added to dependencies, `zod` removed.
- Kept every exported schema name and type (`permissionRuleSchema`, `permissionRulesSchema`, `taskFrontMatterSchema`, `stateFileSchema`, `PermissionRule`, `TaskFrontMatter`) and the hand-written `PrereviewRecord`/`DoctorRecord`/`TaskRecord`/`StateFile` interfaces. `PermissionRule`/`TaskFrontMatter` now come from `typeof schema.Type`.
- Preserved the exact error-text templates: state file (`invalid state file at <path>: <first issue message>`), rules file (`invalid rules file at <path>: <first issue message>`), front matter (`invalid task front matter: <path or "front matter">: <message>` joined with `; `).
- Unknown keys are stripped, not rejected: Effect `Schema.Struct` ignores excess properties by default, as decided in the task (`onExcessProperty: "ignore"`).
- Defaults (`nudgesSent` 0, `prereviewStalledEscalated`/`stalledEscalated` false, `autoFixRounds` 0, `escalatedPermissionIds`/`escalatedQuestionIds` `[]`) and bounds (`int`, `>= 0`) are kept via `withDecodingDefault`, `isInt`, `isGreaterThanOrEqualTo`.
- Added `packages/devtools/src/lead/types.schema.test.ts`: a full state-file round trip (two task records, one rich with `prereview`/`packetReadyForHead`/`lastEscalation`, one minimal with an unknown extra key; plus a `doctor`) and front-matter `effort: default` accepted / `effort: huge` rejected with a message naming `effort`.
- Existing tests were not touched.

### Files changed
- `packages/devtools/package.json` — zod → effect.
- `pnpm-lock.yaml` — from `pnpm install`.
- `packages/devtools/src/lead/types.ts` — Effect Schema + small exported `schemaIssues` helper.
- `packages/devtools/src/lead/state.ts`, `prompts.ts`, `task-file.ts`, `client.ts`, `watch.ts` — Effect Schema decode + same error text.
- `packages/devtools/src/lead/types.schema.test.ts` — new.
- `work/T-0502-effect-devtools-lead-schema.md` — this report.

### Commands and real results
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead`: **26 files passed, 608 tests passed**.
- `pnpm gate` (from repo root), summary lines:
  - `gate: 10 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`, `PASS  tests @zilar/devtools`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- Smoke test `pnpm exec tsx src/lead/cli.ts --help` (from `packages/devtools`): prints the full usage with no stack trace (exit 0). No command touched `~/.zilar-lead`.

### Deviations from the spec (all behaviour-preserving)
- Used `Schema.decodeUnknownResult` (same family as the listed `decodeUnknownExit`, `Schema.d.ts:1337`) instead of `decodeUnknownExit`: it mirrors zod's `safeParse` and gives a typed `SchemaError` without `Cause`/`Exit` juggling.
- Built issue path/message with `SchemaIssue.makeFormatterStandardSchemaV1()`, which flattens the Effect issue tree into `{ path, message }` entries (the "build the issue list from Effect's issue" step). Exported a tiny `schemaIssues(error)` helper from `types.ts` so the three callers share it.
- Used `Schema.mutable(Schema.Array(...))` for array fields so decoded types stay `string[]`/`number[]` and match the unchanged hand-written interfaces.
- `z.enum` → `Schema.Literals`, `z.literal(1)` → `Schema.Literal(1)`, `.regex(re, msg)` → `Schema.isPattern(re, { message })`, `.min(1, msg)` → `Schema.isMinLength(1, { message })` (messages verified to render).

### Open questions / notes
- None blocking. The zod `permissionRuleSchema` min-length checks had no custom message; I kept them message-less (Effect default message), so the only fixed messages that matter to callers (task id, branch, model, rules/defaults) are preserved.

## Review (written by Claude)

Approved (lead, 2026-10-07). The lead CLI has no zod. The state file, front matter, rules, opencode envelopes and watch view decode with Effect Schema, with the same defaults, key stripping and error formats. The existing tests are untouched and the round-trip test passes. The lead decoded the live state.json (26 tasks) with the new schema and ran `lead status` from this worktree; both worked.
