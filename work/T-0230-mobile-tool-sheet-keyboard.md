---
id: T-0230
title: "Mobile: tool sheet keyboard (Run tapped on the first tap, input not covered) and the Tools list refreshes after the sheet closes"
status: merged
milestone: M5
branch: task/T-0230-mobile-tool-sheet-keyboard
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0229]
estimate: 0.2 day
---

# T-0230: Tool sheet keyboard and list refresh

## Spec (written by Claude, do not edit)

### Why
Emulator QA run 2 (mock build, 2026-10-05) of T-0219, screenshots seen by the lead:
1. With the run-input keyboard open, the first tap on "Run now" only dismisses the keyboard (seen three times); a second tap runs.
2. The keyboard covers the input and the Run button; the sheet does not move up.
3. After "Revert to v1" (creates v4) and closing the sheet with X, the Tools list still shows "Morning briefing v3".

### Verified facts (do not re-derive)
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx`: `ToolDetailSheet` (lines 470-500) renders a `Modal` (`presentationStyle="pageSheet"`) with a `View` and `ToolDetailLoader`; the vertical `ScrollView` is at line 726 (no `keyboardShouldPersistTaps`); `revert` (lines 602-615) calls `api.revertTool` then bumps the sheet's own `reloadTick`. Lines checked on main after T-0229 merged.
- `apps/mobile/src/components/ais/tools-section.tsx` lines 121-167: `ToolsSection` reloads its list when `reloadTick` changes (effect at lines 130-145); the sheet gets `onClose={() => setOpenId(null)}` and `onDeleted` (removes the tool locally). Nothing reloads the list after a run or a revert.
- Pattern in the app: `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` (`apps/mobile/src/app/ais/[id].tsx` line 225). Inside a `Modal`, Android does not resize for the keyboard, so the sheet needs `'height'` on Android.

### What to build
1. The sheet's vertical `ScrollView`: `keyboardShouldPersistTaps="handled"` (a tap on Run while the keyboard is open runs at once).
2. Wrap the Modal's content `View` in `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}` and `className="flex-1"`.
3. `tools-section.tsx`: closing the sheet reloads the list: `onClose={() => { setOpenId(null); setReloadTick((tick) => tick + 1); }}`. Keep `onDeleted` as is.
4. Tests: `apps/mobile/src/components/ais/tools-section.test.tsx`: closing the sheet calls the list loader again (count calls on the fake api); `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx`: the vertical ScrollView has `keyboardShouldPersistTaps="handled"`.

### Read first
`AGENTS.md`, the two files above.

### Allowed files
`apps/mobile/src/components/ais/tool-detail-sheet.tsx`, `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx`, `apps/mobile/src/components/ais/tools-section.tsx`, `apps/mobile/src/components/ais/tools-section.test.tsx`, `work/T-0230-mobile-tool-sheet-keyboard.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot tool-detail-sheet tools-section
pnpm gate
```

### Acceptance
- The three points above; no text changes; no new dependency; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. The lead checks it on the emulator.

### Out of scope
The stale JSON error (accepted nit), any other layout.

---

## Report (written by the worker when done)

Done. All three spec points are implemented; no text changes; no new dependency.

What changed:
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx`
  - Vertical `ScrollView` now uses `keyboardShouldPersistTaps={SHEET_SCROLL_TAPS_PERSIST}` where `SHEET_SCROLL_TAPS_PERSIST = 'handled'` (exported const, point 1). Exported as a const (rather than asserting on the JSX tree) because `ToolDetailLoader` is not exported and the sheet's own `ScrollView` only exists inside its render — confirmed by dumping the rendered element tree (only `Modal > KeyboardAvoidingView > View > ToolDetailLoader` is visible without mounting effects).
  - Modal content `View` wrapped in `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}` and `className="flex-1"` (point 2).
- `apps/mobile/src/components/ais/tools-section.tsx`
  - Sheet `onClose` now goes through new exported pure helper `closeDetailSheet(setOpenId, bump)`, which sets `openId` to null and bumps `reloadTick` so the list reloads after a run or revert (point 3). `onDeleted` kept as is.
- Tests: `tool-detail-sheet.test.tsx` asserts `SHEET_SCROLL_TAPS_PERSIST === 'handled'`; `tools-section.test.tsx` has a new `closeDetailSheet` case asserting the sheet closes and the list loader (`listAiTools`) is called again on a counting fake api.

Checks (real results):
- `pnpm install`: done, 25s.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/ais/tool-detail-sheet.test.tsx src/components/ais/tools-section.test.tsx`: 2 files passed, 37 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot tool-detail-sheet tools-section` (spec Checks line): 2 files passed, 37 tests passed.
- `pnpm --filter @zilar/mobile typecheck`: pass (no output).
- `pnpm gate` (from repo root):
  - `gate: 5 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/mobile`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
  - Note: first gate run failed on `format` (prettier wanted the long react-native import split); fixed with `pnpm exec prettier --write` on the four allowed files, then gate passed.

Deviations: none from the three spec points. One structural choice: the persisted-taps value and the close-and-reload behavior are exposed as tiny exported pure const/helper so the tests can cover them without mounting effects (`renderToStaticMarkup` never runs `useEffect`, and the repo has no react-test-renderer/testing-library for stateful renders).

Security checklist: no secrets/tokens touched; no deletes/updates scoping changes; no caps/uniqueness logic; no permission changes; no new routes; no audit entries. N/A beyond that.

Blocked / needs a decision: nothing.

## Round (fix round, 2026-10-05)

Fixed both should-fix findings (must-fix=0, nit untouched — finding 3's
horizontal ScrollView is out of scope per the spec, and it is not on a line
this round changed):

- Finding 1 (`tool-detail-sheet.test.tsx` asserted the exported const, not
  the ScrollView prop): the `react-native` ScrollView mock now captures the
  props passed to the vertical ScrollView, and the test renders the real
  `ToolDetailSheet` via `renderToStaticMarkup` and asserts the captured
  `keyboardShouldPersistTaps === 'handled'` plus the prop in the markup.
  Verified regression-sensitive: dropping the prop from the JSX fails the
  test (1 failed, 22 passed); restored, 23 passed.
- Finding 2 (`tools-section.test.tsx` drove the `closeDetailSheet` helper
  with a stub instead of the wired `onClose`): the sheet mock now captures
  the actual `onClose` prop `ToolsSection` passes, and a new test asserts
  the captured closure is the close-and-reload expression
  (`closeDetailSheet(setOpenId, () => setReloadTick(...))`), plus the helper
  itself nulls the id and bumps the tick (direct call, no unawaited loader).
  Verified regression-sensitive: reverting `onClose` to
  `() => setOpenId(null)` fails the new test; restored, 15 passed.

Tests added/adjusted: 1 strengthened (`keeps Run taps...` now asserts the
real ScrollView prop), 1 new (`wires the sheet onClose through
closeDetailSheet so the list reloads`), 1 simplified (helper case now counts
tick bumps directly).

Checks (real results):
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/ais/tool-detail-sheet.test.tsx src/components/ais/tools-section.test.tsx`: 2 files passed, 38 tests passed.
- `pnpm exec tsc --noEmit -p apps/mobile`: pass (no output).
- `pnpm gate` (from repo root): 5 changed files against main; PASS install (frozen), PASS format, PASS lint, PASS typecheck, PASS tests @zilar/mobile; scope: every changed file is inside the Allowed files; GATE PASS.

Disagreements: none — both findings were correct.

Security checklist: test-only changes; no secrets, scoping, caps, permissions, routes, or audit entries touched.

Cleanup (lead request, 2026-10-05): the worktree had 31 uncommitted changes
under `packages/devtools/` and `work/T-0209-lead-watch-terminal.md` left
over from my regression-sensitivity check (a stash pop restored the wrong
side). Ran `git checkout -- packages/devtools
work/T-0209-lead-watch-terminal.md`; `git status --short` output after that
was empty (no lines printed). Nothing committed; task commits untouched;
`status: review` kept.

## Review (written by Claude)

**Verdict:** Approved after one auto round. Read the diff: `keyboardShouldPersistTaps="handled"` on the sheet ScrollView, `KeyboardAvoidingView` (`padding` on iOS, `height` on Android) around the Modal content, and the Tools list reloads when the sheet closes. The worker had left 31 stray old-version files from its regression check uncommitted in the worktree; the lead had it restore them (`git status` clean before merge). Emulator check comes with the next QA run.
