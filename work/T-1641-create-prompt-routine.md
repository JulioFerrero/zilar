---
id: T-1641
title: "Scheduled AI jobs step 3: createPromptRoutine stores a prompt routine (title, schedule, prompt ≤ 2000 chars, no tool, no hosts) with the same 10-per-topic limit and audit; PublicRoutine carries kind and prompt; nothing calls it yet"
status: merged
milestone: M5
branch: task/T-1641-create-prompt-routine
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1641: Create a prompt routine (service only)

## Spec (written by Claude, do not edit)

### Why
This is scheduled AI jobs, plan `docs/plan/scheduled-ai-jobs.md` §4 task 3 (T-1614). T-1638 (merged) let `routines` hold `kind = 'prompt'` with a `prompt` and no `tool_id`.

**This task adds the service function that creates one, and the public shape.** The chat action that calls it comes later (plan task 6), after this release has fully drained.

### Facts (the lead read them on 2026-10-16, main after T-1638)
- **`apps/server/src/routines/support.ts`** (391 lines) holds `createRoutine(db, input, now, audit?)` (`:27-168`). In order, it:
  - checks the `groupId`/`topicId` pairing (`:42-47`);
  - decodes the title with `Schema.decodeUnknownExit(titleSchema)` into a `RoutineServiceError('invalid_request', message)` (`:48-58`);
  - parses the schedule with `parseRoutineSchedule` (`:59-62`);
  - checks the tool and hosts;
  - calls `enforceRoutineLimit(db, aiId, topicId)` (`:124`) and `nextRunAfter(schedule.value, now)` (`:125`);
  - inserts with `INSERT INTO routines (…) VALUES (…) RETURNING *` (`:126-147`);
  - audits `routine.created` with `detail: { toolId }` (`:151-164`);
  - returns `toPublicRoutine(inserted, tool.name, schedule.value)`.
- **`apps/server/src/routines/schemas.ts`** (117 lines):
  - `MAX_ROUTINES_PER_TOPIC = 10`, `MAX_ROUTINE_TITLE_CHARS = 80` and `MAX_ROUTINE_INPUT_BYTES` (`:7-9`);
  - `CreateRoutineInput` (`:48-…`);
  - `PublicRoutine` (`:60-79`, `toolId: string | null` since T-1638);
  - `titleSchema` (`:102`).
- **`apps/server/src/routines/queries.ts`** (150 lines):
  - `toPublicRoutines` (`:102-126`) runs `SELECT name FROM ai_tools WHERE id = ${row.toolId}` per row;
  - `toPublicRoutine(row, toolName, schedule)` is at `:128-150`.
- **`RoutineRow`** has `kind: 'tool' | 'prompt'` and `prompt: string | null` (T-1638). The table checks require `tool_id IS NULL` and `prompt IS NOT NULL` for a prompt row.
- **Test setup to copy:** `apps/server/src/routines/scheduler.test.ts:3-10` (`createTestContext`, `testSql`, `seedAi`, `seedUser`).

### Steps
1. **`schemas.ts`:**
   - add `export const MAX_ROUTINE_PROMPT_CHARS = 2000;`;
   - add `export interface CreatePromptRoutineInput { aiId; groupId: string | null; topicId: string | null; title: string; schedule: unknown; prompt: string; userId: string }`;
   - add `kind: 'tool' | 'prompt'` and `prompt: string | null` to `PublicRoutine`;
   - move the title decoding into `export function parseRoutineTitle(title: unknown): string`, which throws the same `RoutineServiceError('invalid_request', …)`. `createRoutine` (`support.ts:48-58`) calls it instead of its inline copy, so `support.ts` shrinks.
2. **New file `apps/server/src/routines/prompt-routines.ts`,** with `export async function createPromptRoutine(db, input: CreatePromptRoutineInput, now: Date, audit?: AuditRecorder): Promise<PublicRoutine>`. In order:
   - the same pairing check as `createRoutine`;
   - `parseRoutineTitle`;
   - `parseRoutineSchedule`;
   - the prompt: trimmed, non-empty, at most `MAX_ROUTINE_PROMPT_CHARS` characters (`invalid_request` with a plain message otherwise);
   - `enforceRoutineLimit`;
   - an INSERT like `createRoutine`'s, with `kind = 'prompt'`, `tool_id = NULL`, `prompt = <trimmed>`, `input = NULL` and `approved_hosts = '[]'::jsonb`, `RETURNING *`;
   - an audit of `routine.created` with `detail: { kind: 'prompt' }` and **never the prompt text**;
   - `return toPublicRoutine(inserted, '', schedule.value)`.

   Add a header comment (T-1641) saying nothing creates prompt routines until the chat action ships.
3. **`queries.ts`:** `toPublicRoutine` fills `kind: row.kind` and `prompt: row.prompt`. `toPublicRoutines` skips the tool-name query when `row.toolId === null` and passes `''`.
4. **New `apps/server/src/routines/prompt-routines.test.ts`** (permissions/money area), with the `scheduler.test.ts` setup:
   - a valid prompt routine is stored with `kind 'prompt'`, `toolId null` and the trimmed prompt;
   - an empty prompt and a 2001-character prompt are rejected with `invalid_request`;
   - the 11th routine in one topic is refused (the existing limit);
   - `groupId` without `topicId` is refused.
5. **Change nothing else:** no adapter, no scheduler, no wire or API contract change.

### Allowed files
- `apps/server/src/routines/schemas.ts`
- `apps/server/src/routines/support.ts`
- `apps/server/src/routines/queries.ts`
- `apps/server/src/routines/prompt-routines.ts`
- `apps/server/src/routines/prompt-routines.test.ts`
- `work/T-1641-create-prompt-routine.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines/prompt-routines.test.ts src/routines/execute.test.ts src/routines/scheduler.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`createPromptRoutine` behaves as listed,** with tests.
- **Tool routines are unchanged.**
- **`support.ts` gets shorter.**
- **Every file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

- `schemas.ts`: added `MAX_ROUTINE_PROMPT_CHARS = 2000`; added
  `CreatePromptRoutineInput`; added `kind: 'tool' | 'prompt'` and
  `prompt: string | null` to `PublicRoutine`; added
  `parseRoutineTitle(title: unknown): string`, which throws the same
  `RoutineServiceError('invalid_request', …)` the inline copy used to. Added
  the `Exit` and `firstIssueMessage` imports it needs.
- `support.ts`: `createRoutine` now calls `parseRoutineTitle(input.title)`;
  removed the inline title decode and the imports it no longer uses (`Exit`,
  `Schema`, `firstIssueMessage`, `titleSchema`). `title` is a plain string at
  the insert site now. **The file shrank from 391 to 380 lines.**
- `queries.ts`: `toPublicRoutine` fills `kind: row.kind` and
  `prompt: row.prompt`; `toPublicRoutines` skips the `ai_tools` name query
  when `row.toolId === null` and passes `''`.
- `prompt-routines.ts` (new): `createPromptRoutine(db, input, now, audit?)`,
  in order: the same `groupId`/`topicId` pairing check; `parseRoutineTitle`;
  `parseRoutineSchedule`; prompt trimmed, non-empty, `<= 2000` characters
  (`invalid_request`); `enforceRoutineLimit`; INSERT with `kind = 'prompt'`,
  `tool_id = NULL`, the trimmed `prompt`, `input = NULL`,
  `approved_hosts = '[]'::jsonb`, `RETURNING *`; audit of `routine.created`
  with `detail: { kind: 'prompt' }` and never the prompt text; returns
  `toPublicRoutine(inserted, '', schedule.value)`. Header comment (T-1641)
  says nothing creates prompt routines until the chat action ships.
- `prompt-routines.test.ts` (new): 4 tests with the `scheduler.test.ts`
  setup (`createTestContext`, `testSql`, `seedAi`, `seedUser`, `seedGroup`):
  a valid prompt routine is stored with `kind 'prompt'`, `toolId null`, the
  trimmed prompt, `input null`, empty hosts, and an audit that carries
  `detail: { kind: 'prompt' }` and does not contain the prompt text; an empty
  prompt and a 2001-character prompt are rejected with `invalid_request`; the
  11th routine in one topic is refused with `routine_limit`; a `groupId`
  without `topicId` is refused.

### Checks run

- `pnpm install`: done (14.6s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/prompt-routines.test.ts`
  → **1 file passed, 4 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/execute.test.ts src/routines/scheduler.test.ts`
  → **2 files passed, 3 tests passed**.
- First `pnpm gate` failed on format (`apps/server/src/routines/queries.ts`);
  ran `pnpm exec prettier --write apps/server/src/routines/queries.ts`, then
  `pnpm gate` again from the repo root. Summary lines:

  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.6s)
  PASS  lint  (1.2s)
  PASS  typecheck  (4.6s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/server  (9.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- No wire or API change: `toListWire`/`toDetailWire` still omit `kind` and
  `prompt`, as the spec says. `PublicRoutine` now carries them.
- `createPromptRoutine` is not re-exported from the `service.ts` barrel
  (`service.ts` is not an Allowed file). Nothing calls it yet, as specced; the
  new test imports it directly from `./prompt-routines`.
- The 10-per-topic cap uses the same check-then-insert `enforceRoutineLimit`
  path as `createRoutine` (the spec asks for "the existing limit"), so it is
  not made atomic in this task.

## Review (written by Claude)

**Approved and merged.** This is scheduled AI jobs step 3.

- **Pre-review:** clean, 2 nits.
- **`createPromptRoutine`** (`routines/prompt-routines.ts`, 92 lines) does the pairing check, `parseRoutineTitle`, the schedule, a trimmed prompt of at most 2000 characters, and the 10-per-topic limit. It inserts `kind 'prompt'` with no tool and no hosts, and audits `{ kind: 'prompt' }` without the text.
- **`createRoutine`** now uses the shared `parseRoutineTitle`, so `support.ts` went from 391 to 380 lines. `PublicRoutine` carries `kind` and `prompt`.
- **The tests:** the lead ran `prompt-routines`, `execute` and `scheduler`: 7 passed.
- **Nits, for the chat action task (plan task 6):**
  - that adapter decodes `prompt` as a string before calling;
  - `getRoutine` still looks up a tool name for a prompt row, a wasted read only.

