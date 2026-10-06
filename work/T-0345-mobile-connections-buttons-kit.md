---
id: T-0345
title: "Mobile kit migration: the text pill buttons on the Connections screen use the kit Button"
status: merged
milestone: M5
branch: task/T-0345-mobile-connections-buttons-kit
model: auto
effort: low
depends_on: [T-0343]
estimate: 0.2 day
---

# T-0345: Connections screen buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343 (Machines), for the next Settings screen. The Connections screen hand-rolls six text pill buttons.

### Verified facts (do not re-derive)
- **The six text pill `Pressable`s in `apps/mobile/src/app/settings/connections.tsx`** (the line is the `<Pressable`):

| Line | Label | Look today | Kit variant |
| --- | --- | --- | --- |
| 196 | "Retry loading connections" (with an icon) | `border border-border-strong` | `outline` |
| 214 | "Add a connection" (`Plus` in `ACCENT_FOREGROUND[scheme]`) | `bg-accent` | `default` |
| 246 | "Cancel removing" (text "Cancel"; `onPress` clears `confirmingId` and `removeError`) | plain | `ghost` |
| 258 | "Confirm remove" (text "Remove" / "Removing…", `text-white`) | `bg-destructive` | `destructive` |
| 491 | "Save the connection" (text "Save" / "Saving…") | `bg-accent` | `default` |
| 502 | "Cancel" | plain | `ghost` |

- **Leave these `Pressable`s alone,** because they are not text pills:
  - the icon-only ones at lines 301 (Test key), 310 (Remove connection), 401 (Close the form) and 458 (Show/Hide key);
  - the provider chips at line 417.
- **`apps/mobile/src/components/ui/button.tsx`:**
  - variants `default`, `destructive`, `outline`, `secondary`, `ghost`;
  - size `sm`; `Text` children take their colour from `TextClassContext`.
  - It imports `TextClassContext` from `@/components/ui/text`, `useKeyPress`, `@/lib/depth` and `Platform`.
- **`apps/mobile/src/components/connections/connections-screen.test.tsx:62-64`:**
  - mocks `@/components/ui/text` as `{ Text: 'Text' }` only, with no `TextClassContext`;
  - add `TextClassContext: { Provider: 'TextClassContextProvider' }`, as `apps/mobile/src/components/machines/machines-screen.test.tsx:63-66` does;
  - check the `react-native` mock covers what `Button` needs (`Platform`). This is the transitive mock pitfall in `docs/LEAD_HANDOFF.md`.

### What to build
1. Replace the six `Pressable`s with `<Button variant=… size="sm">`, using the variant in the table. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text, the busy text, and the icons and their colours.

   Drop the old pill `className` and the child `Text` colour and size classes. Keep layout classes such as `mt-*` and `self-start` if any were there.
2. Import `Button` from `@/components/ui/button`.
3. Test: mock changes only, so that the existing assertions pass.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `work/T-0343-mobile-machines-buttons-kit.md` (Report), `apps/mobile/src/components/ui/button.tsx`, `apps/mobile/src/app/settings/connections.tsx:180-520` and `apps/mobile/src/components/connections/connections-screen.test.tsx`.

### Allowed files
`apps/mobile/src/app/settings/connections.tsx`; mocks only: `apps/mobile/src/components/connections/connections-screen.test.tsx`; and `work/T-0345-mobile-connections-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot connections-screen
pnpm gate
```

### Acceptance
- None of the six pill styles (`rounded-full bg-accent`, `rounded-full bg-destructive`, `rounded-full border border-border-strong`, and the plain `rounded-full px-` text pills) remain in `connections.tsx`.
- Tests pass, with mock changes only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done, ready for review.

**What I did**
Replaced the six hand-rolled text pill `Pressable`s in `apps/mobile/src/app/settings/connections.tsx` with the kit `Button` (`size="sm"`), per the spec table:
- Retry loading connections (line 196) → `<Button variant="outline" size="sm">`, kept the `RefreshCw` icon at `ICON[scheme]` and the visible text "Retry";
- Add a connection (line 214) → `variant="default"`, kept the `Plus` icon at `ACCENT_FOREGROUND[scheme]` and the text "Add a connection";
- Cancel removing (line 246) → `variant="ghost"`, kept `disabled={busy}` and the `onPress` that clears `confirmingId` and `removeError`;
- Confirm remove (line 258) → `variant="destructive"`, kept `disabled={busy}`, the `onPress` and the busy text ("Removing…" / "Remove");
- Save the connection (line 491) → `variant="default"`, kept `disabled={busy}`, `onPress={submit}` and the busy text ("Saving…" / "Save");
- Cancel (line 502) → `variant="ghost"`, kept `disabled={busy}` and `onPress={onCancel}`.

For every button I kept the `accessibilityLabel`, `disabled` and `onPress`; kept the visible/busy text and the icons/colours; dropped the old pill `className` and the child `Text` colour/size classes (`text-[15px]`, `font-medium`, `text-accent-foreground`, `text-white`, `text-muted-foreground`), which the kit's `TextClassContext` now sets. None of the six had layout classes (`mt-*`/`self-start`), so no `className` remains on any of them. `accessibilityRole="button"` was dropped because the kit `Button` sets `role="button"` on its `Pressable`. Added the import `import { Button } from '@/components/ui/button';`.

**Pressables that remain (not text pills, spec says leave them):**
- the icon-only ones: Test key (line 298), Remove connection (line 307), Close the form (line 398), Show/Hide key (line 455);
- the provider chips (line 414), which are a radio group, not text pills.
`Pressable` therefore stays in the `react-native` import (line 14). The `rounded-full` status badge `Text` at line 278 also remains: it is a label, not a button.

**Files changed**
- `apps/mobile/src/app/settings/connections.tsx` — six `Pressable`s replaced with kit `Button`s; `Button` imported.
- `apps/mobile/src/components/connections/connections-screen.test.tsx` — mocks only: added `TextClassContext: { Provider: 'TextClassContextProvider' }` to the `@/components/ui/text` mock, added `Platform` to the `react-native` mock and added the `react-native-reanimated` (`useReducedMotion`) mock, which `Button` now pulls in through `@/lib/depth`/`use-key-press`.
- `work/T-0345-mobile-connections-buttons-kit.md` — status and this Report.

**Commands run and results**
- `pnpm install` (worktree) — succeeded (`Done in 11.4s`; only pre-existing peer/deprecation warnings).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot connections-screen` — `Test Files 1 passed (1)`, `Tests 5 passed (5)` (only the usual React DOM casing warnings on stderr).
- `pnpm gate` (repo root) — final output:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (15.6s)
  PASS  lint  (0.9s)
  PASS  typecheck  (6.4s)
  PASS  tests @zilar/mobile  (1.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviations from the spec / note on Acceptance**
- None in the code. The Acceptance says "none of the six pill styles (`rounded-full bg-accent`, `rounded-full bg-destructive`, `rounded-full border border-border-strong`, and the plain `rounded-full px-` text pills) remain in `connections.tsx`". After the change, `grep -n "rounded-full"` still returns the provider chips at lines 422-423 (`rounded-full bg-accent` / `rounded-full border border-border-strong`) and the icon-only/status-badge elements. The provider chips are exactly the ones the spec's "Leave these `Pressable`s alone" list tells me to keep, so I read the Acceptance as applying to the six migrated buttons. Flagging it in case the lead meant the chips too; that would be a separate task since it changes the provider-picker look.

**Acceptance check**
- Six pill `Pressable`s replaced; their old pill `className`s are gone. Remaining `rounded-full` occurrences are only the provider chips and the icon-only/status elements listed above, which the spec excludes.
- Tests pass, with mock changes only; `pnpm gate` ends `GATE PASS` and lists no file outside the Allowed files.

**Blocked / needs a decision:** none.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). The six text pills are now kit `Button`s with the variants from the table: Retry outline, Add default, Cancel removing ghost, Confirm remove destructive, Save default, Cancel ghost. The lead grep found the labels, `disabled` and handlers kept. The test changes are mocks only: `Platform.select`, reanimated and `TextClassContext`.
