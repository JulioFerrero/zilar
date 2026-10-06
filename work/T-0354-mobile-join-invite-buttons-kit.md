---
id: T-0354
title: "Mobile kit migration: the join-link card and the Invite a friend sheet use the kit Button"
status: merged
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

**Status:** done, ready for review.

**What I did**
Replaced the nine hand-rolled pill `Pressable`s with the kit `Button` (`apps/mobile/src/components/ui/button.tsx`), following the spec table:
- `apps/mobile/src/components/chat/join-link.tsx`: "Retry loading the link" → `variant="default" className="mt-5"`; "Cancel" ("Back to chats") → `variant="default" className="mt-5"`; join/open (`disabled={busy}`, busy text `Joining…`) → `variant="default" className="mt-5"`; "Continue with link" → `variant="default" className="mt-3"`. Left the two text-only "Cancel" `Pressable`s alone, so `Pressable` stays in the import.
- `apps/mobile/src/components/chat/invite-sheet.tsx`: "Close" → `variant="ghost"` (×2); "Try again" → `variant="default"`; "Copy invite link" (icon + text, `disabled`) → `variant="default" className="flex-1"` with `Check`/`Copy` in `ACCENT_FOREGROUND[scheme]` from `@/lib/colors` (T-0341/T-0346 pattern, via `asColorScheme(useColorScheme().colorScheme)`); "Share invite link" (icon + text, `disabled`) → `variant="outline" className="flex-1"`, `Share2` keeps `#8a8a8a`. Left the card wrapper `Pressable` alone, so `Pressable` stays in the import.
- Kept every `accessibilityLabel`, `disabled`, `onPress`, visible text, busy text and icons in all nine. Dropped the old pill classes and the child `Text` colour/size classes (kit `TextClassContext` sets them). Dropped `accessibilityRole="button"` since the kit `Button` sets `role="button"` (T-0348/T-0351/T-0353 pattern).
- Tests, mocks only: `join-link.test.tsx` — added `Platform.select` to the `react-native` mock, a `react-native-reanimated` `useReducedMotion` mock, `TextClassContext` on the `../../components/ui/text` mock, and an `@/components/ui/use-key-press` mock (needed because the test calls the body as a plain function, so the real `Button`'s hook would throw an invalid-hook-call; same reason as T-0353). Its `@/components/ui/text` mock (the `@/` path) was unused by the component and left untouched. `invite-sheet.test.tsx` — added `Platform.select`, `@/lib/color-scheme` (`asColorScheme`), `@/lib/colors` (`ACCENT_FOREGROUND`), `TextClassContext`, `use-key-press`, `nativewind` `useColorScheme`, and `useReducedMotion`. `new-chat-button.test.tsx` needed no changes: it already has `Platform.select`, `TextClassContext`, reanimated and `@/lib/depth` mocks since T-0353, and it renders sheets through the mocked `@/components/chat/join-link` stub. No `@/lib/depth` mock was added to either test: `invite-sheet.tsx` no longer imports `@/lib/depth`.

**Files changed**
- `apps/mobile/src/components/chat/join-link.tsx` — four `Pressable`s now kit `Button`s; `Button` imported.
- `apps/mobile/src/components/chat/invite-sheet.tsx` — five `Pressable`s now kit `Button`s; `Button`, `useColorScheme`, `asColorScheme`, `@/lib/colors` imported; `@/lib/depth` import replaced.
- `apps/mobile/src/components/chat/join-link.test.tsx` — mocks only (see above).
- `apps/mobile/src/components/chat/invite-sheet.test.tsx` — mocks only (see above).
- `work/T-0354-mobile-join-invite-buttons-kit.md` — status and this Report.

**Commands run and results**
- `pnpm install` (worktree) — succeeded (`Done in 13.1s`).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot join-link invite-sheet new-chat-button` — `Test Files 3 passed (3)`, `Tests 38 passed (38)` (only the usual string-mock casing warnings on stderr). Re-ran after the prettier fix: same 38 passed.
- `pnpm gate` (repo root) — first run failed `format` (same short-`<Button>`-line collapse as T-0353); after `pnpm exec prettier --write` on the two source files, final output:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (12.7s)
  PASS  lint  (0.8s)
  PASS  typecheck  (6.7s)
  PASS  tests @zilar/mobile  (1.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviations from the spec:** none.

**Blocked / needs a decision:** none.

**Security checklist:** no secrets, routes, deletes, caps, permissions, or audit entries touched — UI button migration only; `disabled`/`busy` guards unchanged. Invite URLs render as before; the token never enters logs or errors.

## Review (written by Claude)

**Approved** (pre-review clean, 2 nits accepted, one of them a stale "hook-free" comment on `InviteSheetBody`). The nine buttons are kit `Button`s. After the T-0349 bug, the lead checked that every label is inside `<Text>`. The tests changed mocks only.
