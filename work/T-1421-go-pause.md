---
id: T-1421
title: "Lead models: a 'Go paused until' setting skips OpenCode Go models (workers start on the DeepSeek API, reviews go free Muse then paid Muse) until a date"
status: merged
milestone: M5
branch: task/T-1421-go-pause
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1421: Pause OpenCode Go until a date

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: OpenCode Go's monthly usage is at 100% and renews in 12 days. Until then every Go call fails first and then falls back (`LEAD: FALLBACK … Go DeepSeek flash failed or rate-limited`), which wastes a failed attempt per session.

Julio already OK'd paid models while Go is out of funds.

### Facts (the lead checked them on main, 2026-10-14)
- **Model ids:** `packages/devtools/src/lead/models.ts:3-14`: `FREE_MUSE`, `PAID_MUSE`, `DEEPSEEK_FLASH` (the metered API), `GO_DEEPSEEK_FLASH` and `GO_MUSE`.
- **`resolveWorkerModel`** (`packages/devtools/src/lead/model-schedule.ts:28-36`) returns `GO_DEEPSEEK_FLASH` for `model: auto`.
- **`fallbackModel`** is `packages/devtools/src/lead/fallback.ts:9-18`:
  - Go DeepSeek → DeepSeek API → Go Muse → paid Muse;
  - free Muse → Go Muse.
- **Lead files** live in `~/.zilar-lead/` (`state.json`, `autopilot.out`, …).

### What to build
1. **The setting:** an optional `~/.zilar-lead/config.json` with `{ "goPausedUntil": "2026-10-26" }` (an ISO date; Go is paused before it). Read it once per call with a small helper in a new `packages/devtools/src/lead/go-pause.ts`. A missing or bad file means "not paused" (log a warning once for a bad file).
2. **While paused:**
   - `resolveWorkerModel` for `auto` returns `DEEPSEEK_FLASH` (effort `default`);
   - `fallbackModel` skips Go: DeepSeek API → paid Muse, free Muse → paid Muse;
   - any place that starts a pre-review or the doctor on `GO_MUSE` uses the next model instead.
   
   Find all of them with `grep -rn "GO_MUSE\|GO_DEEPSEEK_FLASH" packages/devtools/src/lead`.
3. **`lead status`** prints one line when Go is paused: `Go paused until 2026-10-26`.
4. **Docs:** one line in `docs/LEAD_HANDOFF.md` on how to set or clear it.

### Tests (few)
`go-pause.test.ts`:
- paused before the date and not paused on or after it;
- `resolveWorkerModel('auto')` gives `DEEPSEEK_FLASH` while paused;
- `fallbackModel` never returns a Go model while paused.

### Allowed files
`packages/devtools/src/lead/**`, `docs/LEAD_HANDOFF.md`, `work/T-1421-go-pause.md`.

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run src/lead --reporter=dot
pnpm gate
```

### Acceptance
The gate passes. With no config file, behaviour is unchanged.

---

## Report (written by the worker when done)

### What I did
- **New `packages/devtools/src/lead/go-pause.ts`.** Reads `~/.zilar-lead/config.json`
  (`{"goPausedUntil":"YYYY-MM-DD"}`) on every call, no caching. `goPause(now, path?)`
  returns `{ until }` while `today < until` and `undefined` on/after it or when the
  file/key is missing. A missing file is silently "not paused"; a bad file (bad JSON,
  wrong shape, impossible date) is ignored and warns **once per process** on stderr.
  The path honours `ZILAR_LEAD_CONFIG` (mirrors `ZILAR_LEAD_STATE`) so tests never
  touch the real home config. `withoutPausedGoModel(model, goPaused)` maps a Go Muse
  pre-review/doctor model to the paid Muse while paused.
- **`model-schedule.ts`:** `resolveWorkerModel`/`resolveWorkerVariant` take a
  `goPaused` boolean; `auto` resolves to `DEEPSEEK_FLASH` (`effort: default`) while
  paused, unchanged Go DeepSeek otherwise. Explicit `model:` values are untouched.
- **`fallback.ts`:** `fallbackModel(model, goPaused)` skips Go while paused —
  DeepSeek API → paid Muse, free Muse → paid Muse; it never returns an `opencode-go/…`
  model then.
- **`decide.ts` / `doctor.ts`:** new `goPaused` input field threaded into every
  `fallbackModel` call. The pure functions stay filesystem-free; the autopilot tick
  gathers `isGoPaused(...)`.
- **`autopilot.ts`:** gathers `goPaused` for both `decide` and `decideDoctor`, and
  passes it to the in-place `resolveWorkerVariant` switch.
- **`launch.ts` / `fresh-session.ts` / `switch-model.ts`:** compute `isGoPaused(now)`
  for `resolveWorkerModel`/`resolveWorkerVariant`.
- **`start-prereview.ts` / `doctor.ts` start paths:** start on
  `withoutPausedGoModel(reviewModel(), isGoPaused())`, so a Go Muse pre-review or
  doctor moves to the paid Muse while Go is paused.
- **`status.ts`:** prints `Go paused until <date>` after the table, only while paused.
- **`docs/LEAD_HANDOFF.md`:** one line on setting/clearing the pause.
- **New `go-pause.test.ts`:** paused before the date and not on/after it; missing and
  bad files are not paused; `resolveWorkerModel('auto')` gives `DEEPSEEK_FLASH` while
  paused; `fallbackModel` never returns a Go model while paused; Go Muse review/doctor
  moves to the paid Muse.

### Files changed
`packages/devtools/src/lead/go-pause.ts` (new), `…/go-pause.test.ts` (new),
`model-schedule.ts`, `fallback.ts`, `decide.ts`, `doctor.ts`, `autopilot.ts`,
`launch.ts`, `fresh-session.ts`, `switch-model.ts`, `start-prereview.ts`,
`status.ts`, `docs/LEAD_HANDOFF.md`, `work/T-1421-go-pause.md`. All inside Allowed
files.

### Commands and real results
- `pnpm install`: done in 14.1s.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/go-pause.test.ts`: 6 passed (6).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/model-schedule.test.ts src/lead/autopilot.test.ts`: 9 passed (9).
- `pnpm --filter @zilar/devtools exec vitest run src/lead --reporter=dot`: 6 files, 46 passed (46).
- `pnpm gate` (root), first run: `FAIL format` on `go-pause.test.ts`; ran
  `pnpm exec prettier --write` on it, then re-ran. Second run:
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.1s)
  PASS  lint  (1.2s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/devtools  (12.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```

### Deviations from the spec
- The spec's test shorthand `resolveWorkerModel('auto')` is satisfied through the new
  explicit `goPaused` argument (`resolveWorkerModel('auto', now, isGoPaused(now, cfg))`).
  I kept `resolveWorkerModel`/`fallbackModel` pure (they never read the filesystem), as
  `decide.ts`/`doctor.ts` are documented pure functions; the I/O boundaries
  (launch, fresh-session, switch-model, autopilot tick, pre-review/doctor start) read
  the setting once per call via `isGoPaused`. No behaviour changes with no config file.

### Open questions
- None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 3. The lead tests pass locally (6 files, 46). The lead sets ~/.zilar-lead/config.json goPausedUntil to 2026-10-27 (Go renews in about 12 days from 10-14).
