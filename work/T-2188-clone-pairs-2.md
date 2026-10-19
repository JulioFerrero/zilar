---
id: T-2188
title: "Clean-up (all apps, wave 2): blocks copied between two files of the same app or package get one home; no behaviour change"
status: merged
milestone: M5
branch: task/T-2188-clone-pairs-2
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2188: One home for blocks copied between files (all apps, wave 2)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead ran a clone scan at `50efd48ab` that finds runs of 8 or more normalised lines shared by two files (comments, blanks, imports and lone braces ignored). Each row below is a pair of files with the copied ranges. A row with no ranges is a pair whose files share several small blocks; read both files to find them.

| Copy A | Copy B |
| --- | --- |
| `packages/api-contract/src/chat-folders.ts` | `packages/chat-core/src/folders.ts` |
| `apps/web/src/components/TopicPanel.tsx` | `apps/web/src/components/panels/topicPanelOps.ts` |
| `apps/web/src/components/MessageBubble.tsx` | `apps/web/src/components/message/bubbleFlags.ts` |
| `apps/web/src/components/ChatListItem.tsx` | `apps/web/src/components/chatList/GroupHeaderRow.tsx` |
| `apps/web/src/lib/push/usePushEnable.ts` | `apps/web/src/routes/NotificationsPage.tsx` |
| `apps/mobile/src/components/chat/chat-rows.tsx` | `apps/mobile/src/components/chat/topic-row.tsx` |
| `apps/mobile/src/app/group-info/[id].tsx` | `apps/mobile/src/app/group/[id].tsx` |
| `apps/mobile/src/components/chat/attachment-body.tsx` | `apps/mobile/src/components/chat/media-bubble.tsx` |
| `apps/mobile/src/components/chat/message-bubble-content.tsx` | `apps/mobile/src/components/chat/plain-bubble-body.tsx` |
| `apps/mobile/src/app/group/new.tsx` | `apps/mobile/src/components/chat/new-chat-button.tsx` |
| `apps/server/src/groups/member-roles.ts` | `apps/server/src/groups/members.ts` |
| `apps/server/src/routines/support.ts` | `apps/server/src/tools/routine-adapters.ts` |
| `apps/server/src/stickers/convert.ts` | `apps/server/src/voice/engine.ts` |

### Steps
For each pair, read both copies:
1. **Same code:** keep one copy where it fits best, usually the file the other already imports from, or the more general one. Export it and make the other file use it.
2. **Same shape, different data:** pass the difference as a parameter only when the result is shorter. Otherwise skip the pair.
3. **Look-alikes:** skip a pair whose copies only look alike (different props, different labels, different meaning) and say why.
4. **Keep the sum smaller:** a shared piece must save more lines than it adds. If it doesn't, revert it and say so in the Report.

### Rules
- No behaviour change: the same values, the same markup, labels and styles, the same order of effects.
- Keep every "why" comment, once.
- Do not create a new file unless both copies have no better home.
- No new tests. Run the nearest existing tests with `--reporter=dot`.
- Each pair is two files in one app or package that repeat a block of 6 or more lines (the lead's clone scan, 2026-10-19). Find the shared block, keep one copy in the more general file (or in the module the other already imports from), and import it in the other. Skip a pair when the two blocks only look alike (different meaning, different data), or when sharing would not be shorter; say why.
- `packages/api-contract` must not import `packages/chat-core`; check which package already depends on the other before moving.
- Do not touch `apps/*/src/store/**`, `apps/*/src/auth/**` or `apps/server/src/agents/**`.
- No re-export shims or aliases.

### Allowed files
- `apps/mobile/src/app/group-info/[id].tsx`
- `apps/mobile/src/app/group/[id].tsx`
- `apps/mobile/src/app/group/new.tsx`
- `apps/mobile/src/components/chat/attachment-body.tsx`
- `apps/mobile/src/components/chat/chat-rows.tsx`
- `apps/mobile/src/components/chat/media-bubble.tsx`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/chat/plain-bubble-body.tsx`
- `apps/mobile/src/components/chat/topic-row.tsx`
- `apps/server/src/groups/member-roles.ts`
- `apps/server/src/groups/members.ts`
- `apps/server/src/routines/support.ts`
- `apps/server/src/stickers/convert.ts`
- `apps/server/src/tools/routine-adapters.ts`
- `apps/server/src/voice/engine.ts`
- `apps/web/src/components/chatList/GroupHeaderRow.tsx`
- `apps/web/src/components/ChatListItem.tsx`
- `apps/web/src/components/message/bubbleFlags.ts`
- `apps/web/src/components/MessageBubble.tsx`
- `apps/web/src/components/panels/topicPanelOps.ts`
- `apps/web/src/components/TopicPanel.tsx`
- `apps/web/src/lib/push/usePushEnable.ts`
- `apps/web/src/routes/NotificationsPage.tsx`
- `packages/api-contract/src/chat-folders.ts`
- `packages/chat-core/src/folders.ts`
- `work/T-2188-clone-pairs-2.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat`.
- The Report lists each pair: merged (lines saved) or skipped (why).
- **Lead check:** web mock: a topic panel, a message bubble, the chat list (group header row), Notifications. Phone emulator: the chat list (chat and topic rows), a group screen and group info, an attachment and a photo bubble, the new group screen.

---

## Report (written by the worker when done)

### What I did

Merged one of the thirteen pairs and skipped the other twelve. The net from
`git diff main --numstat` on product files is **+35 / −53, net −18 lines**
(`message-bubble-content.tsx` +4/−25, `plain-bubble-body.tsx` +31/−28).

| Pair | Result |
| --- | --- |
| `packages/api-contract/src/chat-folders.ts` / `packages/chat-core/src/folders.ts` | **Skipped.** `FOLDER_ICONS`, `FolderIcon`, `FOLDER_NAME_MAX` and `FOLDER_CHATS_MAX` are the same 26 lines, but neither package depends on the other: `api-contract` must not import `chat-core`, and `chat-core` deliberately avoids `api-contract` (`new-ai.ts`). Adding that workspace dependency is outside this task, so the mirror stays. |
| `TopicPanel.tsx` / `panels/topicPanelOps.ts` | **Skipped.** The shared window is `TopicPanel`'s destructure of `useTopicPanelOps`' return; the logic already lives once in `topicPanelOps.ts`. |
| `MessageBubble.tsx` / `message/bubbleFlags.ts` | **Skipped.** Same shape: the bubble calls `bubbleFlags`; the clone scan caught the destructured field names and the argument names, not copied logic. |
| `ChatListItem.tsx` / `chatList/GroupHeaderRow.tsx` | **Skipped.** `GroupHeaderRow` already imports `chatRowPreview` and `TypingLine` from `ChatListItem`, and both use `PreviewLine`, `Badge` and `MessageTicks`. The remaining blocks are row markup with different wrappers, labels and branches (topic activity marks, private lock, draft line, channel label, `unreadMark`); a shared component would need all of those as props and would grow. |
| `lib/push/usePushEnable.ts` / `routes/NotificationsPage.tsx` | **Skipped.** The page only destructures the hook's return; the state and actions exist once in `usePushEnable`. |
| `chat-rows.tsx` / `topic-row.tsx` | **Skipped.** Both already use `PreviewIcon`, `Ticks`, `UnreadBadge` and the shared preview helpers. The remaining data setup is one copy plus two object destructures (about 3 lines at best), and the markup differs (group glyph vs avatar, channel/draft/`unreadMark` branches vs activity marks). |
| `app/group-info/[id].tsx` / `app/group/[id].tsx` | **Skipped.** The copies are a 9-line screen setup (`ensureGroupDetail`, `topics`, `general`, `groupTitle`), a 5-line `myAisInGroup`/`canCreate`, and the `NewTopicSheet` call site (already a shared component). No allowed shared module exists; a hook in one route imported by the other couples two screens and saves only a few lines, and a new file is outside the Allowed files. |
| `attachment-body.tsx` / `media-bubble.tsx` | **Skipped.** Both already use `AlbumGrid`, `AttachmentViewer` and `useAttachmentViewer`. The duplicate 8- and 9-line blocks are the same props lists; a wrapper repeats those props as parameters and is longer than the copies it removes. |
| `message-bubble-content.tsx` / `plain-bubble-body.tsx` | **Merged.** `bubbleMetaTail` and `bubbleMetaOverlay` now live once in `plain-bubble-body.tsx` (next to `BubbleInlineMeta`) and `message-bubble-content.tsx` imports them. Same props, same `DraftCaret`/`hidden` behaviour, same markup; **18 lines saved**. |
| `app/group/new.tsx` / `new-chat-button.tsx` | **Skipped.** Both already use `VisibilityFields` and `useHandleCheck`; only the six-line `makeDirectoryApi`/`checkHandle` wiring and the error markup repeat. A wrapper hook/component costs at least the same number of lines, and the sheet keeps its own memoized-callback comment. |
| `groups/member-roles.ts` / `groups/members.ts` | **Skipped.** The copies are the `runSql` + `withTransaction` + advisory-lock scaffold and a role lookup. One helper would replace one copy (about 18 lines) at three call sites (about 24 lines), saving roughly six lines, while each caller has different lock keys, messages and follow-up SQL. Not enough to justify the indirection. |
| `routines/support.ts` / `tools/routine-adapters.ts` | **Skipped.** The `routine.created` audit block is identical in 14 lines, but a helper is about 19 lines plus one extra import in each file, so it saves at most one line. The two INSERTs differ in columns and values. |
| `stickers/convert.ts` / `voice/engine.ts` | **Skipped.** The `FfprobeJson` schemas differ (`codec_name` vs `format_name`), and the identical 10-line ffprobe argument list has no shared home: `stickers` and `voice` do not import each other, and a cross-domain import or a new file would be worse than the copy. |

No behaviour, markup, labels, styles, effect order or comments changed; the two
existing "why" comments were kept once each.

### Checks run

- `pnpm install` — done in 16.3s.
- No single test file: there are no tests near these two chat components
  (`apps/mobile/src/components/chat` has only `attach/gallery-reader.test.ts` and
  `dm-chat-id.test.ts`).
- `pnpm gate` from the repo root — **GATE PASS**:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.2s)
PASS  lint  (0.9s)
PASS  typecheck  (3.4s)
PASS  effect  (0.6s)
SKIP  build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/mobile  (1.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
GATE PASS
```

### Notes for the lead

- Product net: **−18 lines**. The task file also shows +100 against `main`
  because the spec commit is only on this branch.
- The gate warns that both touched files are over the 400-line soft limit
  (`message-bubble-content.tsx` 475, down from 496; `plain-bubble-body.tsx` 492,
  up from 489). Both were already over it; no split was made.
- Pair 1 is the one worth a follow-up: the 26-line folder constants are a true
  duplicate, but they need a package-dependency decision (move to a shared
  package, or let `chat-core` depend on `api-contract`) that this task does not
  allow me to make.

## Review (written by Claude)

Approved; the pre-review was clean (0 findings). Net −18.

**Merged:** one of the 13 pairs. The phone plain bubble body and the bubble content share one block.

**Skipped, with sound reasons (the Report has one per pair):** most clone-scan hits are now a hook's destructured return or a shared props list, not copied logic. The folder constants would need a new package dependency, which is a follow-up for the lead. The rest would save a line or less.

**Lead note:** the cross-file clone scan is exhausted for same-app pairs.

**Phone emulator smoke passed:** Ana's chat (plain, edited, deleted, replies, files, reactions), Dev-1 (Markdown with a table, code and a quote, the steps card), the topic chat (the choice card).
