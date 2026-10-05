---
id: T-0230
title: "Mobile: tool sheet keyboard (Run tapped on the first tap, input not covered) and the Tools list refreshes after the sheet closes"
status: planned
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

## Review (written by Claude)
