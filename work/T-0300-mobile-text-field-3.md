---
id: T-0300
title: "Mobile kit migration: new channel, new group, new topic and handle fields use the kit TextField"
status: todo
milestone: M5
branch: task/T-0300-mobile-text-field-3
model: auto
effort: low
depends_on: [T-0297]
estimate: 0.2 day
---

# T-0300: mobile TextField, batch 3

## Spec (written by Claude, do not edit)

### Why
This is batch 3 of moving mobile fields onto the kit `TextField` (`apps/mobile/src/components/ui/text-field.tsx`). It handles the create sheets, which use the same well-wrapper pattern that T-0297 removed from `invite-links-sheet.tsx`. Read `work/T-0297-mobile-text-field-2.md` (Report) first.

### Verified facts (do not re-derive)
- **`TextField`:**
  - a pass-through RN `TextInput` with the well look: `rounded-[10px] border border-border-strong bg-well px-3 py-2 text-[15px] text-foreground`;
  - a default `placeholderTextColor` of `MUTED_FOREGROUND[scheme]`;
  - `className` merged with `cn`, and `textAlignVertical: 'top'` for `multiline`.
- **Every field below:**
  - sits inside a `View className="mt-… rounded-[10px] border border-border-strong bg-well px-3 py-2"` wrapper;
  - has `placeholderTextColor="#8a8a8a"` and `className="text-[15px] text-foreground"`.
- **The fields:**
  - `apps/mobile/src/components/chat/new-channel-sheet.tsx` line 76, "Channel name" (wrapper `mt-3`);
  - `apps/mobile/src/components/chat/new-channel-sheet.tsx` line 88, "Channel description", `multiline` (wrapper `mt-2`);
  - `apps/mobile/src/components/chat/new-group-sheet.tsx` line 248, "Group name", `autoFocus` (wrapper `mt-3`);
  - `apps/mobile/src/components/chat/new-topic-sheet.tsx` line 115, "Topic name" (wrapper `mt-1`);
  - `apps/mobile/src/components/chat/visibility-fields.tsx` line 85, "Group handle" (wrapper `mt-1`).
- **Tests that import these files.** Change them only to add mocks, if the `TextField` import needs them; see the pitfall in `docs/LEAD_HANDOFF.md`:
  - `apps/mobile/src/components/chat/new-channel-sheet.test.tsx`;
  - `apps/mobile/src/components/chat/new-group-sheet.test.tsx`;
  - `apps/mobile/src/components/chat/visibility-fields.test.tsx`;
  - `apps/mobile/src/components/chat/new-chat-button.test.tsx`;
  - `apps/mobile/src/components/nav/floating-tab-bar.test.tsx`;
  - `apps/mobile/src/components/profile/profile-view.test.tsx`.

### What to build
1. Each of the five fields becomes `TextField`:
   - remove the wrapper `View`, and move its margin (`mt-3`, `mt-2` or `mt-1`) to the field's `className`;
   - keep every other prop (`value`, handlers, `accessibilityLabel`, `autoCapitalize`, `autoCorrect`, `autoFocus`, `maxLength`, `placeholder`, `multiline`);
   - remove the `#8a8a8a` and the hand-written text classes;
   - remove `TextInput` from a file's `react-native` import when it is no longer used there.
2. **Tests:** existing tests keep passing. Change the listed test files only to add mocks.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the mobile test mocks pitfall), `apps/mobile/src/components/ui/text-field.tsx`, `work/T-0297-mobile-text-field-2.md` (Report), the four files and their tests.

### Allowed files
`apps/mobile/src/components/chat/new-channel-sheet.tsx`, `apps/mobile/src/components/chat/new-group-sheet.tsx`, `apps/mobile/src/components/chat/new-topic-sheet.tsx`, `apps/mobile/src/components/chat/visibility-fields.tsx`, `apps/mobile/src/components/chat/new-channel-sheet.test.tsx` (mocks only), `apps/mobile/src/components/chat/new-group-sheet.test.tsx` (mocks only), `apps/mobile/src/components/chat/visibility-fields.test.tsx` (mocks only), `apps/mobile/src/components/chat/new-chat-button.test.tsx` (mocks only), `apps/mobile/src/components/nav/floating-tab-bar.test.tsx` (mocks only), `apps/mobile/src/components/profile/profile-view.test.tsx` (mocks only), `work/T-0300-mobile-text-field-3.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot new-channel-sheet new-group-sheet visibility-fields new-chat-button floating-tab-bar profile-view
pnpm gate
```

### Acceptance
- The five fields render through `TextField`, and none of the four source files contains `#8a8a8a` or a raw `<TextInput` any more.
- Spacing, labels and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
`apps/mobile/src/components/chat/invite-links-sheet.tsx` (T-0299 is changing it now).

---

## Report (written by the worker when done)

## Review (written by Claude)
