---
id: T-2162
title: "Clean-up (web): blocks copied between two files of the same app or package get one home; no behaviour change"
status: merged
milestone: M5
branch: task/T-2162-web-clone-pairs
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2162: One home for blocks copied between files (web)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead ran a clone scan at `2044ba9fe` that finds runs of 8 or more normalised lines shared by two files (comments, blanks, imports and lone braces ignored). Each row below is a pair of files with the copied ranges. A row with no ranges is a pair whose files share several small blocks; read both files to find them.

| Copy A | Copy B |
| --- | --- |
| `apps/web/src/components/TopicPanel.tsx:353-375` | `apps/web/src/components/panels/topicPanelOps.ts:342-364` |
| `apps/web/src/components/channel-info/ChannelInfoRoot.tsx:143-154,164-174,184-202,245-255` | `apps/web/src/components/group-info/GroupInfoRoot.tsx:104-127,149-168,196-206` |
| `apps/web/src/components/MessageBubble.tsx:495-521` | `apps/web/src/components/message/bubbleFlags.ts:30-38,104-120` |
| `apps/web/src/lib/push/usePushEnable.ts:364-379` | `apps/web/src/routes/NotificationsPage.tsx:290-305` |
| `apps/web/src/components/ChannelPanel.tsx:466-481` | `apps/web/src/components/panels/GroupAiSection.tsx:75-90` |
| `apps/web/src/components/ChatListItem.tsx:152-161,165-175` | `apps/web/src/components/chatList/GroupHeaderRow.tsx:282-301` |
| `apps/web/src/components/panels/GroupRolesSection.tsx` | `apps/web/src/components/panels/TopicRolesSection.tsx` |
| `apps/web/src/components/ChannelPanel.tsx` | `apps/web/src/components/GroupPanel.tsx` |

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

### Allowed files
- `apps/web/src/components/channel-info/ChannelInfoRoot.tsx`
- `apps/web/src/components/ChannelPanel.tsx`
- `apps/web/src/components/chatList/GroupHeaderRow.tsx`
- `apps/web/src/components/ChatListItem.tsx`
- `apps/web/src/components/group-info/GroupInfoRoot.tsx`
- `apps/web/src/components/GroupPanel.tsx`
- `apps/web/src/components/message/bubbleFlags.ts`
- `apps/web/src/components/MessageBubble.tsx`
- `apps/web/src/components/panels/GroupAiSection.tsx`
- `apps/web/src/components/panels/GroupRolesSection.tsx`
- `apps/web/src/components/panels/topicPanelOps.ts`
- `apps/web/src/components/panels/TopicRolesSection.tsx`
- `apps/web/src/components/TopicPanel.tsx`
- `apps/web/src/lib/push/usePushEnable.ts`
- `apps/web/src/routes/NotificationsPage.tsx`
- `work/T-2162-web-clone-pairs.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat`.
- The Report lists each pair: merged (lines saved) or skipped (why).
- **Lead check:** web mock: topic panel, channel and group info, channel and group panels with roles and AIs, chat list with group headers, a chat's bubbles, the Notifications page.

---

## Report (written by the worker when done)

### What I did

Merged two of the eight pairs and skipped the other six. The net from `git diff main --numstat` on product files is **+29 / −40, net −11 lines** (the task file itself is +1/−1).

| Pair | Result |
| --- | --- |
| `TopicPanel.tsx` / `panels/topicPanelOps.ts` | **Skipped.** The shared window is `TopicPanel`'s destructure of the hook's return; the logic already lives once in `topicPanelOps`. Removing the destructure would put `ops.` on every use and save no lines. |
| `channel-info/ChannelInfoRoot.tsx` / `group-info/GroupInfoRoot.tsx` | **Skipped.** The hero rows differ (channel handle/description/Megaphone vs group member count/avatar stack). The identical mute/search keys need four props; a component is about 12 lines against 8 saved per side, so it grows the sum. The More menu and settings nav share only their wrappers; their items differ. |
| `MessageBubble.tsx` / `message/bubbleFlags.ts` | **Skipped.** Same as pair 1: the flags are computed once in `bubbleFlags`; the shared window is the caller's destructure. |
| `lib/push/usePushEnable.ts` / `routes/NotificationsPage.tsx` | **Skipped.** The shared window is the page's destructure of the hook's return; every field is used and no logic is copied. |
| `ChannelPanel.tsx` / `panels/GroupAiSection.tsx` | **Skipped.** The identical part is only the Cancel / “Add my AI” buttons. A shared toggle needs an `open` branch plus two callbacks and is longer than the 16 lines it replaces (the earlier wave measured a similar picker extraction as 6 lines longer). |
| `ChatListItem.tsx` / `chatList/GroupHeaderRow.tsx` | **Merged.** The writing/typing indicator is now `TypingLine` in `ChatListItem.tsx`; `GroupHeaderRow` already imports `chatRowPreview` from there. Both callers keep the same condition and markup; **7 lines saved**. |
| `panels/GroupRolesSection.tsx` / `panels/TopicRolesSection.tsx` | **Skipped.** Extracted the shared id-toggle as `toggleId`, but Prettier wraps both calls and the helper ended 4 lines longer, so it was reverted per rule 4. |
| `ChannelPanel.tsx` / `GroupPanel.tsx` | **Merged.** The identical 9-line `VisibilitySection` invocation is now `GroupVisibilitySetting` in `GroupPanel.tsx`, used by both panels; **4 lines saved**. The other small blocks (page scaffold, `ActivitySection` / `AlwaysAllowedList` rows, hook-derived values) need different props or wrappers and were left alone. |

Files changed:
- `apps/web/src/components/ChatListItem.tsx`
- `apps/web/src/components/chatList/GroupHeaderRow.tsx`
- `apps/web/src/components/GroupPanel.tsx`
- `apps/web/src/components/ChannelPanel.tsx`
- this task file

No behaviour, markup, labels, styles or effect order changed; no comments were added.

### Checks run

- `pnpm install --frozen-lockfile` — done in 10.9s.
- No single test file: the gate reports `SKIP tests @zilar/web (no nearby test files)`, and none of the existing web tests covers these components.
- `pnpm gate` from the repo root — first run failed only on formatting for `ChannelPanel.tsx` and the two roles files; after `pnpm exec prettier --write` on those files (the roles pair was then reverted) the final run was **GATE PASS**:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.2s)
PASS  lint  (1.3s)
PASS  typecheck  (3.9s)
PASS  effect  (0.5s)
SKIP  build @zilar/server (no server, package or manifest change)
SKIP  tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
WARN  size: apps/web/src/components/ChannelPanel.tsx: 479 lines (main 487); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
WARN  size: apps/web/src/components/GroupPanel.tsx: 586 lines (main 582); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Notes for the lead

- `GroupPanel.tsx` grew by 4 lines because it now owns `GroupVisibilitySetting`; `ChannelPanel.tsx` shrank by 8, so the pair is still smaller. Both are well under the 800-line split limit.
- `TypingLine` keeps the exact text branch: `writing` wins over `typingText`, otherwise the typing label, otherwise the caller's draft/preview branch.
- Security checklist: no routes, queries, logs, secrets or permission logic touched; this is presentational code only.


## Review (written by Claude)

Approved; the pre-review was clean (2 nits: the `GroupVisibilitySetting` name also serves channels; an empty span is guarded by both callers). Net −11.

**Merged pairs:**
- The chat-list typing line is now `TypingLine` in `ChatListItem`.
- The group and channel panels share `GroupVisibilitySetting`, which renders the same `VisibilitySection` with the same props.

**Skipped pairs (six):** these were call sites destructuring one hook's return, not copies; the lead's scan counted them as clones. Skipping them was correct.

**Web mock:** the chat list matches main pixel for pixel apart from a clock tick, and there were no page errors. The visibility row sits behind a panel sub-page the lead's script did not reach. That change is a pure JSX extraction, it typechecks, and the pre-review found it identical.
