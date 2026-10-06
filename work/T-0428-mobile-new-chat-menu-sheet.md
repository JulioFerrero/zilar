---
id: T-0428
title: "Mobile kit: the New chat menu (New channel, New group, New message, Explore, Join with a link) uses the kit ActionSheet with icons"
status: todo
milestone: M5
branch: task/T-0428-mobile-new-chat-menu-sheet
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0428: New chat menu on the kit ActionSheet (mobile)

## Spec (written by Claude, do not edit)

### Why
This is batch 23 of `docs/audit/ui-kit-leftovers.md`, the `new-chat-button.tsx` part. The FAB's New chat menu is a hand-rolled modal. The kit already has `ActionSheet`, which the AI and message menus use.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/action-sheet.tsx`:**
  - `ActionSheet({ visible, onClose, closeLabel, header?, title?, children, error? })` (props at lines 12-24) draws the Modal, the backdrop, the card and the dividers;
  - `ActionSheetItem({ label, accessibilityLabel?, onPress, disabled?, icon?: LucideIcon, destructive?, inset? })` (lines 88-138).
  - Usage example: `apps/mobile/src/components/ais/ai-actions-sheet.tsx:43-72`.
- **`apps/mobile/src/components/chat/new-chat-button.tsx`:**
  - lines ~170-230 are a `<Modal visible={menuOpen} …>` with a backdrop `Pressable` "Close new chat menu" and five `Pressable` rows (role `menuitem`). Each row: its label, its accessibilityLabel and its onPress:
    - "New channel": `openDialog('channel')`;
    - "New group": `openDialog('group')`;
    - "New message": `openDialog('message')`;
    - "Explore", accessibilityLabel "Explore public groups": `setMenuOpen(false); router.push('/explore')`;
    - "Join with a link": `openDialog('join')`.
  - Line 2 imports `Plus` from `lucide-react-native`.
- **Icons** (all exported by the installed `lucide-react-native`): `Megaphone`, `Users`, `MessageSquarePlus`, `Compass` and `Link`. `Megaphone` is already used for channels (`channel-screen.tsx:3`) and `Compass` for Explore (`explore.tsx:2`).
- **Test `apps/mobile/src/components/chat/new-chat-button.test.tsx`:**
  - it renders static markup with `react-native` mocked to string tags (lines 23-31) and lucide mocked to `{ Plus: 'Plus' }` (lines 41-43);
  - `nativewind` is already mocked (line 19).

### What to build
1. Replace the menu `Modal` with `<ActionSheet visible={menuOpen} onClose={() => setMenuOpen(false)} closeLabel="Close new chat menu">` and five `ActionSheetItem`s, in the same order, with the same labels, accessibility labels and handlers. The icons, in order: `Megaphone`, `Users`, `MessageSquarePlus`, `Compass`, `Link`.
2. Leave the FAB, the second Modal (the create sheets) and everything else unchanged.
3. **Test:**
   - add the five icons to the lucide mock;
   - add one test that the markup contains each of the five labels and "Explore public groups".

   Change no other assertion. If another test breaks through an import, stop and report BLOCKED with the file name.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/action-sheet.tsx`, `apps/mobile/src/components/ais/ai-actions-sheet.tsx`, `apps/mobile/src/components/chat/new-chat-button.tsx:140-235`, and the test.

### Allowed files
`apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/components/chat/new-chat-button.test.tsx`, `work/T-0428-mobile-new-chat-menu-sheet.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot new-chat-button
pnpm gate
```

### Acceptance
- The New chat menu is the kit ActionSheet with five icon rows. The labels and actions are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
