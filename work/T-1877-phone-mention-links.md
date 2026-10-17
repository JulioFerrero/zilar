---
id: T-1877
title: "Phone: tapping an @mention chip in a message opens that person like their avatar does (T-1859's person routing: the DM for a contact or your own AI, /u/<handle> otherwise); a chip of you stays plain; a long hold still opens the message menu"
status: merged
milestone: M5
branch: task/T-1877-phone-mention-links
model: auto
effort: default
depends_on: [T-1859]
estimate: 25 min
---

# T-1877: @mention chips open the person (phone)

## Spec (written by Claude, do not edit)

### Why
**This is the phone twin of web T-1861** (merged and live; I tapped a live @Deepseek chip and it opened the Deepseek chat), part of Julio's easy-life pass (2026-10-17). T-1859 made avatars and names open the person on the phone, but mention chips are still plain text.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/chat/link-text.tsx`** (124 lines):
  - the mention branch (`:59-72`) renders a nested `RNText` chip. Its style comes from `mine = !outgoing && isMentionOfMe(segment.jid, meJid)`;
  - links in the same component use `onPress` on a nested `RNText` (`:74-86`). A nested `Text` can't be wrapped in a `Pressable`, so the chip must use `onPress` too.
- **From T-1859:**
  - `apps/mobile/src/components/chat/person-pressable.tsx` reads `contacts`, `chats` and `currentUserId` from `useChatStore`, computes `personTarget(target, ctx)` (`apps/mobile/src/lib/person-link.ts`), and pushes the route with `router.push(route)`;
  - it forwards the bubble's long-press with `useOpenMessageMenu()` and `LONG_PRESS_MS`;
  - `personTarget` already ignores occupant JIDs (`/`) and group chats.

### Steps
1. **`person-pressable.tsx`:** extract `export function usePersonRoute(target: PersonTarget): PersonLinkRoute | undefined` (the three store reads plus `personTarget`), and use it inside `PersonPressable`. No behaviour change.
2. **New `apps/mobile/src/components/chat/mention-text.tsx`:** `MentionText({ jid, text, style })`.
   - It calls `usePersonRoute({ jid })` and renders the same nested `RNText`.
   - With a route, it adds `onPress={() => router.push(route)}`, plus `onLongPress` that forwards `useOpenMessageMenu()` when present, and `accessibilityRole="link"`.
3. **`link-text.tsx`:** in the mention branch, render a plain `RNText` when `mine` (unchanged), else `<MentionText>` with the same style object.
4. **No tests** (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/person-pressable.tsx`
- `apps/mobile/src/components/chat/mention-text.tsx`
- `apps/mobile/src/components/chat/link-text.tsx`
- `work/T-1877-phone-mention-links.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Tapping @Dev-1** in a message opens Dev-1's chat.
- **A chip of an unknown person** stays plain.
- **A chip of me** looks and acts as before.
- **A long hold on a chip** still opens the message menu.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `person-pressable.tsx`: extracted `usePersonRoute(target)`, which reads
  `contacts`, `chats` and `currentUserId` from `useChatStore` and returns
  `personTarget(...)`. `PersonPressable` now calls the hook; behaviour is
  unchanged.
- New `mention-text.tsx`: `MentionText({ jid, text, style })` calls
  `usePersonRoute({ jid })` and renders the nested `RNText` chip. With a route
  it adds `accessibilityRole="link"`, `onPress={() => router.push(route)}`, and
  (when a menu context exists) `onLongPress` forwarding `useOpenMessageMenu()`
  with `delayLongPress={LONG_PRESS_MS}`, matching `PersonPressable`. Without a
  route it renders the plain nested `RNText`, so unknown people and the long
  hold behave as before.
- `link-text.tsx`: the mention branch now builds one style object and renders a
  plain `RNText` when `mine` (unchanged look and behaviour), otherwise
  `<MentionText>` with that same style.

### Checks run
- `pnpm install --frozen-lockfile`: done, no errors.
- No single test files: this is UI-only (spec says no tests) and the gate's
  nearest tests cover the mobile package.
- `pnpm gate` from the repo root ended with:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (2.4s)
  PASS  format  (2.6s)
  PASS  lint  (3.9s)
  PASS  typecheck  (10.4s)
  PASS  effect  (1.5s)
  PASS  tests @zilar/mobile  (2.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (The first gate attempt failed only on Prettier formatting in
  `person-pressable.tsx`; I ran `prettier --write` on the three touched files
  and the second run passed.)

### Notes for the lead
- Not tested on a device: taps, unknown chips and long holds were not exercised
  live; the gate (typecheck/lint/format/tests) passes. Verification against the
  Acceptance list needs the phone smoke.
- Following the spec literally, only `mine` chips stay plain `RNText`; a chip of
  another person in an *outgoing* message is now tappable as well.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `f481045b0`.
- **The code:**
  - `usePersonRoute` was extracted from `PersonPressable` with no behaviour change;
  - `MentionText` keeps the chip's exact style, and only adds `onPress`, the link role and the forwarded long hold when a route exists;
  - a chip of me is unchanged.
- **Not checked on the emulator:** the phone mock's messages carry no mention ranges (the "@QA-1" text is plain), so there's no chip to tap. The live tap check is for the next APK (NOW.md).

