---
id: T-0302
title: "Mobile kit migration: join link and group handle (visibility sheet) fields use the kit TextField"
status: todo
milestone: M5
branch: task/T-0302-mobile-text-field-5
model: auto
effort: low
depends_on: [T-0300]
estimate: 0.1 day
---

# T-0302: mobile TextField, batch 5

## Spec (written by Claude, do not edit)

### Why
This is batch 5 of moving mobile fields onto the kit `TextField` (`apps/mobile/src/components/ui/text-field.tsx`). T-0300 did the same swap in the create sheets; read its Report in `work/T-0300-mobile-text-field-3.md` first.

### Verified facts (do not re-derive)
- **`TextField`:**
  - a pass-through RN `TextInput` with the well look: `rounded-[10px] border border-border-strong bg-well px-3 py-2 text-[15px] text-foreground`;
  - a default `placeholderTextColor` of `MUTED_FOREGROUND[scheme]`;
  - `className` merged with `cn`.
- **`apps/mobile/src/components/chat/join-link.tsx`:**
  - line 252: a wrapper `View className="mt-3 rounded-[10px] border border-border-strong bg-well px-3 py-2"`;
  - line 253: the "Invite link" `TextInput`, with `placeholderTextColor="#8a8a8a"` and `className="text-[15px] text-foreground"`;
  - line 2 imports `Pressable, TextInput, View`.
- **`apps/mobile/src/components/chat/visibility-sheet.tsx`:**
  - line 185: a wrapper `View className="mt-1 …bg-well px-3 py-2"`;
  - line 186: the "Group handle" `TextInput` (`editable={!busy}`, `maxLength={32}`), with `#8a8a8a` and `text-[15px] text-foreground`;
  - line 2 imports `Modal, Pressable, TextInput, View`.
- **Tests that import these files:**
  - `apps/mobile/src/components/chat/join-link.test.tsx`;
  - `apps/mobile/src/components/settings/settings-ui.test.tsx`, which already mocks `nativewind`;
  - `apps/mobile/src/components/chat/new-chat-button.test.tsx`, which already mocks `nativewind`;
  - `apps/mobile/src/components/chat/visibility-sheet.test.ts`;
  - `apps/mobile/src/components/chat/new-channel-sheet.test.tsx`;
  - `apps/mobile/src/components/chat/visibility-fields.test.tsx`.
  - Change them only to add mocks, if the `TextField` import needs them (`nativewind`; see the pitfall in `docs/LEAD_HANDOFF.md`).

### What to build
1. Both fields become `TextField`:
   - remove the wrapper `View`s, and move their margins (`mt-3` and `mt-1`) to `className`;
   - keep every other prop, and remove the `#8a8a8a` and the text classes;
   - remove `TextInput` from the `react-native` imports.
2. **Tests:** existing tests keep passing. Change the listed test files only to add mocks.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the mobile test mocks pitfall), `apps/mobile/src/components/ui/text-field.tsx`, `work/T-0300-mobile-text-field-3.md` (Report), the two files and their tests.

### Allowed files
`apps/mobile/src/components/chat/join-link.tsx`, `apps/mobile/src/components/chat/visibility-sheet.tsx`, `apps/mobile/src/components/chat/join-link.test.tsx` (mocks only), `apps/mobile/src/components/settings/settings-ui.test.tsx` (mocks only), `apps/mobile/src/components/chat/new-chat-button.test.tsx` (mocks only), `apps/mobile/src/components/chat/visibility-sheet.test.ts` (mocks only), `apps/mobile/src/components/chat/new-channel-sheet.test.tsx` (mocks only), `apps/mobile/src/components/chat/visibility-fields.test.tsx` (mocks only), `work/T-0302-mobile-text-field-5.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot join-link visibility settings-ui new-chat-button new-channel-sheet
pnpm gate
```

### Acceptance
- Both fields render through `TextField`, and neither source file contains `#8a8a8a` or a raw `<TextInput`.
- Spacing, labels and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
