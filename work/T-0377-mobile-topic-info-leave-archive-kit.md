---
id: T-0377
title: "Mobile kit: the topic info sheet's Leave and Archive buttons use the kit Button; New topic Create is disabled while the name is empty"
status: todo
milestone: M5
branch: task/T-0377-mobile-topic-info-leave-archive-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0377: topic info Leave/Archive on the kit, New topic Create guard

## Spec (written by Claude, do not edit)

### Why
Emulator QA run 29 (2026-10-06) found two things:
- The topic info sheet's Archive button is red with dark text, because it uses `text-accent-foreground` on `bg-danger`. Leave next to it is still a raw `Pressable`.
- New topic's Create looks enabled with an empty name, while New channel's Create is disabled until a name is typed.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/button.tsx`:**
  - variants `default`, `destructive` (`bg-destructive …`; its text variant is `text-white`, line 65), `outline`, `secondary` and `ghost`;
  - sizes `default`, `sm`, `lg` and `icon`.
  - **Labels must be inside `<Text>`.** A bare string renders a blank pill (the T-0349 bug).
- **`apps/mobile/src/components/chat/topic-sheets.tsx`:**
  - `Button` and `Text` are imported at lines 8-9.
  - In `TopicInfoSheet` (line 131), lines 409-417: a raw `Pressable` with `accessibilityLabel="Leave topic"`, `disabled={busy}`, `onPress={onLeave}`, `className="rounded-[10px] px-4 py-2 active:bg-surface-raised disabled:opacity-50"` and `<Text className="text-[15px] text-foreground">Leave</Text>`.
  - Lines 420-430: a raw `Pressable` with `accessibilityLabel="Archive topic"`, `disabled={busy}`, `onPress={onArchive}`, `className="rounded-[10px] bg-danger px-4 py-2 …"` and `<Text className="text-[15px] font-semibold text-accent-foreground">{busy ? 'Working…' : 'Archive'}</Text>`.
- **`apps/mobile/src/components/chat/new-topic-sheet.tsx`:**
  - line 80: `create()` trims `name` and sets `localError` 'Enter a topic name' when it is empty;
  - line 258: `<Button accessibilityLabel="Create topic" disabled={busy} onPress={create}>`.
  - `new-channel-sheet.tsx:53` uses `const canCreate = trimmed !== '' && !tooLong && !busy;` for comparison.
- **Tests:**
  - `apps/mobile/src/components/chat/new-topic-sheet.test.tsx:182-194` calls the Create button's `props.onPress` directly with an empty name and expects `onCreate` not to be called. Keep the `create()` guard so this stays true.
  - `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx` and `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx` render these sheets.

### What to build
1. **Leave** → `<Button variant="ghost" accessibilityLabel="Leave topic" disabled={busy} onPress={onLeave}><Text>Leave</Text></Button>`.
2. **Archive** → `<Button variant="destructive" accessibilityLabel="Archive topic" disabled={busy} onPress={onArchive}><Text>{busy ? 'Working…' : 'Archive'}</Text></Button>`. The kit gives it white text.
3. **New topic Create:** `disabled={busy || name.trim() === ''}`. Keep the guard inside `create()`.
4. If a test that renders these sheets now fails on `Button`, add mocks only (`Platform.select`, reanimated `useReducedMotion`, `TextClassContext` in the `@/components/ui/text` mock, the `@/lib/depth` key exports, `@/components/ui/use-key-press`). Change no assertion.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/button.tsx`, `apps/mobile/src/components/chat/topic-sheets.tsx:400-435` and `apps/mobile/src/components/chat/new-topic-sheet.tsx:75-95` and `:250-262`.

### Allowed files
`apps/mobile/src/components/chat/topic-sheets.tsx`, `apps/mobile/src/components/chat/new-topic-sheet.tsx`, `apps/mobile/src/components/chat/new-topic-sheet.test.tsx`, `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx`, `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx`, `work/T-0377-mobile-topic-info-leave-archive-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot new-topic-sheet topic-sheets-roles topic-actions-sheet
pnpm gate
```

### Acceptance
- Leave and Archive are kit `Button`s with their labels inside `<Text>`.
- New topic Create is disabled while the trimmed name is empty.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
