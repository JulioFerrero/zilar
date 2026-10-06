---
id: T-0352
title: "Mobile kit migration: the buttons on the group invite-link screen and the public @handle screen use the kit Button"
status: todo
milestone: M5
branch: task/T-0352-mobile-join-handle-buttons-kit
model: auto
effort: low
depends_on: [T-0351]
estimate: 0.2 day
---

# T-0352: join and @handle screen buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343 to T-0351, for the two link-landing screens.

### Verified facts (do not re-derive)
- **The six text pill `Pressable`s** (the line is the `<Pressable`):

| File | Line | Label | Look today | Kit variant and size | Keep on Button |
| --- | --- | --- | --- | --- | --- |
| `apps/mobile/src/app/join/[token].tsx` | 79 | "Choose a name" | `mt-5 items-center rounded-full bg-accent px-4 py-2.5` | `default`, `default` | `className="mt-5"` |
| `apps/mobile/src/app/at/[handle].tsx` | 138 | "Close" | `mt-5 rounded-full bg-accent px-4 py-2` | `default`, `default` | `className="mt-5"` |
| `apps/mobile/src/app/at/[handle].tsx` | 160 | "Retry" | `rounded-full bg-accent px-4 py-2` | `default`, `default` | |
| `apps/mobile/src/app/at/[handle].tsx` | 168 | "Close" | `rounded-full border border-border-strong px-4 py-2` | `outline`, `default` | |
| `apps/mobile/src/app/at/[handle].tsx` | 201 | `handleJoinLabel(view.entry)` (full width, with `disabled`) | `mt-5 w-full items-center rounded-full bg-accent px-4 py-2.5` | `default`, `lg` | `className="mt-5 w-full"` |
| `apps/mobile/src/app/at/[handle].tsx` | 212 | "Close" | `mt-3 rounded-full px-4 py-1.5` | `ghost`, `default` | `className="mt-3"` |

- **Tests:** no test imports either route file (the lead grepped for `join/[token]` and `at/[handle]` across `*.test.*`). So no test should need a change; if the gate shows one, add mocks only and name the file in the Report.
- **The kit `Button`:** `apps/mobile/src/components/ui/button.tsx`, sizes `default` (h-10) and `lg` (h-11).

### What to build
1. Replace the six `Pressable`s with the kit `Button`, using the table. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text;
   - the layout classes in the last column.

   Drop the old pill classes and the child `Text` colour and size classes.
2. Import `Button` in both files. Remove `Pressable` from an import only if it becomes unused.

### Read first
`AGENTS.md`, `work/T-0351-mobile-auth-buttons-kit.md` (Report), `apps/mobile/src/components/ui/button.tsx`, and the two files.

### Allowed files
`apps/mobile/src/app/join/[token].tsx`, `apps/mobile/src/app/at/[handle].tsx`, `work/T-0352-mobile-join-handle-buttons-kit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The six `Pressable`s render through `Button`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
