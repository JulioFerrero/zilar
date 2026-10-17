---
id: T-1779
title: "Topic people W1 (web): the topic header's second line becomes a ≤4 avatar stack + 'group · N', swapped for the writers' avatars + writingLabel + a pulsing dot while someone writes; the title shows only the topic name"
status: merged
milestone: M5
branch: task/T-1779-web-topic-header
model: auto
effort: default
depends_on: [T-1777]
estimate: 40 min
---

# T-1779: Web topic header with the people stack

## Spec (written by Claude, do not edit)

### Why
Julio asked for a less crowded top bar and showed what writing looks like (2026-10-16). He approved the boards:
- `docs/design/mockups/topic-people/WebTopic.dc.html:54-65`: the header;
- `PhoneHeader.dc.html`: the writing states;
- `README.md:20`.

This is plan item **W1** (`docs/plan/topic-people.md` §3.1).

### Facts (read by the lead on 2026-10-17)
- **The board's web header** (`WebTopic.dc.html:54-65`): a 64 px header with the topic avatar (36 px).
  - **Line 1** is the topic name only: `Financial`, 15px/600.
  - **Line 2** is a link to In this topic (`href="#in-this-topic"`). It holds a stack of up to 4 avatars (`.st` at `:22-24`: 20 px circles, a 2 px `#0a0a0a` ring, −6 px overlap), then `ai test · 5` in 12px `#a1a1a1`. The format is the group name · the number of people and AIs in the topic.
- **The writing states** (`PhoneHeader.dc.html:46-99`, wording `README.md:20`):
  - line 2 swaps to the writers' avatars, then `writingLabel(names)` (T-1777: "Deepseek is writing…", "JULITO, Deepseek writing…", "3 writing…"), then a 6 px pulsing dot (`.dot` at `PhoneHeader.dc.html:27`: `#ededed`, `box-shadow 0 0 0 3px rgba(237,237,237,.14)`);
  - the header height never changes.
- **Today's web header:** `apps/web/src/components/ChatHeader.tsx` (373 lines). The title is built at `:144-168`.
  - For a topic, line 1 shows `{groupTitle} ›` then the title (`:147-152`), plus the Globe and Lock icons.
  - Line 2 is a `role="status"` subtitle with `TypingDots` (`:162-168`), computed from `connection`, `aiLine`, `writing`, `typing` and `chatSubtitle` (`:63-80`).
- **The data (T-1777):**
  - `chat.topic.memberIds` and `chat.topic.ais` (`{ id, name, avatarUrl? }`) are on the topic row;
  - the group's people with pictures are `useChatSelector((s) => s.groupInfo(chat.id))` (`GroupDetail.members[]`: `userId`, `name`, `avatarUrl?`; `packages/api-contract/src/groups.ts:91-101`);
  - the writers' names are `s.typing[chat.id]?.names` (`ChatHeader.tsx:63`).
- **Avatars:** `apps/web/src/components/Avatar.tsx` (`seed`, `size`, `avatarUrl`). The seed is the **display name** (the orb-by-name rule, T-1334), and the real picture URL is passed when there is one.

### Steps
1. **A new `apps/web/src/components/topic/TopicPeopleLine.tsx`** (props: `chat`, `groupTitle`, `names`), drawn to the board:
   - **When nobody writes:** the stack (the first 4 of the topic's people, then its AIs, by `memberIds` and `topic.ais`, looking up names and pictures in `groupInfo`), then `{groupTitle} · {N}`, where N = `memberIds.length` + `ais.length`. General has no `memberIds` list, so use the group's people and AIs count.
   - **While someone writes:** the writers' avatars (up to 3, matched by display name to group people or topic AIs, with a neutral seed avatar when not found), then `writingLabel(names)`, then the pulsing dot. Use one `@keyframes` pulse and respect `prefers-reduced-motion`.
   - Line 2 must keep its height in both states.
2. **In `ChatHeader.tsx`, for topics only** (`isTopic`):
   - line 1 shows only `chat.title` (drop the `{groupTitle} ›` prefix) and keeps the Lock/Globe icon;
   - line 2 renders `TopicPeopleLine`, unless the connection line or an AI status line (`connection`, `aiLine`) must show, which wins as today.
   - Non-topic chats are unchanged.
   - Keep `ChatHeader.tsx` at most 400 lines; move any helper into the new file.
3. **A new Cosmos fixture,** `apps/web/src/components/topic/TopicPeopleLine.fixture.tsx`, with the four board states: idle with 5 people, one writer, two writers and three writers.
4. **No tests** (UI).

### Allowed files
- `apps/web/src/components/topic/TopicPeopleLine.tsx`
- `apps/web/src/components/topic/TopicPeopleLine.fixture.tsx`
- `apps/web/src/components/ChatHeader.tsx`
- `work/T-1779-web-topic-header.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- A topic's header on web shows the topic name, then the stack with `group · N`, and the writers with `writingLabel` and the dot while someone writes, as in the boards.
- Other chats are unchanged.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

**`apps/web/src/components/topic/TopicPeopleLine.tsx` (new, 169 lines).** The topic
header's second line, drawn to `WebTopic.dc.html:54-65` and `PhoneHeader.dc.html`:

- **Nobody writes:** an `<a href="#in-this-topic">` holding a ≤4 avatar stack
  (`STACK_MAX = 4`, 20 px `Avatar`s, `-ml-1.5` overlap, `ring-2
  ring-[var(--avatar-ring)]` like the board's `.st`) then `{groupTitle} · {N}` in
  12 px `text-muted-foreground`, where `N` is the topic's people plus its AIs.
- **Someone writes:** a `role="status"` span with the writers' avatars (≤3,
  `WRITERS_MAX`), `writingLabel(names)` (`@zilar/chat-core`, T-1777) and a 6 px
  pulsing dot. The dot reuses the existing `.pulse-dot` class (index.css'
  `@keyframes zilar-pulse`, `bg-foreground` + `shadow-[0_0_0_3px_rgba(237,237,237,0.14)]`);
  `index.css` already stops it under `prefers-reduced-motion: reduce`, so I did
  not touch that file (it is outside the Allowed files).
- Both states are `h-5`, so the 64 px header never moves.
- People come from `topic.memberIds` with names/pictures looked up in
  `useChatSelector((s) => s.groupInfo(chat.id))`; a member whose detail has not
  loaded yet falls back to its id as the orb seed. AIs come from `topic.ais`
  (already carrying `name`/`avatarUrl`). General has no `memberIds` list, so it
  uses the group's people and AIs. Avatars are built with `avatarIdentity`
  (T-1334, orb-by-name seed) + `Avatar`.
- Writers are matched by display name to the group's people or the topic's AIs;
  an unmatched name keeps its own name as the orb seed (neutral avatar, no
  picture).

**`apps/web/src/components/ChatHeader.tsx` (edited, 395 lines).** For topics only:
line 1 is now `chat.title` + the Lock/Globe icons (the `{groupTitle} ›` prefix is
gone); line 2 renders `TopicPeopleLine`, unless `connection` or `aiLine` is set,
which wins as before. Non-topic chats are unchanged. Because line 2 is a link,
the topic branch keeps the "open panel" button around line 1 only and renders
line 2 as its sibling (an `<a>` inside a `<button>` would be invalid HTML);
everything else is unchanged.

**`apps/web/src/components/topic/TopicPeopleLine.fixture.tsx` (new).** The four
board states: `IdleFive` (`ai test · 5`, stack of 4), `OneWriter`
("Deepseek is writing…"), `TwoWriters` ("JULITO, Deepseek writing…"),
`ThreeWriters` ("3 writing…"). Each state wraps the line in `AuthProvider
value={...}` + `ChatStoreProvider store={...}`, since the line reads `groupInfo`
from the store and Cosmos has no app providers; the store is a `createRealChatStore()`
with `groupInfos` seeded and is never started.

No test files (UI, as the spec says).

### Checks run

```bash
pnpm --filter @zilar/web typecheck   # tsc --noEmit: clean
pnpm gate                            # from the repo root
```

`pnpm gate` output (the tail):

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.1s)
PASS  lint  (0.6s)
PASS  typecheck  (1.0s)
PASS  effect  (0.4s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test file ran: no test file sits next to the changed sources and the
spec asks for no tests.

### Notes for the lead

- **Deviation (small):** the board's second line is an `<a href="#in-this-topic">`,
  but the app has no `id="in-this-topic"` target yet (that is W5's panel). I kept
  the anchor as drawn; today it only sets the URL hash. It is a plain `<a>`, not a
  react-router `Link`, so it does not navigate. To keep the HTML valid I moved the
  topic line 2 out of the header's panel button (line 1 still opens the panel).
  Say the word and I can make line 2 a plain span inside the button instead.
- **General counts:** per the spec, General's `N` and stack use `groupInfo`
  (people + AIs), so they read `0` until the group detail loads; a regular topic
  uses `topic.memberIds` / `topic.ais` and is right immediately.
- The line currently has no tests and only got a typecheck plus the gate; I did not
  render it in a browser (no Cosmos export run — the fixture was written but not
  visually verified by me).

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `ab7a25ce9`.
- **Cosmos screenshots** of `IdleFive` and `TwoWriters` compared with `WebTopic.dc.html:54-65` and the writing states of `PhoneHeader.dc.html`:
  - a 4-avatar stack, then "ai test · 5";
  - while writing, the writers' avatars, then "JULITO, Deepseek writing…", then the dot.
- **`ChatHeader`:** for topics, line 1 is the topic name only, and line 2 is `TopicPeopleLine` unless a connection or AI status line wins. Other chats are unchanged.
- **Three nits, left open:** writer matching by display name, and how the stack orders people and AIs.

