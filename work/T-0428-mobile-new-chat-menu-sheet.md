---
id: T-0428
title: "Mobile kit: the New chat menu (New channel, New group, New message, Explore, Join with a link) uses the kit ActionSheet with icons"
status: merged
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

### What I did
- `apps/mobile/src/components/chat/new-chat-button.tsx`: replaced the hand-rolled menu `<Modal>` with the kit `<ActionSheet visible={menuOpen} onClose={() => setMenuOpen(false)} closeLabel="Close new chat menu">` and five `<ActionSheetItem>`s in the same order, with the same labels, accessibility labels and handlers ("New channel" → `openDialog('channel')`, "New group" → `openDialog('group')`, "New message" → `openDialog('message')`, "Explore" with `accessibilityLabel="Explore public groups"` → close + `router.push('/explore')`, "Join with a link" → `openDialog('join')`). Icons in order: `Megaphone`, `Users`, `MessageSquarePlus`, `Compass`, `Link`.
- Removed the now-unused `Text` import from the component: the menu was its only consumer, and oxlint's `no-unused-vars` failed the gate with it present.
- Left the FAB, the create-sheets `Modal` and everything else unchanged.
- `apps/mobile/src/components/chat/new-chat-button.test.tsx`: added the five icons to the `lucide-react-native` mock and one test ("offers the New chat menu rows") asserting the markup contains each of the five labels plus "Explore public groups". No other assertion changed.
- Prettier reformatted `new-chat-button.tsx` (menu block + the long lucide import). These are the only changes in the file.

### Files changed
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/chat/new-chat-button.test.tsx`
- `work/T-0428-mobile-new-chat-menu-sheet.md` (status + this Report)

### Commands and results
- `pnpm install`: done, 13 workspace projects, exit 0.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot new-chat-button`: 1 file passed, 7 tests passed. (The only stderr is the pre-existing React DOM attribute warnings from the string-tag React Native mock.)
- `pnpm gate` (first run): FAIL on `format` (prettier wanted the component reformatted), exit 1.
- `pnpm exec prettier --write` on the two changed mobile files, then a manual fix removing the unused `Text` import (the second gate run failed `lint` with `no-unused-vars` for `Text`).
- `pnpm gate` (final), from the repo root:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.2s)
  PASS  format  (27.7s)
  PASS  lint  (1.3s)
  PASS  typecheck  (10.5s)
  PASS  tests @zilar/mobile  (2.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- The spec said "Leave ... everything else unchanged"; I had to delete the component's unused `Text` import because the removed menu was its only use and `pnpm gate`'s lint failed otherwise. No behavior change. Everything else matches the spec.
- No other test broke through the import.

### Security checklist
- No secrets or tokens added; no logging, routes, deletes, updates, caps or audit entries touched. Not applicable to this UI-only change.

## Review (written by Claude)

Approved (lead, 2026-10-06). The New chat menu is now the kit ActionSheet, with five icon rows (Megaphone, Users, MessageSquarePlus, Compass, Link). Labels, accessibility labels and handlers are unchanged. The row role is now button, the kit standard. Nit accepted: the test does not pin the icon mapping.
