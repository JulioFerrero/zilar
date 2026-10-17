---
id: T-1788
title: "Topic people W4 (phone): the @ list offers only the topic's people and AIs; after sending, a mention of someone not in the topic shows the sender a centred 'X isn't in Topic' row with an Add key"
status: merged
milestone: M5
branch: task/T-1788-phone-topic-mentions
model: auto
effort: default
depends_on: [T-1783]
estimate: 40 min
---

# T-1788: Phone @ list filtered to the topic, plus the "isn't in" row

## Spec (written by Claude, do not edit)

### Why
This is the phone twin of T-1783 (merged), plan **W4** (`docs/plan/topic-people.md` §3.2, §3.3 and §4). The approved board is `docs/design/mockups/topic-people/Main.dc.html:55-59`, the phone topic with the row.

### Facts (read by the lead on 2026-10-17)
- **The shared helper (T-1783):** `mentionInTopic(topic, jid, aiIdByJid)` in `packages/chat-core/src/topics.ts`, exported from `@zilar/chat-core`.
  - General and a topic without `memberIds` return `true`.
  - An AI is matched by `aiIdByJid` (jid → `aiId` from the group detail's `ais[]`). Anyone else is a person, matched by the jid's localpart against `memberIds`.
- **The web twin, to copy its behaviour:**
  - `apps/web/src/components/Composer.tsx`: `surfaceNotInTopic` builds the not-in list after a send, dedupes by jid, and looks up the AI or the person in the group detail for the id and the picture;
  - `apps/web/src/components/topic/TopicNotInRow.tsx`: the row (22 px avatar, `{name} isn't in {topic}` at 14 px `#a1a1a1`, a light Add key, busy and "Couldn't add" states; radius 14, `#141414`, a `#232323` border, padding 6 6 6 12, gap 10).
- **The phone candidates:** `apps/mobile/src/components/chat/chat-composer-dock.tsx` (197 lines) builds `mentionMembers` at `:76-85` from `groupMembers(mentionChatId)` (the whole group). The group detail is `groupDetailForMentions` (`:72-74`), with `ais[].aiId/jid/avatarUrl` and `members[].userId/avatarUrl`.
- **The send:** `sendTextNow(text, mentions?)` at `:115-127` sends the composer's tracked mentions.
- **The render:** `<AiStatusLine chat={chat} />` then `<Composer …/>` at `:160-177`.
- **The adds:** `useChatStore((state) => state.addTopicAi)` and `addTopicMember` (`apps/mobile/src/store/types-groups.ts:86,90`). Since T-1769 the server adds the group half first.

### Steps
1. **`chat-composer-dock.tsx`:** when `chat.topic` is set, filter `mentionMembers` with `mentionInTopic`. Build `aiIdByJid` from `groupDetailForMentions?.ais`. Other chats are unchanged.
2. **A new `apps/mobile/src/components/chat/topic-not-in-row.tsx`,** drawn like the web row at phone sizes (15 px text, a 40 px Add key per `docs/design/mockups/blocks/README.md:24`). Seed the avatar with the display name and pass the real picture when there is one.
3. **The not-in list, after a send in a topic:**
   - compute it in `sendTextNow`, the same way as web;
   - keep it in state and render the rows, centred, between `AiStatusLine` and `Composer`;
   - Add calls `addTopicAi` or `addTopicMember`, and a success removes the row;
   - clear the list on a chat switch (`chat.id` change) and replace it on the next send.
   - If `chat-composer-dock.tsx` would pass 400 lines, put the list logic in a new `apps/mobile/src/components/chat/use-topic-not-in.ts` hook.
4. **No tests.**

### Allowed files
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`
- `apps/mobile/src/components/chat/topic-not-in-row.tsx`
- `apps/mobile/src/components/chat/use-topic-not-in.ts`
- `work/T-1788-phone-topic-mentions.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In a topic on the phone, @ offers only its people and AIs.
- Mentioning someone outside the topic shows the sender the board's row, and Add puts them in.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`:
  - When `chat.topic` is set, `mentionMembers` (the `@` picker candidates) is now
    filtered with `mentionInTopic(topic, member.jid, aiIdByJid)`, building
    `aiIdByJid` from `groupDetailForMentions?.ais`. Other chats are unchanged.
  - `sendTextNow` now calls `surfaceNotInTopic(mentions ?? [])`, which builds the
    not-in list exactly like web's T-1783 (`apps/web/src/components/Composer.tsx`):
    deduped by jid, name + picture looked up in the group detail, AI matched by
    `aiIdByJid`, person matched by the jid localpart against `members[].userId`.
  - The list is held in `notInTopic` state, cleared on a `chat.id` change
    (`useEffect`) and replaced on the next send.
  - The rows render centred between `AiStatusLine` and `Composer` (composer
    variant only). Add calls `addTopicAi`/`addTopicMember`; a success removes
    the row.
- `apps/mobile/src/components/chat/topic-not-in-row.tsx` (new): `TopicNotIn`,
  `TopicNotInRow` (22 px avatar seeded from the display name, 15 px `#a1a1a1`
  text, light Add key = the `Button` primary key at 40 px / 12 px radius, busy
  "Adding…" and muted "Couldn't add") and `AddToTopicRow` (per-row Add call via
  `useAction` + `Effect.tryPromise`, mirroring web's `AddToTopicRow`).
- No new hook file: `chat-composer-dock.tsx` is 303 lines, under the 400-line
  threshold the spec sets, so the optional `use-topic-not-in.ts` was not needed.

### Checks run
- `pnpm install`: done, 1151 packages, no errors.
- `pnpm gate` (first run): `FAIL format` — Prettier wanted to reflow two files.
  Fixed with `pnpm exec prettier --write <the two files>`, then re-ran.
- `pnpm gate` (second run): `FAIL effect` — the new `.then(` in the row tripped
  the H1 Effect ratchet. Fixed by switching the Add call to
  `useAction` + `Effect.tryPromise` (the web pattern).
- `pnpm gate` (final run):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/mobile  (1.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run by hand: this is UI code and the spec says "No
  tests"; the gate's nearest mobile tests passed.

### Notes for the lead
- Files changed: `chat-composer-dock.tsx` (modified),
  `topic-not-in-row.tsx` (new), plus this task file. Nothing outside the Allowed
  files.
- Deviations: none from the spec. The only judgement call was keeping the list
  logic in the dock instead of the optional hook (it stays under 400 lines).
- Not verified by me (UI, needs a device): I did not run the phone app, so the
  acceptance lines "the `@` list offers only the topic's people and AIs" and
  "Add puts them in" are implemented to match web's T-1783 but were not
  exercised live. Typecheck, lint, format, effect ratchet and the mobile tests
  pass.
- The row reuses `Avatar` with `seed={name}` (matching web) and the raw
  `avatarUrl` from the group detail; `Avatar` already resolves relative
  `/api/avatars/...` URLs against the API origin on native.

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `b8f6d9527`.
- **The dock:**
  - it filters `mentionMembers` with the shared `mentionInTopic`, with `aiIdByJid` built from the group detail (`aiId`);
  - after a send it lists the mentions outside the topic, deduplicated by jid, using the same lookup as web;
  - `topic-not-in-row.tsx` draws the row, and Add calls `addTopicAi` or `addTopicMember`.
- **Nit 1, left open:** on a cold open the filter waits for the group detail, and the candidate list is empty until then anyway.
- **The emulator check is still to do** (Julio is at the PC this morning).

