---
id: T-0426
title: "Mobile kit: the AI activity Refresh key, the tool sheet Show all/less toggles and Close tool use the kit buttons"
status: merged
milestone: M5
branch: task/T-0426-mobile-ai-sheet-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0426: AI sheet buttons on the kit (mobile)

## Spec (written by Claude, do not edit)

### Why
This is batch 22 of `docs/audit/ui-kit-leftovers.md`. Two kinds of row stay raw:
- the version row "Show source of v{n}" (`tool-detail-sheet.tsx:295`), which is a content row;
- the topic-sheets rows (lines 337 and 381), which T-0422 just touched and can wait.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/button.tsx`:**
  - variants `ghost` and others; sizes `sm` and `icon`;
  - `cn` merges `className`;
  - labels MUST be inside `<Text>`.
  - Both files below import `Button` (`ai-activity.tsx:7`, `tool-detail-sheet.tsx:7`).
- **`apps/mobile/src/components/ais/ai-activity.tsx:151-158`:** `Pressable` "Refresh activity", `onPress={onRefresh}`, class `mr-2 size-7 items-center justify-center rounded-full`, with `<RefreshCw size={16} color={ICON[scheme]} />`.
- **`apps/mobile/src/components/ais/tool-detail-sheet.tsx`:**
  - lines ~114, ~155 and ~178: three `Pressable`s with label `expanded ? 'Show less' : 'Show all'`, `onPress={onToggleOutput}` or `onPress={onToggle}`, no class, and child `<Text className="text-[13px] text-foreground">{expanded ? 'Show less' : 'Show all'}</Text>`;
  - lines ~728-735: `Pressable` "Close tool", `onPress={onClose}`, class `p-2 active:bg-list-hover`, with `<X size={20} color={MUTED_FOREGROUND[scheme]} />`.
- **Tests:**
  - `apps/mobile/src/components/ais/ai-activity.test.tsx`;
  - `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx`.

### What to build
1. **Refresh:** `<Button variant="ghost" size="icon" className="mr-2 h-7 w-7 rounded-full" accessibilityLabel="Refresh activity" onPress={onRefresh}>` with the same icon.
2. **Show all/less (three places):** `<Button variant="ghost" size="sm" className="h-7 self-start px-0" accessibilityLabel=… onPress=…>` with the same `<Text>`.
3. **Close tool:** `<Button variant="ghost" size="icon" className="h-9 w-9" accessibilityLabel="Close tool" onPress={onClose}>` with the same icon.
4. Drop `Pressable` from an import only when it becomes unused. Change no assertion. Add mocks only if needed. If a test outside the Allowed files breaks through an import, stop and report BLOCKED with the file name.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/button.tsx`, `apps/mobile/src/components/ais/ai-activity.tsx:140-165`, `apps/mobile/src/components/ais/tool-detail-sheet.tsx:105-190` and `:715-740`, and the two tests.

### Allowed files
`apps/mobile/src/components/ais/ai-activity.tsx`, `apps/mobile/src/components/ais/tool-detail-sheet.tsx`, `apps/mobile/src/components/ais/ai-activity.test.tsx`, `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx`, `work/T-0426-mobile-ai-sheet-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot ai-activity tool-detail-sheet
pnpm gate
```

### Acceptance
- The five controls are kit Buttons with their labels inside `<Text>`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Converted the five raw `Pressable` controls named in the spec to kit `Button`s, no changes to tests or assertions:

1. **Refresh activity** (`ai-activity.tsx`): `Button variant="ghost" size="icon"` with `className="mr-2 h-7 w-7 rounded-full"`, `accessibilityLabel="Refresh activity"`, `onPress={onRefresh}`, same `<RefreshCw size={16} color={ICON[scheme]} />` icon. `Pressable` became unused in this file, so it was dropped from the `react-native` import (`View` kept).
2. **Show all/less** (`tool-detail-sheet.tsx`, three places: run row output, failed run result, ok run result): `Button variant="ghost" size="sm"` with `className="h-7 self-start px-0"`, `accessibilityLabel={expanded ? 'Show less' : 'Show all'}`, `onPress={onToggleOutput}` / `onPress={onToggle}`, unchanged `<Text className="text-[13px] text-foreground">` child. Pressable's `accessibilityRole="button"` was dropped per the spec template (`Button` sets `role="button"` itself); the label stays inside `<Text>`.
3. **Close tool** (`tool-detail-sheet.tsx`): `Button variant="ghost" size="icon"` with `className="h-9 w-9"`, `accessibilityLabel="Close tool"`, `onPress={onClose}`, same `<X size={20} color={MUTED_FOREGROUND[scheme]} />` icon.
4. `Pressable` is still used by the version source row in `tool-detail-sheet.tsx` (the content row excluded by the spec), so its import stays. No test files needed changes; no mocks were added.

### Files changed
- `apps/mobile/src/components/ais/ai-activity.tsx`
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx`
- `work/T-0426-mobile-ai-sheet-buttons-kit.md` (status + report)

No files outside the Allowed files were touched.

### Commands and results
- `pnpm install`: done in 13.7s (only the pre-existing `@types/react-dom` / `@types/react` peer warning).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot ai-activity tool-detail-sheet`: **2 test files passed, 40 tests passed**, 1.44s. (The stderr in the output is the usual React-DOM-server casing/prop notices from the string-mocked native components, not failures.)
- `pnpm gate` (repo root), summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (3.7s)
  PASS  format  (28.2s)
  PASS  lint  (1.1s)
  PASS  typecheck  (9.3s)
  PASS  tests @zilar/mobile  (4.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- None. All five controls are kit Buttons with their labels inside `<Text>`, and no assertion was changed.

### Open questions
- None.

## Review (written by Claude)

Approved (lead, 2026-10-06). These five controls are now kit Buttons: Refresh activity and Close tool (ghost icon), and the three Show all/less toggles (ghost sm, px-0). Pressable is dropped from the ai-activity import, and no assertion changed. The pre-review was clean (0/0/0/0).
