---
id: T-0425
title: "Mobile kit: the profile Copy username, Discard and Remove picture buttons and the contact card Block link use the kit Button"
status: merged
milestone: M5
branch: task/T-0425-mobile-profile-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0425: profile buttons on the kit (mobile)

## Spec (written by Claude, do not edit)

### Why
This is batch 21 of `docs/audit/ui-kit-leftovers.md`. The "Claim a username" row (`profile-view.tsx:154`) is a content row with two text lines, so it stays raw.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/button.tsx`:**
  - variants `outline`, `ghost` and `link`; sizes `default`, `sm` and `icon`;
  - `cn` merges `className`, and `disabled` dims the button;
  - labels MUST be inside `<Text>`.
  - Both files below already import `Button` (`profile-view.tsx:9`, `profile-card.tsx:6`).
- **`apps/mobile/src/components/profile/profile-view.tsx`:**
  - ~line 178: `Pressable` "Copy username", `onPress={onCopyUsername}`, class `rounded-lg p-2 active:bg-surface-raised`, with an icon child;
  - ~line 228: `Pressable` "Discard picture", `disabled={edit.busy}`, `onPress={edit.onDiscard}`, class `items-center rounded-full border border-border-strong bg-surface px-4 py-2 …`, child `<Text className="text-[14px] text-foreground">Discard</Text>`;
  - ~line 246: `Pressable` "Remove picture", `disabled={edit.busy}`, `onPress={edit.onRemove}`, the same outline-pill class, with a `<Text>` child.
- **`apps/mobile/src/components/contacts/profile-card.tsx:311`:** `Pressable` "Block", `disabled={busy}`, `onPress={onStartBlock}`, class `mt-2 self-start px-1 active:opacity-70 disabled:opacity-60`, child `<Text className="text-[14px] text-muted-foreground">Block</Text>`.
- **Tests:**
  - `apps/mobile/src/components/profile/profile-view.test.tsx`;
  - `apps/mobile/src/components/contacts/contacts.test.tsx`.

### What to build
1. **Copy username:** `<Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" accessibilityLabel="Copy username" onPress={onCopyUsername}>` with the same icon.
2. **Discard and Remove picture:** `<Button variant="outline" className="rounded-full" accessibilityLabel=… disabled={edit.busy} onPress=…>` with the same `<Text>` children. Remove stays outline: it is not red today.
3. **Block:** `<Button variant="ghost" size="sm" className="mt-2 self-start px-1" accessibilityLabel="Block" disabled={busy} onPress={onStartBlock}>` with the same muted `<Text>`.
4. Drop `Pressable` from an import only when it becomes unused. Change no assertion. Add mocks only if needed. If a test outside the Allowed files breaks through an import, stop and report BLOCKED with the file name.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/button.tsx`, `apps/mobile/src/components/profile/profile-view.tsx:140-270`, `apps/mobile/src/components/contacts/profile-card.tsx:290-325`, and the two tests.

### Allowed files
`apps/mobile/src/components/profile/profile-view.tsx`, `apps/mobile/src/components/contacts/profile-card.tsx`, `apps/mobile/src/components/profile/profile-view.test.tsx`, `apps/mobile/src/components/contacts/contacts.test.tsx`, `work/T-0425-mobile-profile-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot profile-view contacts
pnpm gate
```

### Acceptance
- The four controls are kit Buttons with their labels inside `<Text>`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Replaced the four raw `Pressable` controls with the kit `Button`, labels still inside `<Text>`:
1. **Copy username** (`profile-view.tsx:177`): `<Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" accessibilityLabel="Copy username" onPress={onCopyUsername}>` with the same `<Copy size={18} …/>` icon.
2. **Discard picture** (`profile-view.tsx`, `PhotoEditRow`): `<Button variant="outline" className="rounded-full" accessibilityLabel="Discard picture" disabled={edit.busy} onPress={edit.onDiscard}>` with the same `<Text className="text-[14px] text-foreground">Discard</Text>`.
3. **Remove picture** (`profile-view.tsx`, `PhotoEditRow`): `<Button variant="outline" className="rounded-full" accessibilityLabel="Remove picture" disabled={edit.busy} onPress={edit.onRemove}>` with the same `<Text>` (kept outline; it is not red today).
4. **Block** (`profile-card.tsx:310`): `<Button variant="ghost" size="sm" className="mt-2 self-start px-1" accessibilityLabel="Block" disabled={busy} onPress={onStartBlock}>` with the same muted `<Text className="text-[14px] text-muted-foreground">Block</Text>`.

`Pressable` is still used elsewhere in both files (`ActionKey` and the "Claim a username" row; the profile-card header), so both imports stay. No test assertion was changed and no new mock was needed.

### Files changed
- `apps/mobile/src/components/profile/profile-view.tsx` (4 controls)
- `apps/mobile/src/components/contacts/profile-card.tsx` (Block)
- `work/T-0425-mobile-profile-buttons-kit.md` (this report + status)

### Commands and real results
- `pnpm install`: done, success.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot profile-view contacts`: **8 test files passed, 108 tests passed** (the two path patterns matched 8 files, all green).
- `pnpm gate`: **GATE PASS**; summary:
  - `gate: 3 changed file(s) against main`
  - `PASS install (frozen) (2.2s)`
  - `PASS format (27.5s)`
  - `PASS lint (2.5s)`
  - `PASS typecheck (17.2s)`
  - `PASS tests @zilar/mobile (3.3s)`
  - `scope: every changed file is inside the Allowed files`

### Deviations / notes
- The old Copy-username `Pressable` had `hitSlop={8}`; the spec's Button recipe lists no `hitSlop`, so I dropped it and followed the spec exactly. `accessibilityRole="button"` was also dropped because `Button` sets `role="button"` internally.
- No test outside the Allowed files broke.

### Open questions
None.

## Review (written by Claude)

Approved (lead, 2026-10-06). These four controls are now kit Buttons: Copy username (ghost icon), Discard and Remove picture (outline rounded-full) and Block (ghost sm). Labels stay inside Text, disabled is passed through, and no assertion changed. The pre-review was clean (0/0/0/0).
