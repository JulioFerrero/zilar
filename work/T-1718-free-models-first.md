---
id: T-1718
title: "Free OpenCode models first (Julio 2026-10-16): model auto starts workers on opencode/deepseek-v4.1-flash-free, then Go DeepSeek, then the metered DeepSeek API; pre-reviews and the doctor go free Muse → opencode/glm-5.3-flash-free → Go Muse → paid Muse; one shared model label helper"
status: merged
milestone: M5
branch: task/T-1718-free-models-first
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1718: Free models before paid ones

## Spec (written by Claude, do not edit)

### Why
OpenCode now offers DeepSeek V4.1 Flash and GLM 5.3 Flash for free. `opencode2 models` lists `opencode/deepseek-v4.1-flash-free` and `opencode/glm-5.3-flash-free` (the lead checked on 2026-10-16). Today:
- the workers ran on the **metered** DeepSeek API;
- almost every pre-review fell back from the free Muse straight to the **paid** Muse ("LEAD: FALLBACK T-17xx pre-review continues on paid Muse"), because Go is paused (T-1421).

Julio chose on 2026-10-16: free first, paid last.

### Facts (the lead read them on 2026-10-16)
- **`packages/devtools/src/lead/models.ts`** (13 lines) has `FREE_MUSE`, `PAID_MUSE`, `DEEPSEEK_FLASH` (`deepseek/deepseek-flash`, metered), `GO_DEEPSEEK_FLASH` (`opencode-go/deepseek-v4.1-flash`) and `GO_MUSE`.
- **`packages/devtools/src/lead/model-schedule.ts:30-39`:** `resolveWorkerModel('auto', now, goPaused)` returns `GO_DEEPSEEK_FLASH`, or `DEEPSEEK_FLASH` while Go is paused, always with `effortOverride: 'default'`.
- **`packages/devtools/src/lead/fallback.ts:13-21`:** `fallbackModel(model, goPaused)` maps:
  - `GO_DEEPSEEK_FLASH` → `DEEPSEEK_FLASH`;
  - `DEEPSEEK_FLASH` or `FREE_MUSE` → `goPaused ? PAID_MUSE : GO_MUSE`;
  - `GO_MUSE` → `PAID_MUSE`;
  - anything else → `undefined`.
- **The labels in escalation lines** are a local `label()` in `packages/devtools/src/lead/decide.ts:121-138` (used at `:142` and `:231`), while `packages/devtools/src/lead/doctor.ts:212` hard-codes `fallback === PAID_MUSE ? 'paid Muse' : 'Go Muse'`.
- **The pre-review starts on `PREREVIEW_MODEL`** (the free Muse, `packages/devtools/src/lead/start-prereview.ts:12`). Keep that.
- **Tests that pin the chain:** `packages/devtools/src/lead/model-schedule.test.ts`, `packages/devtools/src/lead/go-pause.test.ts` and `packages/devtools/src/lead/autopilot.test.ts`.

### Steps
1. **`models.ts`:**
   - add `FREE_DEEPSEEK_FLASH = 'opencode/deepseek-v4.1-flash-free'` and `FREE_GLM_FLASH = 'opencode/glm-5.3-flash-free'`, with a comment (T-1718, free on OpenCode);
   - add an exported `modelLabel(model)` that returns `free DeepSeek flash`, `Go DeepSeek flash`, `DeepSeek flash (API)`, `free Muse`, `free GLM flash`, `Go Muse` or `paid Muse`, else the raw id.
2. **`model-schedule.ts`:** `auto` always resolves to `FREE_DEEPSEEK_FLASH` with `effortOverride: 'default'`, whether or not Go is paused. Update the comment.
3. **`fallback.ts`:** the chains become:
   - workers: `FREE_DEEPSEEK_FLASH` → (`goPaused ? DEEPSEEK_FLASH : GO_DEEPSEEK_FLASH`); `GO_DEEPSEEK_FLASH` → `DEEPSEEK_FLASH`; `DEEPSEEK_FLASH` → (`goPaused ? PAID_MUSE : GO_MUSE`);
   - reviews and the doctor: `FREE_MUSE` → `FREE_GLM_FLASH`; `FREE_GLM_FLASH` → (`goPaused ? PAID_MUSE : GO_MUSE`);
   - `GO_MUSE` → `PAID_MUSE`.

   Update the comment.
4. **`decide.ts` and `doctor.ts`:** use `modelLabel` instead of the local `label()` and the hard-coded doctor text.
5. **Tests:** update the expectations in the three test files to the new chain, and add cases for `FREE_DEEPSEEK_FLASH` and `FREE_GLM_FLASH` in the `fallbackModel`/`resolveWorkerModel` tests.
6. **Check the effort:** confirm the free DeepSeek listing accepts the `default` variant, the same way the Go listing does (look at how launch passes the variant). If it doesn't, say so in the Report instead of guessing.

### Allowed files
- `packages/devtools/src/lead/models.ts`
- `packages/devtools/src/lead/model-schedule.ts`
- `packages/devtools/src/lead/fallback.ts`
- `packages/devtools/src/lead/decide.ts`
- `packages/devtools/src/lead/doctor.ts`
- `packages/devtools/src/lead/model-schedule.test.ts`
- `packages/devtools/src/lead/go-pause.test.ts`
- `packages/devtools/src/lead/autopilot.test.ts`
- `work/T-1718-free-models-first.md`

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run src/lead/model-schedule.test.ts src/lead/go-pause.test.ts src/lead/autopilot.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A `model: auto` worker starts on the free DeepSeek Flash.**
- **A pre-review that hits the free Muse's limit** continues on the free GLM Flash before any Go or paid Muse.
- **The escalation lines name the new models.**
- **The tests pass.**

---

## Report (written by the worker when done)

### What I did
- **`packages/devtools/src/lead/models.ts`** — added `FREE_DEEPSEEK_FLASH = 'opencode/deepseek-v4.1-flash-free'` and `FREE_GLM_FLASH = 'opencode/glm-5.3-flash-free'` (with a T-1718 comment), and a shared `modelLabel(model)` returning `free DeepSeek flash`, `Go DeepSeek flash`, `DeepSeek flash (API)`, `free Muse`, `free GLM flash`, `Go Muse`, `paid Muse`, else the raw id. Refreshed the now-stale comments on `DEEPSEEK_FLASH` and `GO_DEEPSEEK_FLASH`.
- **`packages/devtools/src/lead/model-schedule.ts`** — `resolveWorkerModel('auto', …)` now always returns `FREE_DEEPSEEK_FLASH` with `effortOverride: 'default'`, whether or not Go is paused; the `goPaused` parameter is kept for callers but unused (`_goPaused`). Updated the header comment.
- **`packages/devtools/src/lead/fallback.ts`** — new chains: `FREE_DEEPSEEK_FLASH → (paused ? DEEPSEEK_FLASH : GO_DEEPSEEK_FLASH)`; `GO_DEEPSEEK_FLASH → DEEPSEEK_FLASH`; `DEEPSEEK_FLASH → (paused ? PAID_MUSE : GO_MUSE)`; `FREE_MUSE → FREE_GLM_FLASH`; `FREE_GLM_FLASH → (paused ? PAID_MUSE : GO_MUSE)`; `GO_MUSE → PAID_MUSE`. Updated the comment.
- **`packages/devtools/src/lead/decide.ts`** — dropped the local `label()` and use `modelLabel` at both call sites; trimmed the now-unused constant imports.
- **`packages/devtools/src/lead/doctor.ts`** — replaced the hard-coded `fallback === PAID_MUSE ? 'paid Muse' : 'Go Muse'` with `modelLabel(fallback)`; dropped the unused `PAID_MUSE` import; updated the comment.
- **Tests** — `model-schedule.test.ts`: auto → `FREE_DEEPSEEK_FLASH` at peak and off-peak, full new `fallbackModel` chain incl. `FREE_DEEPSEEK_FLASH` and `FREE_GLM_FLASH`, plus a `modelLabel` case. `go-pause.test.ts`: auto stays on `FREE_DEEPSEEK_FLASH` while paused; paused chain updated (`FREE_MUSE → FREE_GLM_FLASH → PAID_MUSE`, `FREE_DEEPSEEK_FLASH → DEEPSEEK_FLASH`). `autopilot.test.ts`: kept on `GO_DEEPSEEK_FLASH` (see Notes).

### Checks run
- Single tests: `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/model-schedule.test.ts src/lead/go-pause.test.ts src/lead/autopilot.test.ts` → **Test Files 3 passed (3), Tests 18 passed (18)**. The run printed the new line `LEAD: FALLBACK T-9001 Go DeepSeek flash failed or rate-limited, worker continues on DeepSeek flash (API)`.
- `pnpm gate` (repo root) → **GATE PASS**, 9 changed files against main. Summary lines:
  ```
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.2s)
  PASS  lint  (1.6s)
  PASS  typecheck  (2.5s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/devtools  (16.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  A first gate run failed on `format` only (two files); `prettier --write` fixed them and the rerun passed.

### Notes for the lead
- **Step 6, the `default` variant.** I checked the OpenCode catalog (the `models` tool). The free listings expose `variants: [low, high, max]` — `opencode/deepseek-v4.1-flash-free` and `opencode/glm-5.3-flash-free` — and so does the Go listing the code already targets, `opencode-go/deepseek-v4.1-flash` (`[low, high, max]`). None of them lists `default`. In other words the free DeepSeek listing has exactly the same variant set as the Go listing, so it accepts `default` in the same way the Go one does (T-1242 already passes `default` there). I could not observe a live session to confirm beyond that equivalence, and per the spec I did not change `default`. The Muse listings both show `[minimal, low, medium, high, xhigh]`.
- **`autopilot.test.ts` choice.** The tick reads `goPaused` from the live `go-pause` config (`autopilot.ts:128`, `isGoPaused(new Date(now))`), which on this machine is currently paused, so a free→Go step there is not deterministic. I kept that one test on the goPaused-independent `GO_DEEPSEEK_FLASH → DEEPSEEK_FLASH` step (still part of the new chain) so it stays stable; it still proves the resolved variant (`default`) is kept.
- **Signature kept.** `resolveWorkerModel`'s third parameter is now unused (`_goPaused`); `launch.ts`, `fresh-session.ts`, `switch-model.ts` and `autopilot/actions.ts` still pass it, so no caller changed. Nothing outside the Allowed files was touched.

## Review (written by Claude)

**Approved and merged.** Julio chose "free first, paid last" on 2026-10-16.

- **Pre-review:** clean, plus 2 nits and 1 follow-up, all accepted:
  - a stale comment in `fresh-session.ts`;
  - the autopilot test seeds on the Go step;
  - two functions named `modelLabel`.
- **The chain now:**
  - `auto` workers: free DeepSeek, then Go DeepSeek (or straight to the API while Go is paused), then the metered DeepSeek API, then Go Muse or paid Muse;
  - reviews and the doctor: free Muse, then free GLM, then Go Muse or paid Muse.
- **Variants:** the worker checked that the free listings expose the same variants as the Go listing that already takes `default`.
- **The autopilot process** loads its code at start, so it picks up the new chain only after a restart. The lead restarts it after the push.

