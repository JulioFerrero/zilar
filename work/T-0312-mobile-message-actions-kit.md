---
id: T-0312
title: "Mobile kit migration: message actions sheet on ActionSheet + ConfirmDialog; voice model download confirm on ConfirmDialog"
status: merged
milestone: M5
branch: task/T-0312-mobile-message-actions-kit
model: auto
effort: low
depends_on: [T-0311]
estimate: 0.4 day
---

# T-0312: message actions and voice download confirm on the kit

## Spec (written by Claude, do not edit)

### Why
The message long-press menu and the voice transcription download confirm are hand-rolled `Modal` sheets. The kit has:
- `ActionSheet` / `ActionSheetItem` (`apps/mobile/src/components/ui/action-sheet.tsx`, from T-0283);
- `ConfirmDialog` (`apps/mobile/src/components/ui/confirm-dialog.tsx`, from T-0287).

`chat-actions-sheet.tsx` and `ai-actions-sheet.tsx` already use them. Read `apps/mobile/src/components/chat/chat-actions-sheet.tsx` as the model.

### Verified facts (do not re-derive)
- **`ActionSheet` props:** `visible`, `onClose`, `closeLabel`, `header` (a node above the items), `title`, `children`, `error`.
  - The sheet draws the dividers between items itself.
- **`ActionSheetItem` props:** `label`, `accessibilityLabel` (defaults to `label`), `onPress`, `disabled`, `icon` (a lucide component, drawn at 18 px muted), `destructive` and `inset`.
- **`ConfirmDialog` props:** `visible`, `title`, `message`, `error`, `confirmLabel`, `busyLabel`, `busy`, `onCancel`, `onConfirm`, `cancelLabel` (default "Cancel"), `confirmAccessibilityLabel`, `destructive` (default true) and `accessibilityLabel` (on the `Modal`).
  - It has **no** prop for the Cancel button's accessibility label.
  - Its Cancel and confirm controls are kit `Button`s (lines 66-77), and `onRequestClose={onCancel}`.
  - Its tests are in `apps/mobile/src/components/ui/kit.test.tsx`, from line 162.
- **`apps/mobile/src/components/chat/message-actions-sheet.tsx`** (188 lines):
  - props at lines 9-31;
  - one `Modal`. When `confirmOpen`, it shows an inline "Delete for everyone?" / "This deletes it for everyone in the chat." box with "Cancel delete" and "Delete" buttons (lines 72-98);
  - otherwise it shows a reactions toolbar (`accessibilityRole="toolbar"`, `accessibilityLabel="Reactions"`, `QUICK_REACTIONS` chips) and these rows:
    - Reply;
    - Edit (`accessibilityLabel` "Edit message", only when `canEdit`);
    - Copy text (disabled when `!canCopy`);
    - Delete for everyone (danger, disabled when `!canDelete`);
    - Pin / Unpin (`accessibilityLabel` "Pin message" / "Unpin message", only when `canPin === true`).
  - The backdrop label is "Close message menu".
  - Its only user is `apps/mobile/src/components/chat/message-bubble.tsx:601`.
- **`apps/mobile/src/components/chat/voice-transcribe-confirm.tsx`** (77 lines):
  - a bottom sheet "Download the transcription model?" / "17 MB, once. Everything stays on your phone.";
  - a "Download" button (`accessibilityLabel` "Download transcription model", text "Downloading…" while busy) and a "Cancel" button (`accessibilityLabel` "Cancel transcription download");
  - the backdrop does nothing while `busy`;
  - the panel's `accessibilityLabel` is "Download the transcription model";
  - it returns `null` when `!open`.
- **Tests:**
  - `apps/mobile/src/components/chat/voice-transcribe-confirm.test.tsx` checks those accessibility labels (lines 94-125) by walking the rendered elements;
  - `apps/mobile/src/components/chat/message-bubble-stickers.test.tsx` imports `message-bubble.tsx`;
  - `apps/mobile/src/components/chat/voice-message.test.tsx` imports `voice-message.tsx`, which imports the voice confirm.
- **Icons used by `chat-actions-sheet.tsx`:** `Pin` / `PinOff` from `lucide-react-native`.

### What to build
1. **`ConfirmDialog`:**
   - add an optional `cancelAccessibilityLabel?: string`, passed to the Cancel `Button`;
   - add a kit test that it reaches the Cancel button.
2. **`message-actions-sheet.tsx`,** keeping the same props:
   - `<ActionSheet visible={visible && !confirmOpen} onClose={onClose} closeLabel="Close message menu" header={<reactions toolbar, as today>}>` with `ActionSheetItem`s:
     - Reply (icon `Reply`);
     - Edit (`Pencil`, accessibilityLabel "Edit message", only when `canEdit`);
     - Copy text (`Copy`, disabled when `!canCopy`);
     - Delete for everyone (`Trash2`, destructive, disabled when `!canDelete`);
     - Pin / Unpin (`Pin` / `PinOff`, with the same labels, only when `canPin === true`).
   - `<ConfirmDialog visible={visible && confirmOpen} title="Delete for everyone?" message="This deletes it for everyone in the chat." confirmLabel="Delete" busyLabel="Deleting…" busy={false} onCancel={onCloseConfirm} onConfirm={onConfirmDelete} cancelAccessibilityLabel="Cancel delete" confirmAccessibilityLabel="Delete" />`.
   - The reaction chips stay emoji: they are message content, not UI icons.
   - Remove imports that become unused.
3. **`voice-transcribe-confirm.tsx`:**
   - render `<ConfirmDialog visible={open} title="Download the transcription model?" message="17 MB, once. Everything stays on your phone." confirmLabel="Download" busyLabel="Downloading…" busy={busy} destructive={false} onConfirm={onDownload} onCancel={busy ? () => {} : onClose} confirmAccessibilityLabel="Download transcription model" cancelAccessibilityLabel="Cancel transcription download" accessibilityLabel="Download the transcription model" />`;
   - keep the `if (!open) return null`;
   - remove the old sheet code and its imports.
4. **Tests:**
   - `voice-transcribe-confirm.test.tsx` may change its mocks and its element walk to reach the kit `Button`s. It must keep checking the same three things: the labels, that Download calls `onDownload`, and that busy disables both and shows "Downloading…".
   - `message-bubble-stickers.test.tsx` and `voice-message.test.tsx` may change for mocks only.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the mobile test mocks pitfall, including the transitive part), the two kit files, `apps/mobile/src/components/chat/chat-actions-sheet.tsx`, the two components and the three tests.

### Allowed files
`apps/mobile/src/components/ui/confirm-dialog.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/voice-transcribe-confirm.tsx`, `apps/mobile/src/components/chat/voice-transcribe-confirm.test.tsx`, `apps/mobile/src/components/chat/message-bubble-stickers.test.tsx` (mocks only), `apps/mobile/src/components/chat/voice-message.test.tsx` (mocks only), `work/T-0312-mobile-message-actions-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit voice-transcribe-confirm message-bubble-stickers voice-message
pnpm gate
```

### Acceptance
- Neither component renders its own `Modal` any more.
- All texts and accessibility labels are unchanged.
- Delete still asks first, and busy still blocks the voice confirm.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)
- `ConfirmDialog` (`ui/confirm-dialog.tsx`): added optional `cancelAccessibilityLabel?: string`, passed to the Cancel kit `Button`. Added a kit test asserting it reaches the Cancel button (`accessibilityLabel="Cancel delete"` in the static markup).
- `message-actions-sheet.tsx`: removed the hand-rolled `Modal`/backdrop/panel. Now renders `<ActionSheet visible={visible && !confirmOpen} onClose closeLabel="Close message menu" header={reactions toolbar}>` with `ActionSheetItem`s (Reply/`Reply`; Edit/`Pencil` a11y "Edit message" when `canEdit`; Copy text/`Copy` disabled when `!canCopy`; Delete for everyone/`Trash2` destructive disabled when `!canDelete`; Pin/Unpin `Pin`/`PinOff` a11y "Pin message"/"Unpin message" when `canPin === true`) plus `<ConfirmDialog visible={visible && confirmOpen} title="Delete for everyone?" ... confirmLabel="Delete" busyLabel="Deleting…" busy={false} onCancel={onCloseConfirm} onConfirm={onConfirmDelete} cancelAccessibilityLabel="Cancel delete" confirmAccessibilityLabel="Delete" />`. Reaction chips stay emoji. Props unchanged. Verified: neither migrated component renders its own `Modal` (grep for "Modal" in both files returns nothing).
- `voice-transcribe-confirm.tsx`: removed the hand-rolled sheet; renders the spec's `<ConfirmDialog ... destructive={false} onCancel={busy ? () => {} : onClose} ... />`, keeping `if (!open) return null`.
- Tests: `voice-transcribe-confirm.test.tsx` added mocks for `@/components/ui/button` and `@/components/ui/text` so the element walk reaches the kit `Button`s through the real `ConfirmDialog`; same three assertions kept (labels, Download calls `onDownload`, busy disables both + "Downloading…"). `message-bubble-stickers.test.tsx` and `voice-message.test.tsx` needed no mock changes (both stub the migrated component entirely) — left untouched.
- Commands: `pnpm install` — ok (11.1s). Scoped tests `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit voice-transcribe-confirm message-bubble-stickers voice-message` — 4 files, 47 tests passed. `pnpm exec prettier --write` on message-actions-sheet (gate format fix). `pnpm gate` — GATE PASS: install ok, format ok, lint ok, typecheck ok, tests @zilar/mobile ok, scope: every changed file inside Allowed files.
- Security checklist: no secrets/tokens in logs or code; no deletes/updates touched; no caps/uniqueness rules; no permission flow changed (delete still confirms first, busy still blocks voice confirm backdrop via noop onCancel); no new routes; no audit entries.
- No deviations from spec; no open questions.

## Review (written by Claude)

**Approved.** Clean pre-review (2 nits), no fix rounds (Muse, peak).
- The message actions use `ActionSheet` with icons, and "Delete for everyone?" is a centred `ConfirmDialog`.
- The voice download prompt is a `ConfirmDialog`; busy still blocks Cancel and Back.
- `ConfirmDialog` gained `cancelAccessibilityLabel`, with a test.

**Nits, accepted:**
- two dead mocks in the voice test;
- `onPin ?? noop`, which behaves the same as before.

**Visible change for QA:** the menu is now the floating kit card, as in the chat actions sheet, and the delete confirm is centred instead of inline.
