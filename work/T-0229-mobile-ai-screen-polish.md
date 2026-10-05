---
id: T-0229
title: "Mobile: AI screen layout fixes found on the emulator (routine rows, Activity header, tool sheet bottom padding)"
status: planned
milestone: M5
branch: task/T-0229-mobile-ai-screen-polish
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0219]
estimate: 0.2 day
---

# T-0229: AI screen polish

## Spec (written by Claude, do not edit)

### Why
First emulator QA of the Edit AI screen (mock build, 2026-10-05) found these layout problems. Screenshots seen by the lead.

### Verified facts (do not re-derive)
1. Routine row squeeze: `apps/mobile/src/components/ais/routines-section.tsx` lines 129-195. The text column (`min-w-0 flex-1`, line 131) and the buttons share one `flex-row flex-wrap` row (line 130). With Delete → Delete + Cancel (lines 167-181) there are three buttons, and the text column shrinks to about 11 characters, so the title wraps and the detail runs to about 14 lines.
2. Activity header: `apps/mobile/src/components/ais/ai-activity.tsx` lines 140-155. The heading is `text-[14px] font-medium` (line 143), while Tools and Routines use `px-2 text-[13px] font-semibold text-muted-foreground` (`tools-section.tsx` line 141, `routines-section.tsx` line 327). `<RefreshCw size={16} />` (line 151) has no color, so it renders dark grey on black. The app colors icons with `ICON[scheme]` (`@/lib/colors`), with `scheme = asColorScheme(useColorScheme().colorScheme)` (`@/lib/color-scheme`; see `apps/mobile/src/components/chat/composer.tsx` lines 17-18, 89, 109).
3. Tool sheet bottom: `apps/mobile/src/components/ais/tool-detail-sheet.tsx` line 726: `<ScrollView className="flex-1 py-2" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>`. Padding on the ScrollView's `style` does not pad the scrolled content, so the last "Show all" button sits under the Android gesture bar.
4. Version history date cut: same file, around line 298 (the `<Text numberOfLines={1}>` just above it): the hosts · author · date line has `numberOfLines={1}`, so the date ends in "…".

### What to build
1. Routine row: put the text block on its own full-width line and the action buttons on a row under it, right-aligned (`flex-row justify-end gap-2`). Same for the normal and the confirm state. Keep the accessibility labels and the busy texts unchanged.
2. Activity header: use the Tools/Routines heading style; give `RefreshCw` the `ICON[scheme]` color.
3. Tool sheet: move the bottom padding into `contentContainerStyle` (`{ paddingBottom: Math.max(insets.bottom, 16) + 16 }`).
4. Version row detail line: `numberOfLines={2}`.
5. Tests: in `apps/mobile/src/components/ais/routines-section.test.tsx` assert the confirm state still renders `Confirm deleting <title>` and Cancel (adjust only if structure-based queries break); in `apps/mobile/src/components/ais/ai-activity.test.tsx` keep `Refresh activity` working. No snapshot tests.

### Read first
`AGENTS.md`, the four places above.

### Allowed files
`apps/mobile/src/components/ais/routines-section.tsx`, `apps/mobile/src/components/ais/routines-section.test.tsx`, `apps/mobile/src/components/ais/ai-activity.tsx`, `apps/mobile/src/components/ais/ai-activity.test.tsx`, `apps/mobile/src/components/ais/tool-detail-sheet.tsx`, `work/T-0229-mobile-ai-screen-polish.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot routines-section ai-activity tool-detail-sheet
pnpm gate
```

### Acceptance
- The four fixes above; no text or label changes; no emoji; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Line numbers that scroll away with the source (minor), mock data texts.

---

## Report (written by the worker when done)

## Review (written by Claude)
