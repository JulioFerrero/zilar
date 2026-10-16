---
id: T-1649
title: "Scheduled AI jobs step 6: routine.schedule also takes { title, schedule, prompt } — the approval card shows the schedule and the prompt, never 'always allow', and approving it creates a prompt routine the AI runs itself and answers in this chat"
status: merged
milestone: M5
branch: task/T-1649-routine-schedule-prompt-card
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1649: The AI can schedule a prompt (approval card)

## Spec (written by Claude, do not edit)

### Why
This is scheduled AI jobs, plan `docs/plan/scheduled-ai-jobs.md` §2.6 and §4 task 6 (T-1614). Julio's goal: say "every morning at 8 post gold, S&P 500 and BTC", see one approval card, and from then on the AI does the job itself, with its computer or its tools, and posts here.
- **Done so far:** the service (`createPromptRoutine`, T-1641), the executor (T-1645) and the gateway runner (T-1647/T-1648).
- **This task opens the door:** the `routine.schedule` action accepts a prompt.

The reader/writer code (T-1638, T-1641, T-1645) is already live, so a new prompt row is never read by an old leader. That's the plan's rollout guard.

### Facts (the lead read them on 2026-10-16, main after T-1645)
- **`apps/server/src/tools/tool-arg-schemas.ts`** (93 lines): `routineScheduleArgsSchema = struct({ tool: toolNameSchema, title: routineTitleSchema, schedule: routineScheduleSchema, hosts: toolHostsSchema, input: Schema.optional(...) })` (`:82-88`). `struct` comes from `@zilar/protocol` (`:4`).
- **`apps/server/src/tools/routine-adapters.ts`** (242 lines), `routineScheduleAdapter(state)` (`:76-157`):
  - `tier: 2`, a `description`, and an `argsExample` (a tool routine);
  - `describe` gives `summary: Schedule "<title>": <describeSchedule>` and `details: Runs tool … It will contact: …`;
  - `execute` finds the tool, checks the hosts, then calls `createRoutine(...)`, `nextRunAfter` and `formatNextRun`, mapping `RoutineServiceError` through `serviceFailure`;
  - `ownerOf(state.db, actionCtx.aiId)` gives the user id. There's no `allowAlways`, so "always allow" is refused.
- **`createPromptRoutine(db, { aiId, groupId, topicId, title, schedule, prompt, userId }, now, audit?)`:** `apps/server/src/routines/prompt-routines.ts:25`. `MAX_ROUTINE_PROMPT_CHARS = 2000`: `apps/server/src/routines/schemas.ts:11`.
- **The daily schedule shape:** `{ kind: 'daily', time: 'HH:MM', timezone: <IANA>, weekdays?: number[] }` (`apps/server/src/routines/schedule.ts:5`).
- **`apps/server/src/actions/args-example.test.ts`** checks that every web, tool and routine adapter ships an `argsExample` that decodes.

### Steps
1. **`tool-arg-schemas.ts`:**
   - add `routinePromptScheduleArgsSchema = struct({ title: routineTitleSchema, schedule: routineScheduleSchema, prompt: <a string, trimmed non-empty, at most MAX_ROUTINE_PROMPT_CHARS> })`;
   - turn the exported `routineScheduleArgsSchema` into a `Schema.Union` of the existing tool shape and the prompt shape. Keep the tool shape byte-identical. A value with `prompt` must never decode as the tool shape, and vice versa.
2. **`routine-adapters.ts`, `routineScheduleAdapter`:**
   - **`description`:** `'Schedule a routine in this chat (needs approval): either a prompt you will run yourself on that schedule and answer here (use your computer or actions as needed), or a saved tool whose result is posted.'`
   - **`argsExample`:** the prompt form, `'{"title":"Morning prices","schedule":{"kind":"daily","time":"08:00","timezone":"Europe/Madrid"},"prompt":"Post the current BTC, gold and S&P 500 prices with their sources."}'`.
   - **`describe`:** when `prompt` is present, `summary` is unchanged and `details` is `Runs this prompt on that schedule and posts my answer here: "<prompt>"`. Cut the prompt at 500 characters with `…`. There's no hosts line.
   - **`execute`:** when `prompt` is present, skip the tool and host checks and call `createPromptRoutine(state.db, { aiId, groupId, topicId, title, schedule, prompt, userId: owner }, state.now(), …audit)`. Return the same summary format. Map `RoutineServiceError` the same way. The tool branch stays exactly as it is.
3. **Tests:** `args-example.test.ts` must still pass with the new example. Add to the nearest routine test, or a new `apps/server/src/tools/routine-schedule-prompt.test.ts` (permissions/money):
   - executing the prompt variant creates a `kind 'prompt'` routine for the AI's chat;
   - the args `{ tool, title, schedule, hosts, prompt }` don't decode;
   - the card `details` contains the prompt and no hosts line.

### Allowed files
- `apps/server/src/tools/tool-arg-schemas.ts`
- `apps/server/src/tools/routine-adapters.ts`
- `apps/server/src/tools/routine-schedule-prompt.test.ts`
- `work/T-1649-routine-schedule-prompt-card.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/actions/args-example.test.ts src/tools/routine-schedule-prompt.test.ts src/routines/prompt-routines.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The prompt variant creates a prompt routine through a tier-2 card.**
- **The tool variant is unchanged.**
- **The tests pass.**
- **Every file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

- `apps/server/src/tools/tool-arg-schemas.ts`: added a private `routinePromptSchema` (trimmed non-empty, at most `MAX_ROUTINE_PROMPT_CHARS`, imported from `../routines/schemas`), the `routinePromptScheduleArgsSchema` struct, kept the existing tool struct fields byte-identical (now `routineToolScheduleArgsSchema`), and exported `routineScheduleArgsSchema` as `Schema.Union([tool, prompt])`.
- `apps/server/src/tools/routine-adapters.ts`: `routineScheduleAdapter` now describes and executes both forms. New `description` and prompt-form `argsExample`; `describe` adds the prompt details line (prompt cut at 500 chars with `…`, no hosts line) and keeps the old summary; `execute` branches on `prompt`, skips the tool/host checks, calls `createPromptRoutine(state.db, { …, userId: owner }, state.now(), …audit)` and reuses the same summary + `RoutineServiceError` mapping. The tool branch is unchanged (verified by the passing tool tests and the diff).
- `apps/server/src/tools/routine-schedule-prompt.test.ts` (new): executes the prompt variant against a real PGlite context and asserts one `kind = 'prompt'` row for the AI's chat (null group/topic, prompt stored); asserts the prompt args and the tool args both decode through the union; asserts `{ tool, title, schedule, hosts, prompt }` does not decode; asserts the card details contain the prompt and no hosts line; asserts a long prompt is cut at 500 chars with `…`.

### Checks run

- `pnpm install`: done (18.8s).
- `pnpm --filter @zilar/server exec vitest run src/actions/args-example.test.ts src/tools/routine-schedule-prompt.test.ts src/routines/prompt-routines.test.ts --maxWorkers=2 --reporter=dot`: `Test Files 3 passed (3)`, `Tests 27 passed (27)`.
- `pnpm gate`: first run `GATE FAIL` at `typecheck` (`routine-schedule-prompt.test.ts(37,3): Promise<readonly RoutineRow[]>` not assignable). Fixed the helper return type to `readonly`; re-ran: `GATE PASS`. Summary lines: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`; `scope: every changed file is inside the Allowed files`; `size: every changed source file is within 400 lines`.
- File sizes: `tool-arg-schemas.ts` 124, `routine-adapters.ts` 292, `routine-schedule-prompt.test.ts` 121 lines.

### Notes for the lead

- **Deviation (1): the spec's `description` is 202 chars, over the 200-char `ADAPTER_DESCRIPTION_MAX_LENGTH`.** The mandated `args-example.test.ts` calls `buildRegistry`, which throws on a description over 200, so the exact spec text cannot pass the Checks/gate. I trimmed only the word `will` (`either a prompt you will run yourself …` → `either a prompt you run yourself …`), giving 197 chars and the same meaning. If you want a different wording, say so and I'll change it.
- Everything else follows the spec: no `allowAlways`, tier 2, the tool branch is unchanged, and `createPromptRoutine` audits ids only (`detail: { kind: 'prompt' }`, never the prompt text).

## Review (written by Claude)

**Approved.** This is scheduled AI jobs step 6. The lead merged it only after T-1648 wired the runner, so no prompt routine exists before something runs it.

- **Pre-review:** clean, 1 nit. "you will run" became "you run" to fit the registry's 200-character description limit, which is accepted.
- **The schema:** `routine.schedule` decodes either the unchanged tool shape or `{ title, schedule, prompt }`.
- **The prompt card:** it shows the schedule and up to 500 characters of the prompt, with no hosts line. It's tier 2 with no "always allow", and executes `createPromptRoutine` for the AI's own chat.
- **The `argsExample`** is the morning-prices prompt.
- **The tests:** the lead ran `args-example`, `routine-schedule-prompt` and `prompt-routines`: 27 passed.

