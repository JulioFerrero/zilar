---
id: T-0219
title: "Mobile: Run now, Revert and Delete in the tool detail sheet"
status: merged
milestone: M5
branch: task/T-0219-mobile-tool-writes
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0218]
estimate: 0.5 day
---

# T-0219: Tool writes on the phone

## Spec (written by Claude, do not edit)

### Why
Second half of `docs/audit/mobile-parity-gaps.md` 7.1 "T-0189b" (lines 1024-1041). T-0218 added a read-only tool detail sheet; web's `ToolDetailPanel` also lets the AI owner run a tool now, revert to an older version and delete the tool.

### What the person sees (inside the T-0218 sheet; the AI screen is owner-only, so the actions always show)
- **Version history:** each row that is not the current version gets a `Revert to this version` outline button (small, right side, label `Revert to v<N>`). Tapping it replaces the row's button area with an inline confirm: `Revert to v<N>? This creates a new version copying that version's code.` plus `Cancel` and `Revert` (`Reverting…` while busy). Success reloads the sheet (new current version on top). Failure: `Could not revert the tool. Try again.` under the history (403/404: `You may not change this tool.`).
- **Run now** section (between history and Recent runs): heading `Run now`; label `Optional JSON input (max 4 KB)`; a multiline mono `TextInput` (3 lines, placeholder `e.g. {"city": "Madrid"}`, accessibility label `Run input (JSON)`); button `Run now` / `Running…` (disabled while running). Client checks before the request, same as web: invalid JSON → `Input must be valid JSON.`; more than 4096 bytes (UTF-8 length of the trimmed text) → `Input must be at most 4 KB.`; empty input sends no `input`.
  - Ok result: `Ok in <ms> ms · <n> fetch(es)` (muted; `fetch` when 1) and the output text cut with `truncateOutput` (`Show all` / `Show less`).
  - Failed result (`ok: false`): `Failed: <error.kind>` (danger) and the error message plus logs, cut the same way. These come from the tool's own run, not from the server's error envelope, so they may show (web shows them too).
  - Request errors: 429 → `Too many runs. Try again in a minute.`; 403/404 → `You may not run this tool.`; 501 → `Tools cannot run on this server yet.`; anything else → `Could not run the tool. Try again.`
  - After an ok request (either result) the Recent runs list refreshes; a failed refresh keeps the old list silently.
- **Delete tool** at the bottom: destructive button `Delete tool`; inline confirm `Delete <name>? This deletes the tool and its routines. This cannot be undone.` with `Cancel` and `Delete` (`Deleting…`). Success closes the sheet and removes the row from the Tools list. Failure: `Could not delete the tool. Try again.` (403/404: `You may not change this tool.`).
- Never show the server's error message text.

### Verified facts (do not re-derive)
- Web: `apps/web/src/components/tools/ToolDetailPanel.tsx`: `MAX_RUN_INPUT_BYTES = 4 * 1024` (line 23); `revert` (lines 132-145); `run` with JSON parse, byte check, refresh of runs (lines 147-185); Run now section (lines 304-335); `RunResultBlock` (lines 396-422); `DeleteToolButton` (lines 424-481); confirm texts (lines 377-385, 470-477).
- Web client `apps/web/src/lib/tools.ts`: `toolRunResultSchema` (lines 72-87: `{ ok: true, output: { text, data? }, logs, durationMs, fetchCount }` or `{ ok: false, error: { kind, message }, logs, durationMs, fetchCount }`); `revertTool` POST `/tools/:id/revert` body `{ version }` answers a `ToolVersion` (lines 180-186); `runToolNow` POST `/tools/:id/run` body `{}` or `{ input }` (lines 193-199); `deleteTool` DELETE `/tools/:id` (204) (lines 201-203).
- Server `apps/server/src/tools/routes.ts`: revert (line 180, 404 for non-managers), delete (line 223, idempotent 204), run (line 252: 404 non-manager, 429 `rate_limited` line 264, 501 `runner_unavailable`).
- Mobile API `apps/mobile/src/lib/tools-api.ts`: `ToolDetailsApi` (line 100), `RoutineActionsApi` (line 111), `AiToolsApi = ToolsApi & RoutineActionsApi & ToolDetailsApi` (line 118); `createToolsApi` reads at lines 454-484; `deleteRoutine` (line 486) shows how a 204 DELETE is done without parsing.
- Mobile sheet `apps/mobile/src/components/ais/tool-detail-sheet.tsx` (T-0218): `ToolDetailBodyState` and `ToolDetailBodyActions` (lines 22-42), `ToolDetailBody` (line 90; version history block lines 179-204), `ToolDetailSheet({ api: ToolDetailsApi, toolId, onClose })` (line 235), `ToolDetailLoader` with `reloadTick` (lines 261-386).
- Mobile section `apps/mobile/src/components/ais/tools-section.tsx`: `openId` (line 120), `setState` on load (line 128), `<ToolDetailSheet api={api} toolId={openId} onClose={() => setOpenId(null)} />` (line 147).
- Mock: `apps/mobile/src/mock/tools.ts` `getTool` (line 218), `getToolVersion` (235), `listToolRuns` (246).
- `truncateOutput` in `apps/mobile/src/lib/routines-format.ts` line 131. A multiline `TextInput` example: `apps/mobile/src/components/chat/new-group-sheet.tsx` line 195.

### What to build
1. `tools-api.ts`: `ToolRunResult` type and guard; a new `ToolActionsApi { revertTool(id, version): Promise<ToolVersion>; runToolNow(id, input?: unknown): Promise<ToolRunResult>; deleteTool(id): Promise<void> }`; `AiToolsApi` adds `ToolActionsApi`; implement in `createToolsApi` (`content-type: application/json` on the two POSTs).
2. `mock/tools.ts`: the three writes. Revert appends a new version (copy of the chosen source and hosts, message `Revert to v<N>`) and bumps `currentVersion`; run returns ok output for `tool-1` and `{ ok: false, error: { kind: 'timeout', message: 'The tool took too long.' } }` for `tool-2`, and appends a run; delete removes the tool (later reads answer 404).
3. New `apps/mobile/src/components/ais/tool-actions.ts`: pure `parseRunInput(text)` → `{ ok: true, input?: unknown } | { ok: false, message }` (4096-byte limit, use `new TextEncoder().encode(trimmed).length`), `runErrorMessage(error)`, `changeErrorMessage(error, fallback)` with the sentences above, `fetchCountText(n)`.
4. `tool-detail-sheet.tsx`: the Revert, Run now and Delete UI above; one action at a time (a ref guard like `runningRef` in `apps/mobile/src/components/ais/routines-section.tsx`); new prop `onDeleted(toolId)`. Keep `ToolDetailBody` hook-free: the new state and callbacks go through `ToolDetailBodyState` / `ToolDetailBodyActions`. The sheet's `api` prop becomes `ToolDetailsApi & ToolActionsApi`.
5. `tools-section.tsx`: pass `onDeleted` that closes the sheet and removes the tool from `state.tools`.
6. Tests (Vitest): `apps/mobile/src/lib/tools-api.test.ts` (the three writes: method, path, body, bearer, run result both shapes, bad result → `invalid_response`, 429 keeps status and code); new `apps/mobile/src/components/ais/tool-actions.test.ts` (empty, invalid JSON, exactly 4096 and 4097 bytes with a multi-byte character, each error sentence incl. 429/403/404/501/other, `fetch`/`fetches`); `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx` (body: revert button only on non-current rows, revert confirm text, Run now section with the input error, ok and failed result blocks, `Running…`, delete confirm text, busy labels); `apps/mobile/src/components/ais/tools-section.test.tsx` (a pure helper that removes a deleted tool from the list, if you add one).

### Read first
`AGENTS.md`, `apps/web/src/components/tools/ToolDetailPanel.tsx` (lines 132-185 and 304-481), `apps/mobile/src/components/ais/tool-detail-sheet.tsx`, `apps/mobile/src/lib/tools-api.ts` (lines 90-120 and 440-500), `apps/mobile/src/mock/tools.ts` (lines 200-260), `apps/mobile/src/components/ais/tools-section.tsx`, `apps/mobile/src/components/ais/routines-section.tsx` (two-step delete and `runningRef`).

### Allowed files
`apps/mobile/src/lib/tools-api.ts`, `apps/mobile/src/lib/tools-api.test.ts`, `apps/mobile/src/mock/tools.ts`, `apps/mobile/src/components/ais/tool-actions.ts` (new), `apps/mobile/src/components/ais/tool-actions.test.ts` (new), `apps/mobile/src/components/ais/tool-detail-sheet.tsx`, `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx`, `apps/mobile/src/components/ais/tools-section.tsx`, `apps/mobile/src/components/ais/tools-section.test.tsx`, `work/T-0219-mobile-tool-writes.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot tools-api tool-actions tool-detail-sheet tools-section
pnpm gate
```

### Acceptance
- In the sheet: revert with an inline confirm, Run now with the 4 KB JSON check and both result shapes, delete with an inline confirm that closes the sheet and drops the row; every request error is a fixed sentence.
- No server, web or package change; no new dependency; no emoji; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Editing a tool's code, host approval, group and topic tools, the dim-backdrop close.

---

## Report (written by the worker when done)

### What I did
Implemented Run now, Revert and Delete in the mobile tool detail sheet (T-0218 sheet), mirroring web's `ToolDetailPanel`:
- `apps/mobile/src/lib/tools-api.ts`: added `ToolRunResult` type + `parseToolRunResult` guard, `ToolActionsApi` (`revertTool`, `runToolNow`, `deleteTool`), widened `AiToolsApi`, implemented the three calls in `createToolsApi` (POSTs with `content-type: application/json`; 204 DELETE without parsing, like `deleteRoutine`).
- `apps/mobile/src/mock/tools.ts`: added the three writes on per-instance closure copies (versions/sources/runs copied into the closure so one instance's writes don't leak into other instances' reads); revert appends `Revert to v<N>` and bumps `currentVersion`; run returns ok output for `tool-1` and `{ ok: false, timeout }` for `tool-2` and appends a run; delete removes the tool (later reads 404).
- New `apps/mobile/src/components/ais/tool-actions.ts`: pure `parseRunInput` (4096 UTF-8 bytes via `TextEncoder`), `runErrorMessage` (429/403+404/501/other), `changeErrorMessage(error, fallback)`, `fetchCountText`.
- `tool-detail-sheet.tsx`: revert buttons on non-current rows with inline confirm (`Revert to v<N>? This creates a new version copying that version's code.` + Cancel/Revert/Reverting…), Run now section (label, 3-line mono TextInput, Run now/Running…, both result shapes with `truncateOutput` + Show all/less, fixed request-error lines, silent failed runs-refresh), Delete tool with inline confirm that calls `onDeleted`. One action at a time via `actionRef` (like `runningRef`); new `onDeleted(toolId)` prop; `api` prop is now `ToolDetailsApi & ToolActionsApi`. `ToolDetailBody` stays hook-free (new state via `ToolDetailBodyState`, callbacks via `ToolDetailBodyActions`).
- `tools-section.tsx`: passes `onDeleted` (closes sheet + removes row via new pure `withoutTool` helper).
- Tests: extended `tools-api.test.ts` (revert method/path/body/bearer, run both shapes + empty-input `{}`, bad result → `invalid_response`, 429 keeps status+code, delete 204); new `tool-actions.test.ts` (empty/invalid JSON, exactly-4096 vs 4097 bytes incl. multi-byte `é`, every error sentence, fetch/fetches); extended `tool-detail-sheet.test.tsx` (revert buttons only on non-current rows, confirm text, Run now section, input error, ok + failed blocks, Running…/Reverting…/Deleting…, delete confirm text); `tools-section.test.tsx` (`withoutTool` keeps others).

### Files changed
`apps/mobile/src/lib/tools-api.ts`, `apps/mobile/src/lib/tools-api.test.ts`, `apps/mobile/src/mock/tools.ts`, `apps/mobile/src/components/ais/tool-actions.ts` (new), `apps/mobile/src/components/ais/tool-actions.test.ts` (new), `apps/mobile/src/components/ais/tool-detail-sheet.tsx`, `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx`, `apps/mobile/src/components/ais/tools-section.tsx`, `apps/mobile/src/components/ais/tools-section.test.tsx`.

### Commands and real results
- `pnpm install`: ok (18.3s).
- Single tests while working: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/tools-api.test.ts src/components/ais/tool-actions.test.ts src/components/ais/tool-detail-sheet.test.tsx src/components/ais/tools-section.test.tsx` → 4 files, 67 tests, all passed (fixed along the way: added `TextInput` to the sheet test's react-native mock; fixed an `&apos;` vs `&#x27;` assertion).
- `pnpm gate` (final): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/mobile`, `scope: every changed file is inside the Allowed files`, `GATE PASS`. (Fixed along the way: prettier on 4 files; restored dropped `ToolDetailsApi` import; tuple-index typing in one test.)

### Problems / deviations
- Spec's Run now order is history → Run now → Recent runs; I kept Recent runs in place and inserted Run now between history and Recent runs, matching the spec.
- Spec's revert button label is `Revert to v<N>`; web shows `Revert to this version` with aria-label `Revert to v<N>`. I used visible text `Revert to v<N>` with the same accessibility label (spec describes the mobile label as `Revert to v<N>`).
- Mock: deviated slightly from a literal "appends a version" on the shared arrays — copied versions/sources/runs into the `createMockToolsApi` closure so one instance's revert/run/delete doesn't pollute other instances (existing `tools`/`routines` were already closure-local; `TOOL_VERSIONS`/`TOOL_SOURCES`/`TOOL_RUNS` were module-shared). Behavior from the caller's view is exactly as specced.
- No new dependency, no server/web change, no emoji, no server error text in UI (the failed-run kind/message shown is the tool's own output, which the spec explicitly allows).

### Blocked / needs a decision
None.

### Security checklist
- No secrets/tokens in logs, errors or code.
- Deletes scoped by encoded tool id in the path.
- No caps/uniqueness logic added; no permissions logic (sheet is owner-only per spec); no new routes; no audit entries; failed-run output shown is the tool's own data, allowed by the spec.

### Lead round 1
- `tool-detail-sheet.tsx`: added `busyAny` (`actionBusy || runBusy || deleteBusy`); every action button (Revert/Revert-confirm/Cancel, Run now, Delete/Delete-confirm/Cancel) now uses it, so a Run tap during a revert is visibly disabled instead of silently swallowed by `actionRef`. New test: with a revert busy, `Run now` and `Delete tool` render disabled.
- `mock/tools.ts` `deleteTool`: also removes the tool's versions, sources and runs; `getTool`, `listToolVersions`, `getToolVersion` and `listToolRuns` then answer 404. New test in `tools-api.test.ts` via `createMockToolsApi()` asserting all four reject with status 404 after deleting `tool-1`.
- `pnpm-lock.yaml`: reverted the uncommitted `bufferutil`/`utf-8-validate` change with `git checkout -- pnpm-lock.yaml`; not committed.
- Checks: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot tools-api tool-actions tool-detail-sheet tools-section` → 4 files, 69 tests, all passed. `pnpm gate` → `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/mobile`, scope inside Allowed files, `GATE PASS`. (Fixed along the way: prettier collapse of one Button block; `children` in the new test's button props type for typecheck.)

### Fix round (PREREVIEW findings)
- Finding 1 (should-fix, mock run-id reuse): `mock/tools.ts` `runToolNow` used `runs.length + 1` for the new id, so a delete that shrank `runs` caused id reuse and duplicate React keys. Now a per-instance closure counter `nextMockRunId` (seeded from the initial run count) only increments. New test in `tools-api.test.ts`: run tool-2 twice, delete tool-1, run tool-2 twice more → `listToolRuns('tool-2')` returns 4 runs with 4 distinct ids.
- Finding 2 (nit, JSON TextInput autocorrect): `tool-detail-sheet.tsx` Run-now `TextInput` now sets `autoCapitalize="none"` and `autoCorrect={false}`, so iOS can't mangle typed JSON into `Input must be valid JSON.`. New test in `tool-detail-sheet.test.tsx` walks the `ToolDetailBody` tree and asserts the run input's `autoCapitalize === 'none'` and `autoCorrect === false` (asserted on element props because `renderToStaticMarkup` drops `autoCorrect={false}` and lowercases `autoCapitalize`).
- Disagreements: none — both findings were correct.
- Single tests: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/tools-api.test.ts src/components/ais/tool-actions.test.ts src/components/ais/tool-detail-sheet.test.tsx src/components/ais/tools-section.test.tsx` → 4 files, 71 tests, all passed. `pnpm gate` (final) → `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/mobile`, scope inside Allowed files, `GATE PASS`. (Fixed along the way: prettier line-wrap of the new test's props type; added `children` to that props type for typecheck.)

## Review (written by Claude)

**Verdict:** Approved after lead round 1 (every action disabled while one runs; mock delete drops versions and sources) and one auto round (mock run ids, run input without autocapitalize). Final packet clean, one nit (a stale JSON error stays until the next Run tap), left as is. Emulator QA of the actions runs in parallel in the Sonnet QA subagent on a mock build; any finding goes to the polish task T-0229.
