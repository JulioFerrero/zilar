---
id: T-1538
title: "Web My AIs health row uses chat-core's aiHealth, spendFraction and formatUsd (follow-up of T-1517): delete the web copies (FAILURE_REASONS, the inline health and spend maths, apps/web/src/lib/format-usd.ts); no visible change"
status: merged
milestone: M5
branch: task/T-1538-web-ai-health-shared
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1538: Web health row on the shared helper

## Spec (written by Claude, do not edit)

### Why
T-1517 moved the AI health rules into `packages/chat-core/src/ai-health.ts` for the phone. The web row still has its own copy of the same rules, so the two could drift. This is a refactor only: **nothing on screen changes**.

### Facts (the lead read them on main, 2026-10-15)
- **`packages/chat-core/src/ai-health.ts`** exports:
  - `AiHealthState` (`'working' | 'failing' | 'paused' | 'stopped'`);
  - `AiHealth` (`state`, `reason?`, `fix?: 'replace_key' | 'change_model'`);
  - `formatUsd` (`:39-41`);
  - `spendFraction` (`:44-51`);
  - `aiHealth` (`:59-78`).
  
  Its `FAILURE_REASONS` and "Last reply failed" fallback (`:6-15`) match the web's.
- **`apps/web/src/components/ais/AiHealthRow.tsx` (257 lines):**
  - `FAILURE_REASONS` (`:41-48`);
  - `paused` (`:97`);
  - the inline `health` (`:100-107`);
  - the muted line's branches (`:111-153`);
  - `usedFraction` and `full` (`:155-157`);
  - `formatUsd` from `@/lib/format-usd` (`:10`).
- **`apps/web/src/lib/format-usd.ts` (4 lines)** holds the same `formatUsd`. It is imported by `AiHealthRow.tsx` and `apps/web/src/components/ais/AiUsageSection.tsx`.

### Steps
1. **`AiHealthRow.tsx`:**
   - compute `const health = aiHealth(ai)` once and drive the dot and the muted line from `health.state`, `health.reason` and `health.fix`:
     - the dot colour and its label map from `state`, with the same colours and labels as today;
     - `fix === 'replace_key'` gives the "Replace key" link, and `fix === 'change_model'` the "Change model" button;
   - use `spendFraction(ai)` for the bar (null gives 0 and no bar, as today) and `=== 1` for "full";
   - delete the local `FAILURE_REASONS`.
2. **Import `formatUsd` from `@zilar/chat-core`** in both web files, and delete `apps/web/src/lib/format-usd.ts`.
3. **Every label, colour, link and number stays the same.**

### Tests
None new (the chat-core test covers the rules).

### Allowed files
- `apps/web/src/components/ais/AiHealthRow.tsx`
- `apps/web/src/components/ais/AiUsageSection.tsx`
- `apps/web/src/lib/format-usd.ts` (delete)
- `work/T-1538-web-ai-health-shared.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The web mock `/ais` looks exactly as on main: dots, the muted lines (failing reasons with Replace key or Change model, "Daily limit reached"), spend and bars.
- `git grep FAILURE_REASONS apps/web` finds nothing.
- 0 page errors.

---

## Report (written by the worker when done)

### What I did
Follow-up of T-1517: the web My AIs row now reads chat-core's shared health rules
instead of its own copy. No visible change.

- `apps/web/src/components/ais/AiHealthRow.tsx`
  - deleted the local `FAILURE_REASONS` map;
  - removed the inline `paused` flag, the inline `health` object and the
    `usedFraction`/`full` maths;
  - computes `aiHealth(...)` once and drives the dot and the muted line from
    `health.state`, `health.reason` and `health.fix`; the dot label/colour object
    is now named `dot` (the name `health` holds the state);
  - `fix === 'replace_key'` renders the "Replace key" link, `fix === 'change_model'`
    the "Change model" button;
  - the bar uses `spendFraction(...)` (`undefined` -> 0) and `=== 1` for full;
  - imports `formatUsd`, `aiHealth` and `spendFraction` from `@zilar/chat-core`.
- `apps/web/src/components/ais/AiUsageSection.tsx`: imports `formatUsd` from
  `@zilar/chat-core`.
- `apps/web/src/lib/format-usd.ts`: deleted (both importers moved).

Every label, colour, link and number is byte-for-byte what it was on main.

### Checks run
- `git grep FAILURE_REASONS -- apps/web` -> no matches (exit 1).
- `git grep format-usd -- apps/web` -> no matches (exit 1).
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/ai-health.test.ts`
  -> 1 file passed, 9 tests passed.
- `pnpm gate` (from repo root, see summary below):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  First `pnpm gate` run FAILED typecheck (`AiHealthRow.tsx(88,27)` and `(148,38)`:
  `PublicAi` not assignable to `AiHealthInput` under `exactOptionalPropertyTypes`);
  fixed by normalising the input, second run passed.

### Notes for the lead
- Small deviation from the spec's wording: it says `aiHealth(ai)` /
  `spendFraction(ai)`. Passing `PublicAi` straight in does not typecheck, because
  `exactOptionalPropertyTypes` makes its optional `usage`/`lastFailure` include
  `undefined` while `AiHealthInput` allows only the value or `null`. I build one
  `const healthInput: AiHealthInput = { status, limits, usage: ai.usage ?? null,
  lastFailure: ai.lastFailure ?? null }` and pass it to both helpers. Same inputs,
  same output, no visible change.
- The behaviour is identical: `aiHealth` pauses when `spendFraction === 1`, which
  is the old `usage.todayUsd >= dailyLimit`; the failure `kind` branching and the
  "Last reply failed" fallback live in chat-core and match the deleted copy.
- No new tests (spec says none; UI code).

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **No visible change, verified:** the same headless script on `/settings/ais?mock=1` printed identical output on main and on this branch:
  - Dev-1 "gpt-4o · OpenAI $0.42";
  - QA-1 "Key rejected · Replace key";
  - Marketing AI "Daily limit reached · claude-sonnet-5 $5.00 / $5";
  - one each of the Working, Failing and Paused dots;
  - 0 page errors.
- **The web copies are gone:** `FAILURE_REASONS` is no longer in `apps/web`, and `apps/web/src/lib/format-usd.ts` is deleted. Web and phone now share chat-core's `aiHealth`, `spendFraction` and `formatUsd`.
