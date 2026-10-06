---
id: T-0355
title: "Mobile kit migration: the group invite links sheet uses the kit Button"
status: merged
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

**Status:** done, ready for review.

**What I did**
Replaced the four hand-rolled pill `Pressable`s in `invite-links-sheet.tsx` with the kit `Button` (`components/ui/button.tsx`), per the spec table:
- "Create invite link" → `variant="default" size="default" className="mt-3"`, `disabled={busy}`, busy text `Creating…` kept.
- "Revoke invite link …" → `variant="outline" size="sm" className="shrink-0"`, `disabled={revoking}`, busy text `Revoking…` kept.
- "Copy invite link" → `variant="default" size="default" className="flex-1"`, Copied/Copy text kept.
- "Share invite link" → `variant="outline" size="default" className="flex-1"`.
- Kept every `accessibilityLabel`, `disabled`, and `onPress`; dropped the old pill classes and the child `Text` colour/size classes (kit `TextClassContext` sets them); dropped `accessibilityRole="button"` since kit `Button` sets `role="button"` (T-0353 pattern).
- Left the "Done with invite link" text link as a `Pressable`, so `Pressable` stays in the import. Added the `Button` import.
- Tests, mocks only (`invite-links-sheet.test.tsx`): added `Platform.select`, a `react-native-reanimated` `useReducedMotion` mock, `TextClassContext` on the text mock, the `@/lib/depth` key exports, and a `@/components/ui/use-key-press` mock (needed because the test calls the views as plain functions, so the real `Button`'s hook would throw an invalid-hook-call — same reason as T-0353).

**Files changed**
- `apps/mobile/src/components/chat/invite-links-sheet.tsx` — four `Pressable`s now kit `Button`s; `Button` imported.
- `apps/mobile/src/components/chat/invite-links-sheet.test.tsx` — mocks only (see above).
- `work/T-0355-mobile-invite-links-buttons-kit.md` — status and this Report.

**Commands run and results**
- `pnpm install` (worktree) — succeeded (`Done in 15.8s`).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot invite-links-sheet` — `Test Files 1 passed (1)`, `Tests 12 passed (12)` (one intermediate run failed at import with the reanimated worklets error before the mocks were added).
- `pnpm gate` (repo root) — passed first try:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (17.7s)
  PASS  lint  (1.1s)
  PASS  typecheck  (8.7s)
  PASS  tests @zilar/mobile  (2.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviations from the spec:** none.

**Blocked / needs a decision:** none.

**Security checklist:** no secrets, routes, deletes, caps, permissions, or audit entries touched — UI button migration only; `disabled`/`busy` guards unchanged.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). Create and Copy are kit `Button`s left on the default variant, which is the accent. Revoke is `outline` `sm` with `shrink-0`, and Share is `outline` with `flex-1`. The lead grep found the labels and layout classes kept. The test changed mocks only.
