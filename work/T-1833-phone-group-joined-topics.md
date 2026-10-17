---
id: T-1833
title: "Phone group screen lists only the topics you're in (General plus joined ones), like web's sidebar after T-1829; topics you haven't joined stay under Group info › Other topics with Join"
status: merged
milestone: M5
branch: task/T-1833-phone-group-joined-topics
model: auto
effort: default
depends_on: [T-1829]
estimate: 15 min
---

# T-1833: The phone group screen lists your topics only

## Spec (written by Claude, do not edit)

### Why
T-1829 keeps a topic you haven't joined out of web's sidebar and the phone chat list, where a group is one row.
- **The gap:** the phone group screen (`/group/<id>`, the group's topic list) still lists every topic. The lead's phone smoke of main on 2026-10-17 showed "Dev team · 6 members, 7 topics" with Ideas and Release 2.4 notes, which `u-you` hasn't joined.
- **Where those belong:** under Group info › Other topics with Join (W8), so the topic list should show only joined topics, as web's sidebar does.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/app/group/[id].tsx`** (326 lines):
  - `topics = topicsOfGroup(chats, groupId)` (`:82`) also feeds the General lookup (`:83-85`), the create check (`:115`) and the channel-feed detection (`:203-206`). Keep those on the full list.
  - `splitGroupTopics(topics)` (`:92-95`) gives `activeTopics` and `archivedTopics`, which feed the header's `topicCount: activeTopics.length` (`:232`) and the list (`:250-251`).
  - `currentUserId` comes from the store (`:62`).
- **`isUnjoinedTopic(topic, userId)`** (T-1829, `packages/chat-core/src/topics.ts`) is true only for a known, non-General topic the user isn't in. An unknown member list or an empty user id shows the topic.

### Steps
1. In `[id].tsx`, call `splitGroupTopics` on `topics.filter((chat) => !isUnjoinedTopic(chat.topic, currentUserId))`, with `currentUserId` in the memo deps. Everything else keeps using the full `topics`.
2. **No tests** (UI). Keep the file at most 400 lines.

### Allowed files
- `apps/mobile/src/app/group/[id].tsx`
- `work/T-1833-phone-group-joined-topics.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In the phone mock build, `/group/g-devteam` lists General, Checkout, Daily standup, Hiring and New pricing page, and the header says "5 topics".
- Group info still shows Ideas under Other topics.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `apps/mobile/src/app/group/[id].tsx`: the topic list now hides topics the viewer hasn't joined. `splitGroupTopics` runs on `topics.filter((chat) => !isUnjoinedTopic(chat.topic, currentUserId))`, with `currentUserId` in the memo deps. Everything else (General lookup, `groupChatId`, create gate, empty-list/channel detection) still uses the full `topics`, as the spec says.
- Imported `isUnjoinedTopic` from `@zilar/chat-core` (same helper web and the phone chat list use).
- File is 330 lines, under the 400 cap. No tests added (UI-only change, per the spec).

Files changed:
- `apps/mobile/src/app/group/[id].tsx`
- `work/T-1833-phone-group-joined-topics.md`

### Checks run

- `pnpm install --frozen-lockfile`: Done in 10.6s.
- `pnpm gate` from the repo root: exit 0, summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.7s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.8s)
  PASS  effect  (1.9s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the change is UI-only and no test covers this screen / the gate skipped mobile tests (no nearby files).

Acceptance notes (verified in mock seed, not by running the phone build):
- `packages/mock-backend/src/domains/topics/seed.ts` gives `g-devteam` 7 topics; "Ideas" and "Release 2.4 notes" use `devTeamMemberIdsWithoutYou`, so `u-you` isn't in them.
- The other five (General, Checkout, Daily standup, New pricing page, Hiring) are joined and not archived, so the screen should list five and the header should read "5 topics".
- Group info keeps its own topic list fed by the full data, so Ideas stays under Other topics (untouched by this change).

### Notes for the lead

- The filter runs only for the list/header; the unjoined-channel edge case is unchanged because channel detection still reads the full `topics`.
- No deviations from the spec.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `89ecf484f`.
- **The list and the header** take `topics` filtered by `!isUnjoinedTopic(chat.topic, currentUserId)`. The General lookup, create gate and channel detection keep the full list.
- **The lead runs** a phone mock smoke of main after this merge.

