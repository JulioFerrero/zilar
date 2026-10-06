---
id: T-0387
title: "Mobile kit: the profile card's Confirm block uses the kit destructive Button instead of a hand-rolled red pill with a hard-coded white icon"
status: merged
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

### What I did
Replaced the hand-rolled solid `bg-danger` confirm pill in `apps/mobile/src/components/contacts/profile-card.tsx` with the kit `Button`:

```tsx
<Button
  variant="destructive"
  size="sm"
  accessibilityLabel="Confirm block"
  disabled={busy}
  onPress={onBlock}
>
  <Ban size={14} color="#ffffff" />
  <Text>{busy ? 'Blocking…' : 'Block'}</Text>
</Button>
```

The icon colour `#ffffff` is kept as-is, matching the kit's `text-white` destructive text (button.tsx line 65). The label is inside `<Text>`. The `Pressable` import in `profile-card.tsx` is **kept**, because `Pressable` is still used at lines 98 and 313 (verified with grep). No test assertions or mocks were changed.

### Files changed
- `apps/mobile/src/components/contacts/profile-card.tsx` (the confirm-block element, lines 289-298)
- `work/T-0387-mobile-profile-card-confirm-block-kit.md` (status + this Report)

`apps/mobile/src/components/contacts/contacts.test.tsx` was NOT changed — the existing tests pass unchanged (no mocks needed), because the test's `collect` helper recurses into function components and the `Button`'s inner `Pressable` still surfaces with `accessibilityLabel="Confirm block"`.

### Commands and real results
- `pnpm install`: Done, exit 0 (warnings only: 3 deprecated subdeps, one unmet peer `@types/react-dom`).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/contacts/contacts.test.tsx`: **32 passed (1 file)**, exit 0. (stderr had pre-existing `renderToStaticMarkup` casing warnings, no failures.)
- `pnpm gate` (from repo root), summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (21.3s)
  PASS  lint  (1.5s)
  PASS  typecheck  (10.0s)
  PASS  tests @zilar/mobile  (2.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Acceptance check
- No `bg-danger` class remains in `profile-card.tsx` (grep: no matches).
- The label is inside `<Text>`.
- Tests pass.
- `pnpm gate` ends with `GATE PASS` and lists no file outside the Allowed files.

### Deviations / open questions
None. No blockers.

## Review (written by Claude)

Approved (lead, 2026-10-06). Confirm block is a kit destructive `sm` Button with the Ban icon and the label inside `<Text>`; no `bg-danger` left in the profile card. Pre-review clean (0 findings). Emulator check in QA run 31.
