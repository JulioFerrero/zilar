---
id: T-1651
title: "Routines lists say 'runs a prompt' for a prompt routine (web + phone): the routine wire and API contract carry kind ('tool' | 'prompt'); the row text keeps today's design and only swaps the blank tool name"
status: merged
milestone: M5
branch: task/T-1651-routine-row-prompt-label
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1651: "runs a prompt" in the routines lists

## Spec (written by Claude, do not edit)

### Why
Scheduled AI jobs (plan `docs/plan/scheduled-ai-jobs.md` §3, T-1614) add prompt routines, which have no tool.
- **Both routines lists** render `<schedule> · runs <toolName> · <status>`, so a prompt routine would read "runs  ·" with a blank name.
- **The fix:** the server says which kind a routine is, and both rows say "runs a prompt". Same row, same styles, only the word changes.

Showing the prompt text is a new element, so it waits for a design canvas (not this task).

### Facts (the lead read them on 2026-10-16)
- **`apps/server/src/routines/wire.ts`:**
  - `toListWire(routine: PublicRoutine)` (`:3-21`) has no `kind`. `PublicRoutine.kind` exists since T-1641.
  - `toDetailWire(routine: {…}, toolName)` (`:23-…`) is used by `apps/server/src/routines/api.ts:155` with `found.routine` (a `RoutineRow`, which has `kind`), after pause and resume.
- **`packages/api-contract/src/routines.ts`:** `Routine = Schema.Struct({ … toolName: Schema.String, … })` (`:9-25`).
- **Web:** `apps/web/src/components/tools/RoutinesSection.tsx:259`: `{describeRoutineSchedule(current.schedule)} · runs {current.toolName} ·{' '}`.
- **Phone:** `apps/mobile/src/components/ais/routines-section.tsx:147`: `{describeRoutineSchedule(routine.schedule)} · runs {routine.toolName} ·{' '}`.

### Steps
1. **`api-contract` `Routine`:** add `kind: Schema.optional(Schema.Literals(['tool', 'prompt']))`. It's optional, so old servers and mocks still decode.
2. **`wire.ts`:**
   - `toListWire` sends `kind: routine.kind`;
   - `toDetailWire`'s input type gains `kind: 'tool' | 'prompt'`, and it sends `kind`.
   - **Don't send the prompt text.**
3. **Web row (`RoutinesSection.tsx:259`) and phone row (`routines-section.tsx:147`):** `runs {routine.kind === 'prompt' ? 'a prompt' : routine.toolName}`. Nothing else changes in either file.
4. **No tests** (UI, per the test rules). Typecheck covers the contract.

### Allowed files
- `packages/api-contract/src/routines.ts`
- `apps/server/src/routines/wire.ts`
- `apps/web/src/components/tools/RoutinesSection.tsx`
- `apps/mobile/src/components/ais/routines-section.tsx`
- `apps/mobile/src/lib/tools-api.ts` (added by the lead: the phone's own `Routine` interface at `:94-110` gains `kind?: 'tool' | 'prompt'`)
- `work/T-1651-routine-row-prompt-label.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A prompt routine reads "runs a prompt" on web and phone.**
- **Tool routines read exactly as before.**

---

## Report (written by the worker when done)

### What I did
- `packages/api-contract/src/routines.ts`: added
  `kind: Schema.optional(Schema.Literals(['tool', 'prompt']))` to `Routine`
  (after `topicId`, before `toolId`, mirroring `PublicRoutine`).
- `apps/server/src/routines/wire.ts`: `toListWire` now sends `kind: routine.kind`;
  `toDetailWire`'s input type gained `kind: 'tool' | 'prompt'` and it sends
  `kind: routine.kind`. The prompt text is not sent.
- `apps/web/src/components/tools/RoutinesSection.tsx` (line 259-260): the row now
  renders `runs {current.kind === 'prompt' ? 'a prompt' : current.toolName}`.
- `apps/mobile/src/components/ais/routines-section.tsx` (line 147-148): same, for
  `routine`.
- `apps/mobile/src/lib/tools-api.ts` (line 99-100): added
  `kind?: 'tool' | 'prompt';` to the phone's own `Routine` interface, with a
  one-line T-1651 comment. (The lead approved this file after my first pass, see
  below.)
- I then ran Prettier on the two JSX files only: my first wrapping of the
  expression failed the gate's format check, so I let Prettier choose the break
  (it produced `... · runs{' '}` / value / `· {statusText(...)}`).

### Found while working (now resolved)
- Web's `Routine` is re-exported from `@zilar/api-contract`
  (`apps/web/src/lib/tools.ts:8-16`), so it picked up `kind` and web typechecks.
- Mobile's `Routine` is a **second, hand-written interface** in
  `apps/mobile/src/lib/tools-api.ts:94-110`, imported by the row at
  `routines-section.tsx:16`. The spec assumed the phone row used the contract
  `Routine`; it does not, so the first pass failed typecheck with
  `routines-section.tsx(148,20): error TS2339: Property 'kind' does not exist on
  type 'Routine'`.
- I stopped and set `status: blocked` (that file was outside the Allowed files).
  The lead approved adding it, and it is now listed under Allowed files.

### Checks run
- `pnpm install` — done (17.8s).
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.7s)
  PASS  lint  (0.7s)
  PASS  typecheck  (4.9s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/mobile  (2.6s)
  PASS  tests @zilar/server  (8.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (The earlier run before the approval ended in `GATE FAIL` on
  `@zilar/mobile#typecheck` with the TS2339 above.)
- No single test run by hand: the spec says no tests (UI), and no test imports
  `routines/wire.ts`; the gate ran the nearest tests anyway.

### Notes for the lead
- All steps are done; the six changed files are all inside the Allowed files.
- I did not verify the rendered text in the running apps (no test covers UI); the
  change is a one-word swap in the existing JSX, and typecheck passes.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **The change:** the contract gains an optional `kind`. The wire sends it on the list and on pause/resume. The phone's own `Routine` type gets the field (the lead added that file mid-task). Web and phone rows read "runs a prompt" for a prompt routine and are unchanged for tool routines.
- **Why no phone smoke:** the mock data has no prompt routines, so a screenshot would show the unchanged tool rows, and the swap is one conditional word that typecheck covers.
- **Not yet shown:** the prompt text, which needs a canvas first.
