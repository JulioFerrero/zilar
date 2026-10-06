---
id: T-0355
title: "Mobile kit migration: the group invite links sheet uses the kit Button"
status: todo
milestone: M5
branch: task/T-0355-mobile-invite-links-buttons-kit
model: auto
effort: low
depends_on: [T-0353]
estimate: 0.2 day
---

# T-0355: invite links sheet buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343 to T-0354, for the group invite links sheet.

### Verified facts (do not re-derive)
- **The four `Pressable`s to migrate in `apps/mobile/src/components/chat/invite-links-sheet.tsx`** (the line is the `<Pressable`):

| Line | Label | Look today | Kit variant and size | Keep on Button |
| --- | --- | --- | --- | --- |
| 215 | "Create invite link" (with `disabled`) | `mt-3 items-center rounded-full bg-accent px-4 py-2.5` | `default`, `default` | `className="mt-3"` |
| 275 | `` `Revoke invite link ${link.label ?? link.tokenHint}` `` (with `disabled`) | `shrink-0 rounded-full border border-border-strong px-3 py-1` | `outline`, `sm` | `className="shrink-0"` |
| 340 | "Copy invite link" | `flex-1 items-center rounded-full bg-accent px-4 py-2` | `default`, `default` | `className="flex-1"` |
| 350 | "Share invite link" | `flex-1 items-center rounded-full border border-border-strong px-4 py-2` | `outline`, `default` | `className="flex-1"` |

- **Leave alone:** the text link "Done with invite link" (line 362).
- **Tests that reach this file** (the lead grepped importers: `app/group/[id].tsx` and `components/chat/channel-screen.tsx`, and no test imports either one):
  - only `apps/mobile/src/components/chat/invite-links-sheet.test.tsx`.

  Add mocks only, as in T-0353 (`apps/mobile/src/components/chat/new-group-sheet.test.tsx`): `Platform.select`, reanimated `useReducedMotion`, `TextClassContext`, the `@/lib/depth` key exports, and `@/components/ui/use-key-press` if the test renders a body as a plain function or forces `useState` in order.

### What to build
1. Replace the four `Pressable`s with the kit `Button`, using the table. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text and busy text;
   - the layout classes.

   Drop the old pill classes and the child `Text` colour and size classes.
2. Import `Button`. Remove `Pressable` from the import only if it becomes unused.
3. Tests: mock changes only.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `work/T-0353-mobile-new-group-explore-buttons-kit.md` (Report), `apps/mobile/src/components/ui/button.tsx`, the file and its test.

### Allowed files
`apps/mobile/src/components/chat/invite-links-sheet.tsx`; mocks only: `apps/mobile/src/components/chat/invite-links-sheet.test.tsx`; and `work/T-0355-mobile-invite-links-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot invite-links-sheet
pnpm gate
```

### Acceptance
- The four `Pressable`s render through `Button`.
- Tests pass, with mock changes only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
