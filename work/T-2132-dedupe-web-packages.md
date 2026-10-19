---
id: T-2132
title: "Clean-up (web, packages): remove duplicated blocks the clone scan found (channel vs group info, topic panel vs its ops, chat row vs topic row, bubble vs bubble flags, folder schema twice, attachment vs voice send, and more) — each block lives once, no behaviour change"
status: merged
milestone: M5
branch: task/T-2132-dedupe-web-packages
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2132: One copy of each duplicated block (web, packages)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead ran a clone scan at `d2fde6e4e`: windows of 6 normalised lines, ignoring imports, blanks and comments. These pairs share the same code; the line ranges are where the copies sit.

| # | File A (lines) | File B (lines) | Shared lines |
| --- | --- | --- | ---: |
| 1 | `apps/web/src/components/channel-info/ChannelInfoRoot.tsx` (143-152, 164-202, 236-255) | `apps/web/src/components/group-info/GroupInfoRoot.tsx` (93-116, 129-157, 168-195) | 29 |
| 2 | `packages/api-contract/src/chat-folders.ts` (9-36) | `packages/chat-core/src/folders.ts` (5-32) | 22 |
| 3 | `apps/web/src/components/TopicPanel.tsx` (353-375) | `apps/web/src/components/panels/topicPanelOps.ts` (342-364) | 18 |
| 4 | `packages/client-core/src/store/send/attachment.ts` (7-21, 58-70, 138-154) | `packages/client-core/src/store/send/voice.ts` (7-21, 37-47, 114-129) | 17 |
| 5 | `apps/web/src/components/ChatListItem.tsx` (40-45, 84-89, 132-181) | `apps/web/src/components/TopicRow.tsx` (42-47, 99-104, 150-186) | 16 |
| 6 | `apps/web/src/components/MessageBubble.tsx` (486-512) | `apps/web/src/components/message/bubbleFlags.ts` (30-38, 104-120) | 16 |
| 7 | `apps/web/src/components/ProfileSettingsSection.tsx` (373-412) | `apps/web/src/routes/HandlePage.tsx` (185-214) and `apps/web/src/components/VisibilitySection.tsx` (214-231) | 23 |
| 8 | `apps/web/src/components/ChannelPanel.tsx` (51-56, 243-248, 293-318) | `apps/web/src/components/GroupPanel.tsx` (194-199, 339-344, 368-437) | 11 |
| 9 | `apps/web/src/lib/push/usePushEnable.ts` (364-379) | `apps/web/src/routes/NotificationsPage.tsx` (274-289) | 11 |
| 10 | `apps/web/src/components/channel-info/ChannelAisPage.tsx` (149-164) | `apps/web/src/components/panels/GroupAiSection.tsx` (75-90) | 10 |
| 11 | `apps/web/src/components/NewGroupDialog.tsx` (282-287, 357-365) | `apps/web/src/components/VisibilitySection.tsx` (151-156, 228-236) | 9 |
| 12 | `packages/xmpp-core/src/stanza.ts` (15-28) | `packages/xmpp-core/src/stanza/build-outgoing.ts` (21-34) | 9 |
| 13 | `apps/web/src/components/panels/GroupRolesSection.tsx` (82-94) | `apps/web/src/components/panels/TopicRolesSection.tsx` (112-124) | 7 |
| 14 | `apps/web/src/components/PackEditor.tsx` (563-573) | `apps/web/src/components/sticker/usePackSave.ts` (45-55) | 6 |
| 15 | `apps/web/src/routes/AppRoutes.tsx` (45-68) | `apps/web/src/routes/GroupHandleRoute.tsx` (65-103) | 6 |

### Steps
For each pair, read both copies:
1. **Same code:** keep one copy and make the other file use it. Import the helper or component, or move the block into the file that already owns the concept: for example, keep the `TopicPanel` logic in `topicPanelOps.ts`, the bubble flags in `bubbleFlags.ts`, and the folder schema in the package the other one already depends on.
2. **Genuinely different behaviour:** leave the pair alone and say why in the Report. For example, a channel rule that a group does not have.
3. **Package direction:** check each `package.json` before importing across packages. Never add a dependency cycle; if the only fix needs one, skip the pair.
4. **Keep the sum smaller:** a shared helper must save more lines than it adds. If it doesn't, skip the pair.

### Rules
- No behaviour change, no visual change.
- Do not touch files other running tasks hold:
  - `apps/web/src/lib/api/*`
  - `apps/web/src/lib/api.ts`
  - `apps/web/src/store/store.ts`
  - `apps/web/src/store/effects/ports.ts`
  - any file under `apps/server` or `apps/mobile`
- No new tests.

### Allowed files
- every file in the table above:
  - `apps/web/src/components/channel-info/ChannelInfoRoot.tsx`
  - `apps/web/src/components/group-info/GroupInfoRoot.tsx`
  - `packages/api-contract/src/chat-folders.ts`
  - `packages/chat-core/src/folders.ts`
  - `apps/web/src/components/TopicPanel.tsx`
  - `apps/web/src/components/panels/topicPanelOps.ts`
  - `packages/client-core/src/store/send/attachment.ts`
  - `packages/client-core/src/store/send/voice.ts`
  - `apps/web/src/components/ChatListItem.tsx`
  - `apps/web/src/components/TopicRow.tsx`
  - `apps/web/src/components/MessageBubble.tsx`
  - `apps/web/src/components/message/bubbleFlags.ts`
  - `apps/web/src/components/ProfileSettingsSection.tsx`
  - `apps/web/src/routes/HandlePage.tsx`
  - `apps/web/src/components/VisibilitySection.tsx`
  - `apps/web/src/components/ChannelPanel.tsx`
  - `apps/web/src/components/GroupPanel.tsx`
  - `apps/web/src/lib/push/usePushEnable.ts`
  - `apps/web/src/routes/NotificationsPage.tsx`
  - `apps/web/src/components/channel-info/ChannelAisPage.tsx`
  - `apps/web/src/components/panels/GroupAiSection.tsx`
  - `apps/web/src/components/NewGroupDialog.tsx`
  - `packages/xmpp-core/src/stanza.ts`
  - `packages/xmpp-core/src/stanza/build-outgoing.ts`
  - `apps/web/src/components/panels/GroupRolesSection.tsx`
  - `apps/web/src/components/panels/TopicRolesSection.tsx`
  - `apps/web/src/components/PackEditor.tsx`
  - `apps/web/src/components/sticker/usePackSave.ts`
  - `apps/web/src/routes/AppRoutes.tsx`
  - `apps/web/src/routes/GroupHandleRoute.tsx`
- one new shared helper file per pair if needed, next to file A:
  - `apps/web/src/components/info/infoRootShared.tsx`
  - `apps/web/src/components/settings/handleField.tsx`
- `work/T-2132-dedupe-web-packages.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down by at least 100.
- The Report lists each pair: done, with lines saved, or skipped, and why.
- **Lead check** (web mock):
  - the channel and group info panels;
  - a topic panel;
  - the chat list with topic rows;
  - message bubbles;
  - Settings → Profile and Username;
  - `/settings/notifications`;
  - the new group dialog;
  - the sticker pack editor.

---

## Report (written by the worker when done)

### What I did

Four of the fifteen pairs shared code that could be removed without changing behaviour; those are done. The rest were skipped with the reason below, mostly because the shared window is a call site or a destructure of a hook's return rather than a second copy of logic, or because the extracted helper cost more lines than it saved (rule 4).

Product lines: `git diff --numstat` on tracked files + the new helper = **109 net lines removed**.

| # | Pair | Result | Lines |
| --- | --- | --- | --- |
| 1 | ChannelInfoRoot / GroupInfoRoot | Skipped. Tried `info/infoRootShared.tsx` (close header, mute error, settings row); helper plus usages added 4 lines more than the 50 removed, so reverted. The hero and action rows genuinely differ (channel handle/description/megaphone vs people stack), so they cannot move. | 0 |
| 2 | api-contract `chat-folders.ts` / chat-core `folders.ts` | Skipped. Neither package depends on the other; the only direction needs a new workspace dependency in a `package.json` outside Allowed files. | 0 |
| 3 | TopicPanel / `topicPanelOps.ts` | Skipped. The logic already lives in `topicPanelOps`; the shared window is `TopicPanel`'s destructure of that hook's return, which is the call site itself. | 0 |
| 4 | `send/attachment.ts` / `send/voice.ts` | Skipped. Extracted `finishUploadSend` into `attachment.ts` and used it from `voice.ts`; the parameter list and settle logic made the pair 19 lines longer, so reverted per rule 4. | 0 |
| 5 | ChatListItem / TopicRow | Done. `chatRowPreview` (the preview computation and icon map) now lives once in `ChatListItem.tsx`; `TopicRow` imports it. `previewParts` composes the same `previewPrefix`/`previewBody`/`previewKind` helpers the old TopicRow copy used. | −34 |
| 6 | MessageBubble / `bubbleFlags.ts` | Skipped. The flags already live once in `bubbleFlags`; the shared window is `MessageBubble`'s destructure of its return. | 0 |
| 7 | ProfileSettingsSection / HandlePage / VisibilitySection | Done (with #11) in `components/settings/handleField.tsx`: debounced availability check, reason text, and the `handleSaveMessage` mapping are now one copy. | −65 |
| 8 | ChannelPanel / GroupPanel | Skipped. The shared windows are JSX calls to already-shared components (`InviteLinksSection`, `ActivitySection`, `AlwaysAllowedList`) with different props; a wrapper adds lines. | 0 |
| 9 | `usePushEnable.ts` / NotificationsPage | Skipped. Shared window is NotificationsPage's destructure of the hook's return; no copy of logic. | 0 |
| 10 | ChannelAisPage / GroupAiSection | Skipped. Extracted the shared picker (`AiPicker`); helper plus wrapper props were 6 lines longer than the two call sites saved, so reverted. | 0 |
| 11 | NewGroupDialog / VisibilitySection | Done with #7. The duplicated handle check and reason text now come from `handleField.tsx`; the visibility-specific copy remains because the surrounding fields differ. | (in #7) |
| 12 | `stanza.ts` / `stanza/build-outgoing.ts` | Skipped. Both are public re-export surfaces (one module-level, one package-level), and `stanza/decode.ts` imports `MAX_STATUS_CHARS` from `build-outgoing`; collapsing them changes exports. | 0 |
| 13 | GroupRolesSection / TopicRolesSection | Skipped. Extracted `RolesStatus`; it was 2 lines longer than the two removed blocks and the Retry callbacks differ, so reverted. | 0 |
| 14 | PackEditor / `usePackSave.ts` | Skipped. Shared window is the options object and its destructure; moving it renames the hook API without saving lines. | 0 |
| 15 | AppRoutes / GroupHandleRoute | Done. `useShareEntry` (auth, `/@handle` parsing, the login-return URL and `close`) now lives once in `GroupHandleRoute.tsx`; both share routes use it. | −10 |

Files changed:
- `apps/web/src/components/ChatListItem.tsx`
- `apps/web/src/components/TopicRow.tsx`
- `apps/web/src/components/NewGroupDialog.tsx`
- `apps/web/src/components/ProfileSettingsSection.tsx`
- `apps/web/src/components/VisibilitySection.tsx`
- `apps/web/src/routes/HandlePage.tsx`
- `apps/web/src/routes/AppRoutes.tsx`
- `apps/web/src/routes/GroupHandleRoute.tsx`
- new `apps/web/src/components/settings/handleField.tsx`
- this task file

### Checks run

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/send.test.ts` → 34 passed (1 file). Run while evaluating pair 4; the final tree has no `packages/client-core` changes because that extraction was reverted.
- `pnpm gate` from the repo root (final run):

```
gate: 10 changed file(s) against main
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
SKIP  build @zilar/server (no server, package or manifest change)
SKIP  tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

Earlier gate runs failed twice and were fixed: format (4 files; ran Prettier on those files) and typecheck (the temporary `finishUploadSend` error channel), then passed as above.

### Notes for the lead

- No behaviour or visual change is intended. Pair 5's shared preview uses `previewParts`, which is a one-line composition of the exact three functions the old TopicRow copy called, so the rendered prefix/body/kind stay identical.
- `handleReasonText` keeps the four user-facing sentences verbatim, with the noun (`username`/`handle`) chosen per screen.
- Security checklist: no routes, queries, logs, secrets or permission logic touched.

## Review (written by Claude)

Approved; the pre-review was clean (0 nits). Net −109.
- **Done (4 of 15 pairs):**
  - `ChatListItem` and `TopicRow` share their row code;
  - one `settings/handleField.tsx` serves the Profile, `/welcome/handle` and group Visibility handle fields;
  - `NewGroupDialog` reuses the visibility section;
  - `AppRoutes` / `GroupHandleRoute`.
- **Skipped (11 pairs):** each skip in the Report is sound. The window was a hook's call site and not a second copy, or a helper came out longer (tried and reverted), or sharing would need a new package dependency.
- **Web mock** (`:5253`, no page errors):
  - all 25 routes render;
  - the chat list shows groups with their topic rows;
  - Settings → Profile and `/welcome/handle` check a username (the same answers as main for "ana" and a new name);
  - Dev team → Settings → Visibility → Public shows the handle field;
  - New chat → New group opens the member picker.
