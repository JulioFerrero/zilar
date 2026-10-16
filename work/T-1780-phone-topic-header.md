---
id: T-1780
title: "Topic people W2 (phone): the topic header becomes two lines — the topic name, then a ≤4 avatar stack + 'group · N', swapped for the writers + writingLabel + a pulsing dot while someone writes"
status: merged
milestone: M5
branch: task/T-1780-phone-topic-header
model: auto
effort: default
depends_on: [T-1777]
estimate: 40 min
---

# T-1780: Phone topic header with the people stack

## Spec (written by Claude, do not edit)

### Why
This is the phone twin of T-1779 (plan **W2**, `docs/plan/topic-people.md` §3.1). The approved board is `docs/design/mockups/topic-people/PhoneHeader.dc.html` (390 px wide, its four states).

### Facts (read by the lead on 2026-10-17)
- **The board** (`PhoneHeader.dc.html`):
  - **Line 1** is the topic name, 17px/600 (`.title` at `:28`).
  - **Line 2** is a stack of 22 px circles (`.st` at `:18-20`: a 2 px `#0a0a0a` ring, −7 px overlap), then `ai test · 5` in 13px `#a1a1a1` (`.sub` at `:29`).
  - **The writing states** (`:46-99`): the writers' avatars, then `Deepseek is writing…`, `JULITO, Deepseek writing…` or `3 writing…`, then a 6 px pulsing dot (`.dot` at `:27`).
  - The title never moves.
- **Today's phone header:** `apps/mobile/src/components/chat/chat-header.tsx` (241 lines). For a topic, the title block (`:113-168`) has **three** lines:
  - the group name (11px, pressable, opens the group through `onOpenGroup`, `:118-136`);
  - the title plus the Private chip;
  - the subtitle with `TypingDots` (`:161-168`), computed at `:89-104`.
- **The data (T-1777):** `chat.topic.memberIds`, `chat.topic.ais` and `writingLabel` from `@zilar/chat-core`. The group's people come from `useChatStore((state) => state.groupDetail(groupId))` (used the same way in `chat-composer-dock.tsx:73`).
- **Avatars:** `apps/mobile/src/components/chat/avatar.tsx` (`Avatar`). The seed is the display name (T-1334), and the real picture URL is passed when there is one.

### Steps
1. **A new `apps/mobile/src/components/chat/topic-people-line.tsx`,** drawn to the phone board:
   - **When nobody writes:** the stack (up to 4: the topic's people, then its AIs), then `{groupName} · {N}`. The group name stays pressable and opens the group (keep today's `onOpenGroup` and `hitSlop` behaviour).
   - **While someone writes:** the writers' avatars, then `writingLabel(names)`, then a pulsing 6 px dot (Reanimated, or the `Animated` the codebase already uses; respect reduce-motion).
   - The line keeps a fixed height.
2. **In `chat-header.tsx`, for topics only:**
   - two lines: the title (17px/600, with the Private chip as today), then `TopicPeopleLine`;
   - drop the separate 11px group-name line, since its link moves into line 2;
   - the connection line or an AI status line still wins over line 2, as today;
   - other chats are unchanged.
3. **A dev catalog entry:** append the four board states to the hidden catalog. Use a new `apps/mobile/src/mock/dev-topic-header-screen.tsx` and route `apps/mobile/src/app/dev/topic-header.tsx`, copying the `dev/blocks` route pattern (`__DEV__` only, `RequireAuth`).
4. **No tests.** Keep every file at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/topic-people-line.tsx`
- `apps/mobile/src/components/chat/chat-header.tsx`
- `apps/mobile/src/mock/dev-topic-header-screen.tsx`
- `apps/mobile/src/app/dev/topic-header.tsx`
- `work/T-1780-phone-topic-header.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- A topic's header on the phone has two lines like the board, with the stack and `group · N`, and the writers while someone writes.
- The group link still works.
- Other chats are unchanged.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **`apps/mobile/src/components/chat/topic-people-line.tsx` (new, 187 lines).** The
  phone board's second line. Props `people`, `ais`, `count`, `writers`, `groupName`,
  `onOpenGroup`. With no writers: up to four overlapping 22 px circles (2 px
  `palette.surface` ring, −7 px overlap) in the order people then AIs, then
  `{groupName} · {N}`; the group name is a `Pressable` with the old
  `hitSlop={{ top: 6, bottom: 4 }}` and `onOpenGroup` behaviour (plain text when the
  screen wires no group target). While writers exist: the writers' avatars (matched to
  a person/AI by display name for their picture, name-seeded ball otherwise), then
  `writingLabel(writers)` in `#d4d4d4`, then a 6 px `Animated` pulsing dot. The dot
  stops at full opacity under `useReducedMotion`, the way `ai-activity-marks.tsx`
  does. The row is a fixed `h-[22px]`, so the header height never changes.
- **`apps/mobile/src/components/chat/chat-header.tsx` (288 lines).** For topics only:
  dropped the separate 11 px group-name line, moved its link into line 2, bumped the
  title to 17 px/600 with a 3 px gap between the two lines, and put `TopicPeopleLine`
  in place of the subtitle. `connectionLabel(status)` and an AI status line still win
  over line 2 (unchanged condition), so the old subtitle + `TypingDots` path renders
  in that case. The people come from `chat.topic.memberIds` joined to
  `useChatStore((state) => state.groupDetail(topicGroupId))` (with `groupIdForChat` for
  legacy rows, the `chat-composer-dock.tsx` read) and `chat.topic.ais`; N is
  `memberIds.length + ais.length`, falling back to `chat.memberCount` when the topic row
  carries neither (an older server). Other chats keep the 15 px title, no gap, and the
  same subtitle line.
- **`apps/mobile/src/mock/dev-topic-header-screen.tsx` (new, 113 lines)** and
  **`apps/mobile/src/app/dev/topic-header.tsx` (new, 19 lines).** The hidden catalog
  (`zilar://dev/topic-header`), copying `dev/blocks` (`__DEV__` route + `RequireAuth`
  screen). It renders the board's four states (nobody writing, one, two, three or more)
  as a small header preview around `TopicPeopleLine` with the board's sample data
  (`ai test · 5`, writers `Deepseek` / `JULITO, Deepseek` / 3).

### Checks run
`pnpm gate` (final run):
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.7s)
PASS  lint  (1.4s)
PASS  typecheck  (4.3s)
PASS  effect  (1.0s)
PASS  tests @zilar/mobile  (4.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
No single test file was run (the spec says "No tests"; UI code). The first `pnpm gate`
run failed only on `format` for `chat-header.tsx` and `dev-topic-header-screen.tsx`; I
fixed it with `pnpm exec prettier --write` on those two files, after which the gate
passed as above.

Files changed (all inside the Allowed files):
- `apps/mobile/src/components/chat/topic-people-line.tsx` (new)
- `apps/mobile/src/components/chat/chat-header.tsx`
- `apps/mobile/src/mock/dev-topic-header-screen.tsx` (new)
- `apps/mobile/src/app/dev/topic-header.tsx` (new)
- `work/T-1780-phone-topic-header.md`

### Notes for the lead
- **The 17 px title is topic-only**, per "for topics only … other chats are unchanged":
  a DM/group/AI chat keeps its 15 px title and the old spacing, so no other header moves.
- **`TopicPeopleLine` takes its data as props** (not reading the store itself), so the
  same component drives both `chat-header.tsx` and the dev catalog's four board states;
  `chat-header.tsx` does the `memberIds` → group-detail join.
- The overlap ring is `palette.surface` (the header's real `#111111`), not the board
  literal `#0a0a0a`, so the circles separate against the surface they sit on.
- The catalog draws a small local header preview rather than the real `ChatHeader`: a
  dev route has no topic `GroupDetail` in the store, so `ChatHeader` would show an empty
  stack. `Avatar`, `IconButton` and the header's own classes are reused for the chrome.
- Not verified on device (no simulator run): the pulsing dot, reduce-motion and the
  on-device truncation of `group · N` are read from the code, not seen live.
- Security checklist: no data, network, permission or logging change in this task; the
  files only read data the screens already hold.

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `f75dd806b`.
- **The header:** for a topic it has two lines, the 17 px title then `TopicPeopleLine`.
- **The stack:** up to 4, people from `memberIds` looked up in the group detail, then the topic's AIs.
- **The writing state:** the writers, `writingLabel` and a pulsing dot. The pulse is off under reduce-motion.
- **Height:** line 2 is a fixed 22 px, so the header never jumps.
- **Nit, left open:** an empty `groupTitle` shows a bare count.
- **The emulator check of `zilar://dev/topic-header` is still to do** (tonight, with the other phone screens).

