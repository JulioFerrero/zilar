---
id: T-2063
title: "Reduce (phone, batch 1): one UnreadBadge for the chat, group and topic rows; the chat screen's two non-topic branches (legacy group, channel) become one and its header/pinned-banner props are written once; save-photo and share-photo share one 'download to the cache' step — same screens"
status: merged
milestone: M5
branch: task/T-2063-phone-clones-one
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-2063: Phone clones, batch 1

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code and share components. The lead's jscpd run (2026-10-18) found these phone blocks copied.

### Facts (read by the lead on 2026-10-18 at `de4bdaa03`)
1. **Three unread badges.** These are the same component, with the same comment about a fresh view per look:
   - `UnreadBadge` in `apps/mobile/src/components/chat/chat-list-item.tsx:29-46` (183 lines);
   - `GroupUnreadBadge` in `apps/mobile/src/components/chat/group-list-item.tsx:17-35` (148 lines);
   - `TopicUnreadBadge` in `apps/mobile/src/components/chat/topic-row.tsx:26-44` (180 lines).

   They use `primaryKey` and `raisedPill` from `@/lib/depth`.
2. **The chat screen.** In `apps/mobile/src/app/chat/[id].tsx` (218 lines), these two branches render the same tree; only the `ChatComposerDock` `variant` differs:
   - `if (!isTopic)` (`:90-128`): the legacy group or DM, with variant `legacyComposer ? 'composer' : 'channel'`;
   - `if (!isTopic || chat.chatKind === 'channel')` (`:132-168`): the channel feed, with variant `channelBar ? 'channel' : 'composer'`.

   The tree is `ChatBackground`, `ChatHeaderBar`, `PinnedBanner` (with the same 9 props), `KeyboardAvoidingView` holding `ChatThread` and `ChatComposerDock`, then `ChatOverlays`. The topic branch (`:170-217`) repeats the same `ChatHeaderBar` base props and the same `PinnedBanner`.
3. **The photo download.** `apps/mobile/src/lib/save-photo.ts` (86 lines) and `apps/mobile/src/lib/share-photo.ts` (82 lines) do the same steps after their own permission or availability check (`save-photo.ts:53-71`, `share-photo.ts:47-65`):
   - make `new File(Paths.cache, cacheFileName(source.uri))`;
   - `File.downloadFileAsync(source.uri, destination, { idempotent: true, headers? })`;
   - a failure returns `FAILED`.

   `share-photo.ts` already imports `cacheFileName` and `deleteQuietly` from `save-photo.ts`.

### Steps
1. **The badge.** Create `apps/mobile/src/components/chat/unread-badge.tsx` exporting `UnreadBadge({ count, muted })`, with the comment kept. All three rows use it.
2. **The chat screen.**
   - Merge the two non-topic branches into one. The variant is `'channel'` for a channel, otherwise `legacyComposer ? 'composer' : 'channel'`; check this gives exactly today's variant for a DM, a legacy group and a channel.
   - Build the shared `ChatHeaderBar` base props and the `PinnedBanner` element once, and use them in both remaining branches.
3. **The download.** Add `downloadToCache(source): Effect<File | undefined>` to `save-photo.ts`, exported. Both files use it.
4. **No tests** (UI). Report the line counts; product lines must drop by at least 60. Each file stays at or under 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/unread-badge.tsx`
- `apps/mobile/src/components/chat/chat-list-item.tsx`
- `apps/mobile/src/components/chat/group-list-item.tsx`
- `apps/mobile/src/components/chat/topic-row.tsx`
- `apps/mobile/src/app/chat/[id].tsx`
- `apps/mobile/src/lib/save-photo.ts`
- `apps/mobile/src/lib/share-photo.ts`
- `work/T-2063-phone-clones-one.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and product lines are at least 60 lower.
- **Lead check, phone emulator mock:**
  - the chat list badges look the same;
  - a DM, a channel and a topic open with the right composer bar.

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/components/chat/unread-badge.tsx` with the one exported
  `UnreadBadge({ count, muted })`, keeping the "fresh view per look" comment and
  the gradient `key`. `ChatListItem`, `GroupListItem` and `TopicRow` now import
  it; the three local copies (`UnreadBadge`, `GroupUnreadBadge`,
  `TopicUnreadBadge`) are gone.
- `apps/mobile/src/app/chat/[id].tsx`: the two non-topic branches are now one
  (`if (!isTopic || chat.chatKind === 'channel')`). The composer variant is
  `'channel'` for a channel, otherwise `legacyComposer ? 'composer' : 'channel'`
  (with `legacyComposer = composerBarFor(chat) === 'composer'`). That keeps
  today's values: DM → `channel`, legacy group → `composer`, channel →
  `channel` (whether or not the channel's General topic makes `isTopic` true).
  The `ChatHeaderBar` base props (`headerProps`) and the `PinnedBanner` element
  (`pinnedBanner`) are built once; the topic branch adds only
  `topicGroupName`/`onOpenInfo`. All other topic internals (`TopicJoinView`,
  `AiStatusLine`, `TopicInfoHost`) are unchanged.
- `apps/mobile/src/lib/save-photo.ts`: added exported
  `downloadToCache(source: MediaSource): Effect.Effect<File | undefined>` (make
  the cache `File`, `File.downloadFileAsync` with `idempotent: true` and the
  source headers, failure → `undefined`). `saveEffect` and `shareEffect` both
  use it; `share-photo.ts` no longer imports `expo-file-system` or
  `cacheFileName`, only `deleteQuietly` and `downloadToCache`.

Files changed (all inside Allowed files):
`components/chat/unread-badge.tsx` (new), `components/chat/chat-list-item.tsx`,
`components/chat/group-list-item.tsx`, `components/chat/topic-row.tsx`,
`app/chat/[id].tsx`, `lib/save-photo.ts`, `lib/share-photo.ts`.

Line counts (`git show main:<file> | wc -l` vs `wc -l` after):

| File | Before | After |
| --- | ---: | ---: |
| chat-list-item.tsx | 183 | 162 |
| group-list-item.tsx | 148 | 126 |
| topic-row.tsx | 180 | 159 |
| app/chat/[id].tsx | 218 | 164 |
| save-photo.ts | 86 | 93 |
| share-photo.ts | 82 | 67 |
| unread-badge.tsx | — | 27 |

Product total: 897 → 798 lines, a drop of 99 (new file included); every file
stays under 400 lines.

### Checks run

- `pnpm install`: completed successfully.
- `pnpm gate` (repo root), last lines:

```text
gate: 8 changed file(s) against main
PASS  install (frozen)  (2.8s)
PASS  format  (0.9s)
PASS  lint  (1.2s)
PASS  typecheck  (5.1s)
PASS  effect  (2.4s)
SKIP build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/mobile  (5.0s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- No single test files were run: the spec says no tests (UI), and `pnpm gate`
  ran the mobile package's tests.

### Notes for the lead

- I did not run the phone emulator, so the visual/composer smoke check is still
  yours. The variant table above is from reading `composerBarFor` and the two
  old branches, not from a device run.
- `chat-list-item.tsx` keeps `primaryKey`/`raisedPill` for the hand-set unread
  mark dot, which stays local as before.


## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** One `UnreadBadge`, one non-topic branch in the chat screen with its header and pinned-banner props written once, and one `downloadToCache` for save and share photo.
- **Size.** −99 product lines.
- **Lead emulator check** (mock build at `ea6a1b885`): `phone:smoke` passed on `/`, the Ana DM (composer), the Acme channel (owner composer) and the Viernes topic (composer). Screens rendered as before, with no crash.
- **Not checked:** the badge pixels, because no mock chat is unread.
