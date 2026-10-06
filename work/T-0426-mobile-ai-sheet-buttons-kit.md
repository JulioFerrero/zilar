---
id: T-0426
title: "Mobile kit: the AI activity Refresh key, the tool sheet Show all/less toggles and Close tool use the kit buttons"
status: todo
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

## Review (written by Claude)
