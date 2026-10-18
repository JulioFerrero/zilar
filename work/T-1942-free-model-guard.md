---
id: T-1942
title: "Lead tools: stop hammering OpenCode's free models (pause on refusal, at most one free session at a time)"
status: merged
milestone: M5
branch: task/T-1942-free-model-guard
model: deepseek/deepseek-flash
effort: default
depends_on: []
estimate: 40 min
---

# T-1942: Free-model guard

## Spec (written by Claude, do not edit)

### Why
On 2026-10-18 OpenCode's free gateway refused every free model from this machine with "Forbidden, OpenCode Free Model Gateway Detect Abuse Traffic". That covered `opencode/deepseek-v4.1-flash-free`, `opencode/glm-5.3-flash-free` and `opencode/beam-free`; `opencode/muse-spark-1.3-contributor-free` answered "Model unavailable".

The cause is our pattern:
- every launch, fresh fix round and pre-review **starts** on a free listing (`model: auto` → free DeepSeek; reviews → free Muse);
- with up to 8 workers plus pre-reviews, many free sessions run at once;
- once refused, each new session tries the free listing again before falling back. `~/.zilar-lead/autopilot.out` has 278 "free DeepSeek flash failed" lines.

Julio: "we need to stop abusing the free models, like run 1 of 5 tasks in a free model maybe? this way we dont get flaged". This task keeps the free models usable and stops the repeated refusals.

### Facts (read by the lead on 2026-10-18)
- **`packages/devtools/src/lead/models.ts`:**
  - free listings: `FREE_MUSE` (`:3`), `FREE_DEEPSEEK_FLASH` (`:9`), `FREE_GLM_FLASH` (`:10`);
  - paid: `DEEPSEEK_FLASH` (`:12`), `PAID_MUSE` (`:4`);
  - Go: `GO_DEEPSEEK_FLASH` (`:16`), `GO_MUSE` (`:19`).
- **`model-schedule.ts:34-43`:** `resolveWorkerModel('auto', …)` always returns `FREE_DEEPSEEK_FLASH`. It's called by `launch.ts:236` and `fresh-session.ts:57`.
- **`task-file.ts:91-101`:** `reviewModel()` returns the free Muse unless `ZILAR_REVIEW_MODEL` is set. It's called by `start-prereview.ts:44` and `doctor.ts:129`, each through `withoutPausedGoModel(…, isGoPaused())`.
- **`fallback.ts:32-46`:** `fallbackModel` gives the next step: free DeepSeek → Go/API DeepSeek; free GLM → Go/paid Muse; free Muse → free GLM.
- **`go-pause.ts` (98 lines) is the pattern to copy:**
  - `goPausedUntil` lives in `~/.zilar-lead/config.json` (`goPauseConfigPath()` `:11`, schema `:22`, `goPause()` `:46`, `isGoPaused()` `:80`);
  - it's read on every call, so no autopilot restart is needed;
  - the live config today holds `{ "goPausedUntil": "2026-10-27" }`.
- **`decide.ts:118-123`:** `pushWorkerFallback` emits `LEAD: FALLBACK …`.
- **`session.ts:53-82`:** `containsQuotaError` decides what counts as a quota or auth failure (types `provider.quota`, `provider.rate-limit`, `provider.auth`; status 401/402/429). It does **not** treat a 403 or the "Detect Abuse Traffic" text as such.
- **Tests exist** next to the code: `go-pause.test.ts`, `model-schedule.test.ts`, `autopilot.test.ts`.

### Steps
1. **Free pause** (new `packages/devtools/src/lead/free-pause.ts`, about 80 lines, modelled on `go-pause.ts`, sharing its config path):
   - Read an optional `freePausedUntil` (a full ISO timestamp) from `config.json`.
   - `isFreePaused(now)` is true while `now` is before that time.
   - `pauseFree(now, hours, reason)` writes `freePausedUntil = now + hours`, keeps every other key in the file, and prints `LEAD: FREE PAUSED until <iso> (<reason>)` once.
   - A malformed value is ignored with one warning, as in `go-pause.ts`.
2. **Skip free while paused:**
   - `resolveWorkerModel('auto', now, goPaused)` returns `fallbackModel(FREE_DEEPSEEK_FLASH, goPaused)` while free is paused.
   - `reviewModel()` (without `ZILAR_REVIEW_MODEL`) returns the paid step: `GO_MUSE`, or `PAID_MUSE` when Go is paused. Its callers already apply the Go pause.
   - `fallbackModel` must never move a session **onto** a free listing while paused: free Muse → free GLM becomes free Muse → the Go/paid Muse.
3. **Pause automatically on a refusal.** Where the autopilot sees a free-listing session fail (the quota or fallback path), treat any of these as a free-gateway refusal:
   - a provider error with status 403;
   - a message matching `/abuse|forbidden|model unavailable/i` on a provider-typed error;

   When the failing model is one of the 3 free listings (or any `opencode/*-free`), call `pauseFree(now, 6, '<model>: <short message>')`, then continue with the normal fallback. Extend `containsQuotaError` (or add a sibling check) so this case moves the session on, as 401/429 already do.
4. **At most one free session at a time.** When `launch`, `fresh-session` or `start-prereview`/`doctor` would pick a free listing, first check the tracked sessions in the lead state (`state.ts` / `~/.zilar-lead/state.json`).
   - If another live session (worker, pre-review or doctor) already runs on a free listing, use the paid step from `fallbackModel` instead. With up to 8 workers, that's about 1 in 8 sessions on free.
   - Log the choice in the existing launch line (`T-XXXX auto -> <model>`).
5. **Tests** (cost control, so the money rule applies; keep it to these):
   - `free-pause` parse and the window;
   - `resolveWorkerModel('auto')` while paused;
   - a 403 "Detect Abuse Traffic" on a free listing triggers the pause.

   Add them to the existing test files, or one new `free-pause.test.ts`. Run the single files with `--reporter=dot`.
6. Every file stays at 400 lines or fewer.

### Allowed files
- `packages/devtools/src/lead/free-pause.ts`
- `packages/devtools/src/lead/free-pause.test.ts`
- `packages/devtools/src/lead/model-schedule.ts`
- `packages/devtools/src/lead/model-schedule.test.ts`
- `packages/devtools/src/lead/task-file.ts`
- `packages/devtools/src/lead/fallback.ts`
- `packages/devtools/src/lead/models.ts` (added by the lead for fix round 5)
- `packages/devtools/src/lead/session.ts`
- `packages/devtools/src/lead/decide.ts`
- `packages/devtools/src/lead/autopilot.ts`
- `packages/devtools/src/lead/launch.ts`
- `packages/devtools/src/lead/fresh-session.ts`
- `packages/devtools/src/lead/start-prereview.ts`
- `packages/devtools/src/lead/doctor.ts`
- `packages/devtools/src/lead/state.ts`
- `packages/devtools/src/lead/autopilot/actions.ts` (added by the lead for fix round 3)
- `packages/devtools/src/lead/autopilot/doctor-tick.ts` (added by the lead for fix round 3)
- `packages/devtools/src/lead/launch.test.ts` (added by the lead for fix round 3)
- `packages/devtools/src/lead/cli/commands.ts` (added by the lead for fix round 4)
- `work/T-1942-free-model-guard.md`

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run src/lead/free-pause.test.ts src/lead/model-schedule.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- With `freePausedUntil` in the future, `model: auto` launches, fresh fix rounds and pre-reviews never touch a free listing.
- A 403 or "Detect Abuse Traffic" on a free listing pauses free for 6 h, with one `LEAD: FREE PAUSED` line, and the session moves to the paid step.
- With free not paused, at most one live session runs on a free listing; the rest start on the paid step.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`free-pause.ts` (new, 149 lines):** copied the `go-pause.ts` shape and
  shares its config path (`goPauseConfigPath()`), so `config.json` keeps both
  `goPausedUntil` and `freePausedUntil`.
  - `freePause(now, configPath)` / `isFreePaused(...)`: reads the optional full
    ISO timestamp; paused strictly while `now` is before it; a malformed value
    is ignored with one warning per process.
  - `pauseFree(now, hours, reason, configPath)`: writes `now + hours` as an ISO
    timestamp, keeps every other key, writes through a staging file + rename,
    and prints one `LEAD: FREE PAUSED until <iso> (<reason>)` line.
  - `pauseFreeOnRefusal(now, model, refusal, configPath)`: pauses 6 h only when
    the session's model is a free listing, a refusal text is present, and free
    is not already paused (so a refusal held in the message window does not
    extend the window on every poll).
  - `isFreeListing(model)`: the three known free listings plus any
    `opencode/*-free`.
  - `paidStep(model, goPaused)`: `fallbackModel(model, goPaused, true)`, the
    first step of the chain that costs money.
- **`fallback.ts`:** `fallbackModel(model, goPaused, freePaused = false)`. While
  free is paused the free Muse goes to the Go Muse (or the paid Muse while Go
  is paused) instead of the free GLM Flash.
- **`model-schedule.ts`:** `resolveWorkerModel(..., goPaused, freePaused = false)`;
  `model: auto` while paused resolves to the free DeepSeek Flash's paid step
  (`GO_DEEPSEEK_FLASH`, or `DEEPSEEK_FLASH` while Go is paused), still with
  `effortOverride: 'default'`.
- **`task-file.ts`:** `reviewModel(env, freePaused = false)` returns `GO_MUSE`
  while free is paused (the callers' `withoutPausedGoModel` turns that into the
  paid Muse while Go is paused too). New `reviewSessionModel(state, scope)` is
  the one place pre-review and doctor pick their model: free Muse while free is
  open and no other tracked session holds the free slot, otherwise the paid
  step.
- **`state.ts`:** new `freeSessionInUse(state, scope)` and `FreeSessionScope`.
  It counts a tracked worker, pre-review (no model recorded means it started on
  the free Muse) or doctor whose model is a free listing; `scope.task` /
  `scope.sessionId` let a caller ignore its own session.
- **`session.ts`:** `containsQuotaError` now also treats a 403 (with an
  error/message/code) and `abuse|forbidden|model unavailable` on a
  provider-typed error as a quota failure. New `freeRefusal` in
  `SessionSummary` carries the newest active refusal text (cleared by a later
  assistant/error reply, like quota).
- **`autopilot.ts`:** on each poll, a free-listing worker or pre-review that
  reports `freeRefusal` calls `pauseFreeOnRefusal` (skipped in `--dry-run`), then
  `decide` receives `freePaused`.
- **`decide.ts` / `doctor.ts`:** optional `freePaused` input, passed to every
  `fallbackModel` call, so a paused lead never falls back onto a free listing.
- **`launch.ts` / `fresh-session.ts` / `start-prereview.ts` / `doctor.ts`:**
  before starting on a free listing they check `freeSessionInUse` (and the free
  pause) and take `paidStep` instead. `launch` logs the model that actually
  starts in the existing `T-XXXX auto -> <model>` line. `fresh-session` accepts
  an optional `statePath` (defaults to the live state file) and excludes the
  task's own old session; the pre-review excludes its own task; the doctor
  excludes its previous doctor session.
- **Tests:** new `free-pause.test.ts` (parse/window, malformed value, writer
  keeps other keys and prints once, no re-pause while open, free listing match,
  403 "Detect Abuse Traffic" summary + a `tickOnce` test that pauses 6 h and
  switches the worker to the Go DeepSeek Flash); `model-schedule.test.ts` gained
  the paused `model: auto` case, the Go-paused case, and the free-Muse fallback
  case.

Files changed (all inside Allowed files): `free-pause.ts`, `free-pause.test.ts`,
`model-schedule.ts`, `model-schedule.test.ts`, `task-file.ts`, `fallback.ts`,
`session.ts`, `decide.ts`, `autopilot.ts`, `launch.ts`, `fresh-session.ts`,
`start-prereview.ts`, `doctor.ts`, `state.ts`, and this task file.

### Checks run

- `pnpm --filter @zilar/devtools exec vitest run src/lead/free-pause.test.ts src/lead/model-schedule.test.ts --reporter=dot`
  → `Test Files 2 passed (2)`, `Tests 22 passed (22)`.
- `pnpm --filter @zilar/devtools exec vitest run src/lead/launch.test.ts src/lead/autopilot.test.ts src/lead/session.test.ts src/lead/go-pause.test.ts --reporter=dot --maxWorkers=2`
  → `Test Files 4 passed (4)`, `Tests 18 passed (18)`.
- `pnpm gate` (first two runs stopped at format/lint/typecheck; fixed with
  `prettier --write`, an unused import, and `string | undefined` in
  `FreeSessionScope`). Final run:
  ```
  gate: 15 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (1.6s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/devtools  (13.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Spec step 3 for the doctor is not wired.** The doctor's session summary
  lives in `autopilot/doctor-tick.ts`, which is not in Allowed files, so a 403 on
  the doctor session itself does not pause free. The doctor still *reads* the
  pause (`reviewSessionModel`) and its fallbacks skip free listings; only the
  automatic pause trigger is missing there. Worker and pre-review refusals do
  trigger it.
- **"Live" means "tracked".** `freeSessionInUse` counts every entry in
  `state.json` (the spec's `state.ts` / `state.json`), since liveness would need
  a network round-trip per session from `launch`. Stale records are dropped by
  `lead forget --finished`, as before; counting a stale record only moves more
  sessions to paid, never more onto free.
- **Deviation:** `launch` also applies the one-free-session rule to an explicit
  `model: opencode/*-free` in the task file (not just `model: auto`), because
  the spec says "when launch ... would pick a free listing".
- `reviewModel` keeps its `env` parameter and gains `freePaused`; `ZILAR_REVIEW_MODEL`
  still wins over both pauses (it is not rewritten), as T-0215 intended.
- The `tickOnce` pause check is skipped in `--dry-run`, which keeps dry-run
  read-only; tests set `ZILAR_LEAD_CONFIG` to a temp file.

### Round 1 (paidStep fix)

- **Finding 1 (should-fix, `paidStep`)** — fixed. `paidStep` now falls back to
  the Go Muse (or the paid Muse while Go is paused) for any free listing the
  fallback chain does not model, e.g. `opencode/beam-free`, instead of returning
  `undefined` and letting the caller keep the free model. Added a test in
  `free-pause.test.ts` covering the three known listings and an unmodelled
  `opencode/beam-free` with Go open and paused.
- **Nit 1 (check-then-act one-free-slot check)** — not touched: nits are out of
  scope unless the line already changes.
- **Follow-up (doctor-tick)** — not touched: `autopilot/doctor-tick.ts` is
  outside the Allowed files.
- Single test: `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/free-pause.test.ts`
  → 1 file, 9 tests passed.
- `pnpm gate`: first run failed on format in `free-pause.test.ts`; formatted it
  with Prettier, then:
  ```
  gate: 15 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (0.5s)
  PASS  lint  (0.7s)
  PASS  typecheck  (1.6s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/devtools  (16.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Round 2 (pre-review fixes)

- **Finding 1 (should-fix, config write race):** fixed in
  `free-pause.ts`. `pauseFree` now merges into the newest `config.json`:
  it re-reads the raw file before each rename (restarting if another writer
  changed it) and verifies after the rename that `freePausedUntil` survived; if
  a `goPause`/second lead replaced the file, it merges the pause back into that
  newest contents. Up to five attempts, then one final unchecked merge.
  - Test added: `free-pause.test.ts` → "merges the pause back when another
    process replaces the file after ours" (simulates a `goPause` write landing
    right after `pauseFree`'s rename and asserts both keys survive).
  - Residual: `go-pause.ts` is outside the Allowed files and still writes
    without re-reading, so a `goPause` rename landing in the last
    check-to-rename window of the final attempt can still win; `pauseFree`
    detects and repairs the common order (its key removed after the rename) but
    cannot see a write that happens after its last read.
- **Findings 2 and 3 (follow-ups)** — not touched: they live in
  `autopilot/doctor-tick.ts` and `autopilot/actions.ts`, outside the Allowed
  files.
- **Findings 4, 5 and 6 (nits)** — not touched: out of scope unless the line
  already changes.
- Single test: `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/free-pause.test.ts`
  → 1 file, 10 tests passed.
- `pnpm gate`:
  ```
  gate: 15 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.5s)
  PASS  lint  (0.7s)
  PASS  typecheck  (1.9s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/devtools  (13.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Round 3 (lead's fix round: Go free, should-fix 1, F1, F2, nit 2)

- **Go free models count as free:** `FREE_LISTING` is now
  `/^opencode(-go)?\/.*-free$/`, so `opencode-go/beam-free` and every other
  `opencode-go/*-free` listing counts as free in the slot check, the pause and
  the fallback. Both comments updated. `free-pause.test.ts` adds
  `opencode-go/beam-free` (free) and `opencode-go/deepseek-v4.1-flash` (not
  free) to the listing test.
- **Should-fix 1 (pre-review counts its own task's worker):**
  `startPrereviewSession` now calls `reviewSessionModel(loadState(...))` with
  no task scope, so a worker already on a free listing blocks the pre-review
  from also starting free. `launch` and `fresh-session` still exclude their own
  task/session because they replace that worker.
- **F2 (record the real model):** new `startPrereviewSessionWithModel` and
  `startDoctorSessionWithModel` return `{ sessionId, model }`;
  `autopilot/actions.ts` and `autopilot/doctor-tick.ts` store `model` in the
  new pre-review and doctor records, so `freeSessionInUse` reads the truth
  instead of counting them as free.
  - Deviation: `cli/commands.ts` is outside the Allowed files and calls the
    string-returning `startPrereviewSession`/`startDoctorSession`, so those
    names remain as thin wrappers over the new functions. Consequence: records
    created by the manual `lead prereview` / `lead doctor` commands still omit
    `model` (a follow-up); no file outside Allowed files was edited.
- **F1 (doctor follows the free pause):** `doctor-tick.ts` passes
  `freePaused: isFreePaused(...)` to `decideDoctor` and calls
  `pauseFreeOnRefusal` for the doctor session (outside `--dry-run`) before the
  decisions, like the worker and pre-review paths.
- **Nit 2 (one-free-slot test):** one test added in `launch.test.ts`: state
  seeds another task's worker on `opencode/deepseek-v4.1-flash-free`, and a
  `model: auto` launch starts on `opencode-go/deepseek-v4.1-flash`. The test
  pins `ZILAR_LEAD_CONFIG` to an empty temp file so the live Go/free pauses
  cannot change the expected step.

#### Checks

- `pnpm --filter @zilar/devtools exec vitest run src/lead/free-pause.test.ts src/lead/model-schedule.test.ts src/lead/launch.test.ts --maxWorkers=2 --reporter=dot`
  → 3 files, 27 tests passed.
- While fixing: `free-pause.test.ts` → 10 passed; `launch.test.ts` → 3 passed
  (the new case printed `T-0099 auto -> opencode-go/deepseek-v4.1-flash`).
- `pnpm gate`:
  ```
  gate: 18 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.5s)
  PASS  lint  (0.7s)
  PASS  typecheck  (1.9s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/devtools  (13.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- **Disagreements:** none. Every item was implemented as specified; the only
  deviation is the caller-signature detail in F2 above, forced by the
  Allowed-files rule.

### Round 4 (pre-review findings 1-3)

- **Should-fix 1 (false free pause):** in `session.ts`, a provider error with
  no message and no code no longer defaults its detail to `'Forbidden'`. The
  detail is the message or the code (empty when both are absent), and a refusal
  is reported only when the message or code matches `FREE_REFUSAL` or the
  status is 403. Added one case to `free-pause.test.ts`: a messageless
  `provider.quota` error on `FREE_DEEPSEEK_FLASH` is quota but not a refusal,
  and `pauseFreeOnRefusal` returns false without logging.
- **Follow-up 2 (manual CLI records the model):** `cli/commands.ts` now calls
  the `{ sessionId, model }` returns and stores `model` in both the
  `lead prereview` and the `lead doctor` records. Because `cli/commands.ts` is
  now in Allowed files, the round-3 `startPrereviewSessionWithModel` /
  `startDoctorSessionWithModel` names were folded back into
  `startPrereviewSession` / `startDoctorSession` (both return
  `{ sessionId, model }`); the string-only wrappers had no callers left and
  were removed. This supersedes the Round 3 deviation.
- **Nit 6 (tests keep the developer's env):** `launch.test.ts` saves the prior
  `ZILAR_LEAD_CONFIG` before setting it and restores it (deleting only when it
  was unset); `free-pause.test.ts` saves it once at module load and its
  `afterEach` restores that value instead of deleting.
- **Not touched:** finding 3 (residual `goPause` write race, needs
  `go-pause.ts`) and nits 4-5 (check-then-act slot check, live-state path), as
  the lead's round did not include them.

#### Checks

- `pnpm --filter @zilar/devtools exec vitest run src/lead/free-pause.test.ts src/lead/model-schedule.test.ts src/lead/launch.test.ts --maxWorkers=2 --reporter=dot`
  → 3 files, 28 tests passed.
- While fixing: `free-pause.test.ts + session.test.ts` → 2 files, 18 passed;
  `free-pause.test.ts + launch.test.ts` → 2 files, 14 passed.
- `pnpm gate`:
  ```
  gate: 19 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.4s)
  PASS  lint  (0.8s)
  PASS  typecheck  (1.9s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/devtools  (15.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- **Disagreements:** none.

### Round 5 (pre-review finding 1: unmodelled free fallback)

- **Should-fix 1 (unmodelled free listing never falls back):** `fallbackModel`
  now ends with `isFreeListing(model) ? (goPaused ? PAID_MUSE : GO_MUSE) :
  undefined`, so `opencode/beam-free`, `opencode-go/beam-free` and every other
  unmodelled free listing move to the paid Muse step instead of `undefined`
  (which made `decide` re-send `resume` on the refused listing).
  - Note: the paid target is returned directly rather than through
    `paidStep(...)`, because `paidStep` delegates to `fallbackModel` and calling
    it from the same branch would recurse forever. The value is exactly what
    `paidStep` returns for an unmodelled free listing.
- **Import cycle avoided:** `isFreeListing` and its regex moved to `models.ts`
  (`fallback.ts` imports `models.ts`, and `free-pause.ts` imports
  `fallback.ts`, so importing `free-pause.ts` from `fallback.ts` would cycle).
  `free-pause.ts` re-exports `isFreeListing`, so `state.ts`, `task-file.ts`,
  `launch.ts`, `fresh-session.ts` and the tests keep their imports unchanged.
- Added one case to `free-pause.test.ts`:
  `fallbackModel('opencode-go/beam-free', false, true)` is `GO_MUSE`.
- **Not touched:** finding 2 (residual `goPause` write race, needs
  `go-pause.ts`) and finding 3 (multi-line refusal text, cosmetic nit).

#### Checks

- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/free-pause.test.ts src/lead/model-schedule.test.ts src/lead/launch.test.ts src/lead/go-pause.test.ts`
  → 4 files, 35 tests passed (the extra file covers `fallbackModel`).
- While fixing: `free-pause.test.ts` → 12 passed.
- `pnpm gate`:
  ```
  gate: 20 changed file(s) against main
  PASS  install (frozen)  (3.4s)
  PASS  format  (3.4s)
  PASS  lint  (1.9s)
  PASS  typecheck  (3.1s)
  PASS  effect  (1.1s)
  PASS  tests @zilar/devtools  (17.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- **Disagreements:** none.


## Review (written by Claude)

**Approved and merged after 5 rounds** (2 automatic, 3 from the lead).

**What it does now:**
- **The pause:** a 403, or a refusal whose text matches "abuse", "forbidden" or "model unavailable", on any `opencode/*-free` or `opencode-go/*-free` listing pauses free models for 6 h, logging one `LEAD: FREE PAUSED` line. A bare `provider.quota` with no message no longer counts as a refusal (round 4).
- **During the pause:** `model: auto` launches, fresh rounds, pre-reviews and the doctor skip every free listing. A session on a free listing the chain doesn't know falls to the paid step (round 5).
- **One free session at a time:** pre-reviews count their own task's worker (round 3).
- **Recorded models:** the real model is recorded for pre-review and doctor sessions, including manual CLI starts (rounds 3 and 4).

**Accepted as is:** the last should-fix, that `start-prereview` and `doctor` read the live state file rather than a threaded `statePath`. That only affects tests that run against another state file; in production they are the same file.

**Disclosed and not fixed:** the `goPause`/`pauseFree` write race needs `go-pause.ts` and is pre-existing.

The autopilot is restarted after the merge so it runs this code.
