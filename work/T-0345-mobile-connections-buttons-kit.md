---
id: T-0345
title: "Mobile kit migration: the text pill buttons on the Connections screen use the kit Button"
status: todo
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

## Review (written by Claude)
