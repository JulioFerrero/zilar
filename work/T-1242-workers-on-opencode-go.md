---
id: T-1242
title: "Lead tooling: `model: auto` workers run on the OpenCode Go subscription's DeepSeek Flash at all hours; when Go hits its limit or fails, the session falls back in place to the DeepSeek API (deepseek/deepseek-flash), then to the paid Muse as today"
status: merged
milestone: M5
branch: task/T-1242-workers-on-opencode-go
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1242: Workers on OpenCode Go first

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-12: "opencode go is renewed, we can use that instead of the paid deepseek api, and if opencode go finish, use the deepseek api".

Today:
- `model: auto` resolves in `resolveWorkerModel` (`packages/devtools/src/lead/model-schedule.ts:23-34`): the free Muse in DeepSeek's peak hours, and `deepseek/deepseek-flash` (the paid DeepSeek API, `packages/devtools/src/lead/models.ts:5`) otherwise. The peak rule exists only because the API doubles its price then (`model-schedule.ts:5-8`).
- **On a failure,** `fallbackModel` (`packages/devtools/src/lead/fallback.ts:5-8`) switches the free Muse or DeepSeek Flash in place to the paid Muse. Its callers are in `packages/devtools/src/lead/decide.ts` and `doctor.ts`.
- **OpenCode Go** is a provider in `~/.config/opencode/opencode.json` (`opencode-go`); it's a flat subscription, so peak hours don't matter for it.

### What to build
1. **Find the exact OpenCode Go model id for DeepSeek Flash.** Don't guess: list OpenCode 2's providers and models from its API or CLI (the lead uses `opencode2 api …` for `session.switchModel`, so look for the matching provider or model listing call), and paste the command and the relevant output lines in the Report. If Go offers no DeepSeek Flash, stop and write in Blocked which Go models exist.
2. **`models.ts`:** add `GO_DEEPSEEK_FLASH = '<that id>'`.
3. **`model-schedule.ts`:** `model: auto` resolves to `GO_DEEPSEEK_FLASH` with `effortOverride: 'default'` at **every hour**. Keep `isDeepSeekPeak` exported, since other code may use it (grep for it). Update the comment block (`:5-8`) to say why.
4. **`fallback.ts`:** the chain is Go DeepSeek Flash → `DEEPSEEK_FLASH` (the API) → `PAID_MUSE`. The free Muse still goes to `PAID_MUSE`.
   - Check that the code which decides *when* to fall back (rate limit, quota exhausted or outage: find it in `decide.ts` / the autopilot, and cite it) also catches Go's "limit reached" error. Find its real text or status from OpenCode's source or docs under `node_modules`, or from a past session log if one exists. If you can't confirm the text, match a 429 and any error containing "limit" or "quota", and say so in the Report.
5. **`lead watch` / `status`** show the model from state, so `lead switch-model`'s in-place switch keeps working. Grep for `DEEPSEEK_FLASH` and make sure every place that treats "DeepSeek" specially (labels, the `effortOverride`) also handles the Go id.
6. **Tests:** update the existing devtools tests that pin the old schedule or fallback (grep for `resolveWorkerModel` / `fallbackModel` in `src/lead/*.test.ts`). Add 2 cases: `auto` at a peak hour gives the Go model, and the fallback of the Go model is the DeepSeek API.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/models.ts`, `packages/devtools/src/lead/model-schedule.ts`, `packages/devtools/src/lead/fallback.ts`, `packages/devtools/src/lead/decide.ts` and `docs/LEAD_HANDOFF.md` (the model section).

### Allowed files
`packages/devtools/src/lead/**`, `docs/LEAD_HANDOFF.md`, `work/T-1242-workers-on-opencode-go.md`.

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run src/lead --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- **The lead's check:** the next `lead launch` of a `model: auto` task shows the Go model in `lead status`.

---

## Report (written by the worker when done)

Status: done, ready for review. `pnpm gate` ends with `GATE PASS` and lists no files outside the Allowed files.

### What I did

1. **Found the Go model id (spec 1).** Ran the `model.list` operation of the OpenCode 2 CLI (the same CLI `client.ts` uses for `session.switchModel`):

   ```bash
   pnpm exec opencode2 api model.list > "$TMP/models.json"
   node -e "… filter providerID==='opencode-go' and echo providerID|id|family|name …"
   ```

   Relevant output lines (paid API vs Go):

   ```
   deepseek    | deepseek-flash    | deepseek-flash | DeepSeek V4.1 Flash
   opencode-go | deepseek-v4.1-flash | deepseek-flash | DeepSeek V4.1 Flash
   ```

   The metered API model (`deepseek/deepseek-flash`) is "DeepSeek V4.1 Flash", family `deepseek-flash`. OpenCode Go's listing with the **same name and family** is `opencode-go/deepseek-v4.1-flash`, so that is the exact Go id. Go also has `opencode-go/deepseek-v4-flash` ("DeepSeek V4 Flash") and `opencode-go/deepseek-v4-flash-vision-exp`, which I did not use because they are a different model from the API's V4.1 Flash. (Go also lists `opencode-go/deepseek-v4-pro`, which stays banned by `assertNotV4Pro`; we never pick it.)

2. **`models.ts`:** added `GO_DEEPSEEK_FLASH = 'opencode-go/deepseek-v4.1-flash'` and a comment tying it to `DEEPSEEK_FLASH`.

3. **`model-schedule.ts`:** `resolveWorkerModel('auto', now)` now returns `{ model: GO_DEEPSEEK_FLASH, effortOverride: 'default' }` at every hour; the `now` parameter is kept (callers still pass it) but unused, so it was renamed `_now`. `isDeepSeekPeak` is still exported (only `launch.ts` used it, and that use is gone now — see below). The comment block `:5-8` was rewritten to say Go is flat-rate, so peak pricing no longer matters.

4. **`fallback.ts`:** chain is now Go Flash → `DEEPSEEK_FLASH` → `PAID_MUSE`; the free Muse still goes straight to `PAID_MUSE`:
   ```ts
   if (model === GO_DEEPSEEK_FLASH) return DEEPSEEK_FLASH;
   return model === FREE_MUSE || model === DEEPSEEK_FLASH ? PAID_MUSE : undefined;
   ```
   Each quota error applies one step of the chain, so the existing "in place" logic in `decide.ts` (`fallbackModel(record.model)` at lines 192/208/251/264) walks it.

5. **When the lead falls back (spec 4).** The decision is in `decide.ts` (`decide`, quota branches) fed by `session.ts` `summarizeSession` (`quotaError`), which is computed by `containsQuotaError`. I checked OpenCode's own error classification in the OpenCode 2 CLI binary (`~/.nvm/.../lib/node_modules/@opencode/cli/bin/opencode.exe`, `opencode v2.0.25`):
   - error codes treated as a quota failure: `insufficient_quota`, `usage_not_included`, `billing_error`, **`gousagelimiterror`**, `freeusagelimiterror`, `creditlimitexceeded`;
   - a message regex for quota: `insufficient[-_\s]?(?:quota|balance)|quota[-_\s]?exceeded|budget exceeded|usage limit|limit exhausted|package has expired|plan does not yet include`;
   - a `402`, those codes, or `429 && <that regex>` are all mapped to `QuotaExceeded`, which the CLI then surfaces as `provider.quota`.

   So **Go's "limit reached" (`GoUsageLimitError`) becomes `provider.quota`**, which the lead already caught. I could not find a past Go session in `~/.zilar-lead/lead.log` (only the `LEAD: QUOTA … provider quota` escalation line, no raw Go payload), so per the spec I also broadened `containsQuotaError` to catch `provider.rate-limit`, a `429` status, and a `limit`/`quota` message on a **provider-typed** object. The text check only inspects objects whose `type` starts with `provider.`, so ordinary assistant/tool text that mentions "limit" cannot flip the flag (covered by a test).

6. **Labels (spec 5).** `decide.ts` `label()` now maps `GO_DEEPSEEK_FLASH -> 'Go DeepSeek flash'`, `DEEPSEEK_FLASH -> 'DeepSeek flash (API)'`, `PAID_MUSE -> 'paid Muse'`, and the `FALLBACK` escalation now names the real target (`… worker continues on ${label(to)}`) instead of always saying "paid Muse". `record.model` keeps the resolved Go id, so `lead status` / `lead watch` / `lead switch-model --in-place` keep working; `modelBadge` shows the bare `deepseek-v4.1-flash` for the Go id (unchanged path).
   `launch.ts` printed `(peak|off-peak)` after the model, which is now meaningless; it prints `${task} auto -> ${resolved.model}` and no longer imports `isDeepSeekPeak`.
   `fresh-session.ts`'s comment about peak-hour re-resolution was rewritten (behaviour unchanged).

7. **Docs:** updated the `model: auto` bullet in `docs/LEAD_HANDOFF.md` (line 42) to the Go-first chain.

8. **Tests (spec 6).** There were **no** existing devtools tests pinning the schedule or fallback (`packages/devtools/src/lead` had only `merge.test.ts`), so I added two files:
   - `model-schedule.test.ts`: `auto` at a peak hour gives the Go model; `auto` off-peak gives the same Go model; explicit model untouched; `fallbackModel(GO)` = `DEEPSEEK_FLASH`; `fallbackModel(DEEPSEEK_FLASH)` = `PAID_MUSE`; `fallbackModel(FREE_MUSE)` = `PAID_MUSE`; no fallback for paid Muse/unknown.
   - `session.test.ts`: quota detection for `provider.quota`, Go's `gousagelimiterror`, `provider.rate-limit`, a bare 429, plus guards that ordinary "limit" text does not flag and an old quota error clears after a normal reply.

### Files changed (all inside Allowed files)

- `packages/devtools/src/lead/models.ts`, `model-schedule.ts`, `fallback.ts`, `decide.ts`, `launch.ts`, `fresh-session.ts`, `session.ts`
- `packages/devtools/src/lead/model-schedule.test.ts` (new), `session.test.ts` (new)
- `docs/LEAD_HANDOFF.md`
- `work/T-1242-workers-on-opencode-go.md`

### Commands and real results

- `pnpm install` — done, no changes (16.9s).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/model-schedule.test.ts src/lead/session.test.ts` — `Test Files 2 passed (2)`, `Tests 12 passed (12)`.
- `pnpm --filter @zilar/devtools exec vitest run src/lead --reporter=dot` (task Checks) — `Test Files 3 passed (3)`, `Tests 29 passed (29)`.
- `pnpm gate` (first run) — `FAIL format` (`[warn] packages/devtools/src/lead/decide.ts`); fixed with `pnpm exec prettier --write packages/devtools/src/lead/decide.ts`.
- `pnpm gate` (final) — summary lines:
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (2.1s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/devtools  (9.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Deviations / notes

- I edited `session.ts` (`containsQuotaError`) in addition to the files the spec named. The spec's step 4 asks the detection to catch Go's limit and, if the exact text can't be confirmed, to match a 429 and "limit"/"quota". I confirmed OpenCode maps Go's limit to `provider.quota`, then added the extra 429/`provider.rate-limit`/text coverage as a belt-and-braces measure. All within Allowed files.
- I did not touch `data/*` state or `switch-model.ts`; the in-place switch reads `record.model`, which already carries the Go id.

### Acceptance

- The Checks pass and the gate is green.
- The lead's live check (next `lead launch` of a `model: auto` task shows `opencode-go/deepseek-v4.1-flash` in `lead status`) is for the lead; I did not run a real worker launch.

## Round 1 (fix round after pre-review)

Findings fixed: 1 should-fix — #1 (the in-place fallback dropped the resolved `effort: default` variant). Nits #2 (no positive test for the provider-text quota branch) and #3 (stale "peak-hour resolution" comments) were left as-is: nit #2 is not on a line this round changes, and nit #3's two comment lines were not touched either.

- New `resolveWorkerVariant(frontMatterModel, taskEffort, now)` in `model-schedule.ts` returns the variant `launch` resolves (`effortOverride ?? effort`), so `model: auto` keeps `default`.
- `autopilot.ts` (the worker `fallback-model` branch) and `switch-model.ts` (`switchModelInPlace`) now switch with that resolved variant instead of the raw task effort. The finding named the autopilot path; `switchModelInPlace` is the other in-place switch and had the identical pattern, so it got the same fix.
- Test added: `packages/devtools/src/lead/autopilot.test.ts` drives `tickOnce` for a `model: auto`, `effort: low` task that ended on a provider quota error, and asserts the worker is switched to `deepseek/deepseek-flash#default` (not `#low`). Confirmed it fails before the fix (actual `variant: "low"`).

Commands:

- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/autopilot.test.ts` — 1 file passed, 1 test passed.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/autopilot.test.ts src/lead/model-schedule.test.ts` — 2 files passed, 8 tests passed.
- `pnpm gate` — summary:
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.4s)
  PASS  lint  (0.7s)
  PASS  typecheck  (1.8s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/devtools  (14.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Disagreements

None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 1 auto round (2 nits).**
- **The change:**
  - `model: auto` resolves to `opencode-go/deepseek-v4.1-flash` at all hours. The id comes from OpenCode's own model listing (same name and family as `deepseek/deepseek-flash`);
  - the fallback walks Go → `deepseek/deepseek-flash` (API) → `meta/muse-spark-1.3-contributor`, one step per quota error, keeping the `default` effort;
  - Go's `GoUsageLimitError` maps to `provider.quota`, which `decide.ts` already treats as a quota error;
  - labels name the real target, and `launch` no longer prints peak or off-peak.
- **Tests:** `model-schedule.test.ts` and `session.test.ts`.
- **After merge:** the lead restarts the autopilot so it loads the new fallback chain. The next `lead launch` of a `model: auto` task should show the Go id in `lead status`.
