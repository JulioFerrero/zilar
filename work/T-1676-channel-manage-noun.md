---
id: T-1676
title: "Phone: channel manage errors say 'channel', not 'group' — useGroupManage takes a noun ('group' | 'channel'), and the channel screen passes 'channel' (NOW.md phone follow-up: a failed channel delete says 'group')"
status: merged
milestone: M5
branch: task/T-1676-channel-manage-noun
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1676: Channel errors name the channel

## Spec (written by Claude, do not edit)

### Why
A failed delete in a channel's More menu on the phone says "Could not delete the group." (`work/NOW.md`, phone follow-ups). The channel screen reuses the group manage hook, whose texts hard-code "group".

### Facts (the lead read them on 2026-10-16)
- **`apps/mobile/src/components/chat/group-manage-section.tsx`:** `useGroupManage(input: { groupId; groupChatId; isOwner })` (`:44-91`) has three fallback texts:
  - `'Could not leave the group.'` (`:75`);
  - `'Could not hand over the group.'` (`:81`);
  - `'Could not delete the group.'` (`:87`).
- **`apps/mobile/src/components/chat/channel-screen.tsx:160`:** `const manage = useGroupManage({ groupId, groupChatId: feedId, isOwner });`. Its `manage.error` shows in `ChannelMoreMenu` (`:311-318`).
- **The group callers** stay as they are (`apps/mobile/src/components/chat/group-roles-sheet.tsx` renders `GroupManageSection`; find where it calls `useGroupManage` and leave it on the default).

### Steps
1. **`useGroupManage`** takes an optional `noun?: 'group' | 'channel'` (default `'group'`), and the three texts use it (`` `Could not delete the ${noun}.` `` and so on).
2. **`channel-screen.tsx`** passes `noun: 'channel'`.
3. **No other change, no tests** (UI copy).

### Allowed files
- `apps/mobile/src/components/chat/group-manage-section.tsx`
- `apps/mobile/src/components/chat/channel-screen.tsx`
- `work/T-1676-channel-manage-noun.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A failed channel delete says "Could not delete the channel."**
- **Groups keep their texts.**

---

## Report (written by the worker when done)

### What I did

- `apps/mobile/src/components/chat/group-manage-section.tsx`: `useGroupManage` now takes an
  optional `noun?: 'group' | 'channel'` on its input (default `'group'` via
  `const noun = input.noun ?? 'group'`). The three fallback texts are template literals:
  `` `Could not leave the ${noun}.` ``, `` `Could not hand over the ${noun}.` `` and
  `` `Could not delete the ${noun}.` ``.
- `apps/mobile/src/components/chat/channel-screen.tsx:160`: passes `noun: 'channel'`.
- The group caller (`apps/mobile/src/app/group-info/[id].tsx:85`) is untouched, so it keeps the
  default `'group'` texts. (The spec pointed at `group-roles-sheet.tsx`, but the actual
  `useGroupManage` caller is `group-info/[id].tsx`; `group-roles-sheet.tsx` only renders
  `GroupManageSection`. I left the real group caller on the default, as instructed.)

### Checks run

- `pnpm install` — done, 21.9s, no errors.
- `pnpm gate` — GATE PASS. Summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.2s)
  PASS  format  (1.3s)
  PASS  lint  (2.5s)
  PASS  typecheck  (6.4s)
  PASS  effect  (2.2s)
  PASS  tests @zilar/mobile  (3.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  No files outside the Allowed files were changed. No separate single test run was needed
  (UI copy only, no tests per the spec).

### Notes for the lead

- No deviations from the spec other than the caller location noted above (the spec's
  "group-roles-sheet.tsx" reference; the group caller is actually `group-info/[id].tsx`).
- Acceptance: a failed channel delete now says "Could not delete the channel."; groups keep
  their texts.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits.
- **The change:** `useGroupManage` takes `noun` (default `'group'`), and the channel screen passes `'channel'`.
- **Spec slip:** the spec pointed at the wrong group caller; the worker found the real one (`group-info/[id].tsx`) and left it on the default. The NOW.md phone follow-up is closed.

