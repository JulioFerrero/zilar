---
id: T-0362
title: "Mobile kit migration: the contact profile card, the Profile tab and the channel screen use the kit Button"
status: todo
milestone: M5
branch: task/T-0362-mobile-profile-card-channel-buttons-kit
model: auto
effort: low
depends_on: [T-0356]
estimate: 0.3 day
---

# T-0362: profile card, Profile tab and channel buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343 to T-0355, for three more screens.

### Verified facts (do not re-derive)
- **The `Pressable`s to migrate** (the line is the `<Pressable`; the label is its `accessibilityLabel`):
  - `apps/mobile/src/components/contacts/profile-card.tsx`: 180 "Unblock", 198 "Message", 213 "Cancel…", 225 "Accept", 236 "Decline", 245 "Open…", 257 "Cancel…", 268 "Send…", 299 "Cancel…"
  - `apps/mobile/src/components/profile/profile-view.tsx`: 218 "Save…"
  - `apps/mobile/src/components/chat/channel-screen.tsx`: 269 `` `Demote…` ``, 288 `` `Promote…` ``, 307 "Invite…", 316 "Leave…"
- **Leave alone:** the Ban icon on the red button at `profile-card.tsx:294`. It stays white on purpose, but if its `Pressable` is a text pill, migrate it with `destructive` and keep the icon.
- **Variant rule,** taken from each `Pressable`'s current look:
  - `bg-accent` → `default`;
  - `border border-border-strong` → `outline`;
  - plain (`active:bg-surface-raised`, no fill) → `ghost`;
  - `bg-destructive` → `destructive`.

  Size is `default`, or `sm` for small `py-1`/`py-1.5` pills. Keep layout classes (`mt-*`, `self-start`, `flex-1`, `w-full`, `shrink-0`) as `className`.
- **Labels:** every label must be inside `<Text>…</Text>`. A bare string child renders nothing on device; T-0349 shipped blank buttons this way. Icons inside a `default` button use `ACCENT_FOREGROUND[scheme]`.
- **Tests that reach these files** (the lead grepped importers: `app/u/[handle].tsx`, `components/contacts/people-search-result.tsx` → `app/(tabs)/index.tsx`, `app/(tabs)/profile.tsx`, `app/group/[id].tsx`, and none of them has a test):
  - `apps/mobile/src/components/contacts/contacts.test.tsx`, `apps/mobile/src/components/contacts/people-search.test.ts` and `apps/mobile/src/components/profile/profile-view.test.tsx`;
  - no test reaches `channel-screen.tsx`.
  - Add mocks only, as in T-0353 and T-0355: `Platform.select`, reanimated `useReducedMotion`, `TextClassContext`, the `@/lib/depth` key exports, and `@/components/ui/use-key-press` when a test calls a body as a plain function or forces `useState` in order.

### What to build
1. Replace the fourteen `Pressable`s with the kit `Button` (`apps/mobile/src/components/ui/button.tsx`), using the variant rule. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text and busy text, each inside `<Text>`;
   - the icons.

   Drop the old pill classes and the child `Text` colour and size classes.
2. Import `Button`. Remove `Pressable` from an import only if it becomes unused.
3. Tests: mock changes only.
4. In the Report, list each button with its variant and size.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `work/T-0355-mobile-invite-links-buttons-kit.md` (Report), `work/T-0356-mobile-profile-button-labels.md`, `apps/mobile/src/components/ui/button.tsx`, the three files and the tests.

### Allowed files
`apps/mobile/src/components/contacts/profile-card.tsx`, `apps/mobile/src/components/profile/profile-view.tsx`, `apps/mobile/src/components/chat/channel-screen.tsx`; mocks only: `apps/mobile/src/components/contacts/contacts.test.tsx`, `apps/mobile/src/components/contacts/people-search.test.ts`, `apps/mobile/src/components/profile/profile-view.test.tsx`; and `work/T-0362-mobile-profile-card-channel-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot contacts people-search profile-view
pnpm gate
```

### Acceptance
- The fourteen `Pressable`s render through `Button`, with every label inside `<Text>`.
- Tests pass, with mock changes only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
