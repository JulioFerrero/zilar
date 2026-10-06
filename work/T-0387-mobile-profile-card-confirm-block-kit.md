---
id: T-0387
title: "Mobile kit: the profile card's Confirm block uses the kit destructive Button instead of a hand-rolled red pill with a hard-coded white icon"
status: todo
milestone: M5
branch: task/T-0387-mobile-profile-card-confirm-block-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0387: profile card Confirm block on the kit

## Spec (written by Claude, do not edit)

### Why
This is the last hand-rolled solid `bg-danger` button on mobile. It also hard-codes the icon colour `#ffffff`.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/button.tsx`:**
  - `destructive` is `bg-destructive …`, and its text variant is `text-white` (line 65);
  - size `sm` exists;
  - **labels must be inside `<Text>`**.
- **`apps/mobile/src/components/contacts/profile-card.tsx`:**
  - lines 289-300: `<Pressable accessibilityRole="button" accessibilityLabel="Confirm block" disabled={busy} onPress={onBlock} className="flex-row items-center gap-1.5 rounded-full bg-danger px-3 py-1.5 active:opacity-90 disabled:opacity-60">` containing `<Ban size={14} color="#ffffff" />` and `<Text className="text-[14px] font-medium text-white">{busy ? 'Blocking…' : 'Block'}</Text>`;
  - the next sibling is a kit `<Button … variant="outline" size="sm">` Cancel (line 301);
  - `Ban` is imported at line 1 and `Button` at line 6.
- **Test:** `apps/mobile/src/components/contacts/contacts.test.tsx` renders the profile card.

### What to build
1. Replace the `Pressable` with `<Button variant="destructive" size="sm" accessibilityLabel="Confirm block" disabled={busy} onPress={onBlock}>` containing:
   - `<Ban size={14} color="#ffffff" />` (white on the destructive key, matching the kit's `text-white`; keep the colour as is);
   - `<Text>{busy ? 'Blocking…' : 'Block'}</Text>`.
2. Drop the `Pressable` import only if nothing else in the file uses it.
3. If the test fails on the change, add mocks only. Change no assertion.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/button.tsx` and `apps/mobile/src/components/contacts/profile-card.tsx:280-312`.

### Allowed files
`apps/mobile/src/components/contacts/profile-card.tsx`, `apps/mobile/src/components/contacts/contacts.test.tsx`, `work/T-0387-mobile-profile-card-confirm-block-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot contacts
pnpm gate
```

### Acceptance
- No `bg-danger` class remains in `profile-card.tsx`.
- The label is inside `<Text>`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
