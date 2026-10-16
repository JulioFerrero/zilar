---
id: T-1704
title: "routine.schedule: stop the AI copying the example — a neutral argsExample (not the morning-prices case) and a description that states the schedule rules (daily HH:MM + IANA timezone, or every 60–10080 minutes) and says to tell the person when they ask for something more frequent instead of picking another schedule"
status: merged
milestone: M5
branch: task/T-1704-routine-schedule-example
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1704: routine.schedule follows the person, not the example

## Spec (written by Claude, do not edit)

### Why
Julio asked @Deepseek (2026-10-16 09:36 Madrid) for "a btc, gold and sp500 message … a routine every 5min". The AI proposed `Schedule "Morning prices": daily at 08:00 Europe/Madrid`, which is the tool's `argsExample` word for word. Two problems:
- the example is so close to a real request that the model copies it;
- the description doesn't say that routines run at most hourly, so the model didn't tell him that 5 minutes isn't possible.

### Facts (the lead read them on 2026-10-16)
- **`apps/server/src/tools/routine-adapters.ts:87-96`:** `routineScheduleAdapter`:
  - `description: 'Schedule a routine in this chat (needs approval): either a prompt you run yourself on that schedule and answer here (use your computer or actions as needed), or a saved tool whose result is posted.'`;
  - `argsExample: '{"title":"Morning prices","schedule":{"kind":"daily","time":"08:00","timezone":"Europe/Madrid"},"prompt":"Post the current BTC, gold and S&P 500 prices with their sources."}'`.
- **`apps/server/src/routines/schedule.ts`:**
  - the schedule is `{ kind: 'daily', time: 'HH:MM', timezone: <IANA name>, weekdays?: number[] }` (`:5`) or `{ kind: 'interval', everyMinutes: number }` with `60 <= everyMinutes <= 10 080`, "nothing runs more often than hourly" (`:11-12`);
  - `MIN_INTERVAL_MINUTES = 60` (`:16`).
- **`apps/server/src/tools/routine-schedule-prompt.test.ts`** uses its own `'Morning prices'` fixture (`:17`, `:64`, `:108`) and doesn't read `argsExample`.

### Steps
1. **Replace `argsExample`** with a neutral case that matches no likely request about prices or mornings, using the interval form:

   `{"title":"Release notes digest","schedule":{"kind":"interval","everyMinutes":120},"prompt":"Summarise the release notes posted in this chat since the last run."}`
2. **Extend `description`** (keep its first sentence) with:

   > Schedules: daily at HH:MM in an IANA timezone (optional weekdays 0-6), or every N minutes with N from 60 to 10080; nothing runs more often than hourly. Use the person's own title, schedule and prompt, never the example. If they ask for something more frequent than hourly, tell them the hourly minimum and offer hourly; never pick a different schedule on your own.
3. **No other change.** The test fixture keeps its own 'Morning prices'. Run the one test file below.

### Allowed files
- `apps/server/src/tools/routine-adapters.ts`
- `work/T-1704-routine-schedule-example.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/tools/routine-schedule-prompt.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The new example is used:** the `argsExample` no longer mentions prices, mornings or Europe/Madrid.
- **The description carries the schedule rules** and the hourly-minimum instruction.
- **The test file passes.**

---

## Report (written by the worker when done)

### What I did

Edited only `apps/server/src/tools/routine-adapters.ts`:

1. Replaced `routineScheduleAdapter`'s `argsExample` with the neutral interval
   case from the spec:
   `{"title":"Release notes digest","schedule":{"kind":"interval","everyMinutes":120},"prompt":"Summarise the release notes posted in this chat since the last run."}`
   (no prices, no "Morning", no `Europe/Madrid`, no `daily`).
2. Kept the existing first sentence of `description` and appended the schedule
   rules and the hourly-minimum instruction, verbatim from the spec except for
   the weekday range — see "Deviation from the spec" below.

No other change. The test fixture in `routine-schedule-prompt.test.ts` keeps its
own `'Morning prices'`.

**Deviation from the spec (one, deliberate):** step 2 says to state
"optional weekdays 0-6", but the code validates weekdays as **1–7** with
1 = Monday (`apps/server/src/routines/schedule.ts:54-56`,
`Schema.isBetween({ minimum: 1, maximum: 7 })`, and the module comment at
`:5-7`), and `nextRunAfter` uses `isoWeekday` (1–7) at `:163-169`. Writing
"0-6" would tell the model to emit a value the schema rejects. Per AGENTS.md
("check every claim against the code") I wrote **"optional weekdays 1-7, where 1
is Monday"** instead. Everything else in the appended text is verbatim.

### Checks run

- `pnpm --filter @zilar/server exec vitest run src/tools/routine-schedule-prompt.test.ts --reporter=dot --maxWorkers=2`
  → `Test Files 1 passed (1)`, `Tests 5 passed (5)`.
- `pnpm gate` (repo root) → `gate: 2 changed file(s) against main`
  ```
  PASS  install (frozen)  (3.2s)
  PASS  format  (1.6s)
  PASS  lint  (1.7s)
  PASS  typecheck  (4.1s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/server  (6.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  First `pnpm gate` run FAILed on `format` only (prettier wanted the outer
  quotes of the new sentence changed to double quotes because it contains an
  apostrophe); fixed that single line and re-ran to the PASS above.

Acceptance: the `argsExample` no longer mentions prices, mornings or
`Europe/Madrid`; the description carries the schedule rules and the
hourly-minimum instruction; the test file passes.

### Notes for the lead

- **Open question / decision to confirm:** the weekday range in the spec text
  ("0-6") contradicts the code ("1-7"); I used 1-7. If you truly want the
  description to say 0-6, tell me and I'll change the string (but it would then
  disagree with the schema).
- One `git diff` note: only the two Allowed files were touched.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits.
- **The change:**
  - the `argsExample` is now the neutral "Release notes digest", every 120 minutes;
  - the description carries the schedule rules and tells the AI to state the hourly minimum instead of choosing another schedule.
- **The worker corrected the lead's spec:** weekdays are ISO **1–7** with 1 = Monday (`routines/schedule.ts:56`, `isBetween({ minimum: 1, maximum: 7 })`, and `nextRunAfter`'s `isoWeekday`). The spec's "0-6" was wrong.
- **Context:** this fixes Julio's 09:36 test, where "every 5min" became the copied example "Morning prices, daily 08:00 Europe/Madrid".
