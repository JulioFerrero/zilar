---
id: T-0354
title: "Mobile kit migration: the join-link card and the Invite a friend sheet use the kit Button"
status: todo
milestone: M5
branch: task/T-0354-mobile-join-invite-buttons-kit
model: auto
effort: low
depends_on: [T-0353]
estimate: 0.2 day
---

# T-0354: join-link and invite sheet buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343 to T-0353, for two more chat components.

### Verified facts (do not re-derive)
- **The `Pressable`s to migrate** (the line is the `<Pressable`):

| File | Line | Label | Look today | Kit variant and size | Keep on Button |
| --- | --- | --- | --- | --- | --- |
| `apps/mobile/src/components/chat/join-link.tsx` | 157 | "Retry loading the link" | `mt-5 items-center rounded-full bg-accent px-4 py-2.5` | `default`, `default` | `className="mt-5"` |
| `apps/mobile/src/components/chat/join-link.tsx` | 180 | "Cancel" | `mt-5 items-center rounded-full bg-accent px-4 py-2.5` | `default`, `default` | `className="mt-5"` |
| `apps/mobile/src/components/chat/join-link.tsx` | 210 | `preview.alreadyMember ? 'Open the group' : joinButtonTitle(preview)` (with `disabled`) | `mt-5 items-center rounded-full bg-accent px-4 py-2.5` | `default`, `default` | `className="mt-5"` |
| `apps/mobile/src/components/chat/join-link.tsx` | 268 | "Continue with link" | `mt-3 items-center rounded-full bg-accent px-4 py-2.5` | `default`, `default` | `className="mt-3"` |
| `apps/mobile/src/components/chat/invite-sheet.tsx` | 130 | "Close" | `rounded-full px-4 py-2` | `ghost`, `default` | |
| `apps/mobile/src/components/chat/invite-sheet.tsx` | 138 | "Try again" | `rounded-full bg-accent px-4 py-2` | `default`, `default` | |
| `apps/mobile/src/components/chat/invite-sheet.tsx` | 156 | "Copy invite link" (icon + text, with `disabled`) | `flex-1 … rounded-full bg-accent px-4 py-2` | `default`, `default` | `className="flex-1"` |
| `apps/mobile/src/components/chat/invite-sheet.tsx` | 172 | "Share invite link" (icon + text, with `disabled`) | `flex-1 … rounded-full border border-border-strong px-4 py-2` | `outline`, `default` | `className="flex-1"` |
| `apps/mobile/src/components/chat/invite-sheet.tsx` | 184 | "Close" | `rounded-full px-4 py-2` | `ghost`, `default` | |

- **Leave alone:**
  - the text-only "Cancel" `Pressable`s in `join-link.tsx` (around lines 165 and 221);
  - any backdrop or card wrapper `Pressable`, such as `invite-sheet.tsx:115`.
- **Icons:** an icon inside a `default` (accent) button uses `ACCENT_FOREGROUND[scheme]` from `@/lib/colors`, as in T-0341 and T-0346.
- **Tests that reach these files** (the lead grepped importers up to the route files, which have no tests):
  - `apps/mobile/src/components/chat/join-link.test.tsx`;
  - `apps/mobile/src/components/chat/invite-sheet.test.tsx`;
  - `apps/mobile/src/components/chat/new-chat-button.test.tsx`, which already has the kit Button mocks since T-0353.

  Add mocks only, as in T-0353 (`apps/mobile/src/components/chat/new-group-sheet.test.tsx`): `Platform.select`, reanimated `useReducedMotion`, `TextClassContext`, the `@/lib/depth` key exports, and `@/components/ui/use-key-press` if the test renders a component body as a plain function or forces `useState` in order.

### What to build
1. Replace the nine `Pressable`s with the kit `Button`, using the table. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text, busy text and icons;
   - the layout classes.

   Drop the old pill classes and the child `Text` colour and size classes.
2. Import `Button`. Remove `Pressable` from an import only if it becomes unused.
3. Tests: mock changes only.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `work/T-0353-mobile-new-group-explore-buttons-kit.md` (Report), `apps/mobile/src/components/ui/button.tsx`, the two files and the three tests.

### Allowed files
`apps/mobile/src/components/chat/join-link.tsx`, `apps/mobile/src/components/chat/invite-sheet.tsx`; mocks only: `apps/mobile/src/components/chat/join-link.test.tsx`, `apps/mobile/src/components/chat/invite-sheet.test.tsx`, `apps/mobile/src/components/chat/new-chat-button.test.tsx`; and `work/T-0354-mobile-join-invite-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot join-link invite-sheet new-chat-button
pnpm gate
```

### Acceptance
- The nine `Pressable`s render through `Button`.
- Tests pass, with mock changes only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
