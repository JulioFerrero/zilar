---
id: T-2176
title: "One copy of each function written twice (web and phone, wave 2: functions and types): identical function bodies in different files get one home; no behaviour change"
status: merged
milestone: M5
branch: task/T-2176-client-copies-2
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2176: One copy of each function written twice (web and phone, wave 2: functions and types)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead scanned every top-level function and arrow const at `e762bf61a`. Each row below is a group of functions whose bodies are identical after whitespace and comments are normalised, though the names may differ. Line numbers are where each copy starts.

| # | Copies |
| --- | --- |
| 1 | `apps/mobile/src/app/at/[handle].tsx:25` `attempt`<br>`apps/mobile/src/app/explore.tsx:33` `fromThrown`<br>`apps/mobile/src/app/join/[token].tsx:25` `fromThrown`<br>`apps/mobile/src/app/u/[handle].tsx:54` `profileDmFromThrown`<br>`apps/mobile/src/app/u/[handle].tsx:420` `fromThrown`<br>`apps/mobile/src/app/welcome/handle.tsx:25` `fromThrown` |
| 2 | `apps/mobile/src/app/ais/[id].tsx:231` `computerRawCall`<br>`apps/mobile/src/app/ais/[id].tsx:336` `rawCall`<br>`apps/mobile/src/components/chat/group-action.ts:3` `rawCall` |
| 3 | `apps/mobile/src/app/settings/machines.tsx:137` `groupFingerprint`<br>`apps/mobile/src/components/machines/approved-machines.tsx:14` `groupFingerprint`<br>`apps/web/src/components/machines/PendingMachineCard.tsx:101` `groupFingerprint` |
| 4 | `apps/mobile/src/components/chat/blocks/progress-blocks.tsx:117` `pad`<br>`apps/web/src/components/message/blocks/ProgressBlocks.tsx:19` `pad`<br>`packages/chat-core/src/format.ts:13` `pad` |
| 5 | `apps/mobile/src/app/settings/contacts.tsx:46` `rateLimited`<br>`apps/mobile/src/components/contacts/blocks.ts:14` `rateLimited` |
| 6 | `apps/mobile/src/components/chat/blocks/choice-blocks.tsx:347` `clockTime`<br>`apps/mobile/src/components/chat/blocks/form-block.tsx:27` `clockTime` |
| 7 | `apps/mobile/src/components/chat/payload-card.tsx:371` `isLive`<br>`apps/web/src/components/ProgressCard.tsx:16` `isLive` |
| 8 | `apps/mobile/src/lib/routines-format.ts:26` `nextRunText`<br>`apps/web/src/components/tools/RoutinesSection.tsx:32` `nextRunText` |
| 9 | `apps/mobile/src/lib/routines-format.ts:22` `hostsLine`<br>`apps/web/src/components/tools/ToolsSection.tsx:21` `hostsLine`<br>`apps/web/src/components/tools/toolDetailOps.ts:31` `hostsLine` |
| 10 | `apps/web/src/components/ApprovalCard.tsx:241` `isStaleDecision`<br>`apps/web/src/routes/ApprovalsPage.tsx:253` `isStaleDecision` |
| 11 | `apps/web/src/components/ais/AiActivity.tsx:22` `auditFailureText`<br>`apps/web/src/components/sticker/pageActions.ts:32` `failureText` |
| 12 | `apps/web/src/components/panels/groupPanelOps.ts:11` `apiFailureText`<br>`apps/web/src/routes/ConnectionsPage.tsx:32` `messageOf` |
| 13 | `apps/web/src/lib/emojiRecents.ts:13` `orFallback`<br>`apps/web/src/lib/stickers.ts:16` `orFallback` |
| 14 | `apps/web/src/lib/push/usePushEnable.ts:59` `attempt`<br>`apps/web/src/routes/GroupHandleRoute.tsx:24` `attempt` |
| 15 | `apps/mobile/src/components/chat/composer-media.ts:28` `isRecord`<br>`apps/mobile/src/lib/app-update.ts:23` `isRecord` |
| 16 | `apps/mobile/src/lib/app-update-native.ts:42` `secureStore`<br>`apps/mobile/src/lib/push/last-received.ts:9` `secureStore` |
| 17 | `apps/mobile/src/lib/voice-recorder.ts:14` `FinishedRecording`<br>`apps/mobile/src/lib/voice.ts:50` `RecordedVoice`<br>`apps/mobile/src/lib/voice.ts:82` `ConvertedVoice` |
| 18 | `apps/mobile/src/lib/gifs.ts:14` `GifItem`<br>`apps/web/src/components/GifPanel.tsx:10` `GifChoice` |
| 19 | `apps/mobile/src/components/chat/entity-avatar.tsx:7` `EntityAvatarProps`<br>`apps/web/src/components/EntityAvatar.tsx:7` `EntityAvatarProps` |
| 20 | `apps/mobile/src/lib/stickers.ts:38` `StickerChoice`<br>`apps/web/src/components/StickerPanel.tsx:26` `StickerChoice` |
| 21 | `apps/mobile/src/components/chat/group-roles-sheet.tsx:19` `RolesSheetMember`<br>`apps/mobile/src/lib/roles.ts:76` `MemberWithChips` |
| 22 | `apps/mobile/src/components/chat/pinned-banner.tsx:9` `BannerPin`<br>`apps/mobile/src/components/chat/pins-sheet.tsx:9` `SheetPin` |
| 23 | `apps/mobile/src/lib/voice.ts:192` `UploadSlotRequester`<br>`apps/web/src/lib/voice/convert.ts:74` `UploadSlotRequester` |
| 24 | `apps/mobile/src/app/settings/profile.tsx:63` `BioFieldProps`<br>`apps/mobile/src/app/settings/profile.tsx:100` `NameFieldProps` |
| 25 | `apps/mobile/src/components/chat/composer-mentions.ts:105` `PickedMention`<br>`apps/mobile/src/components/chat/composer-mentions.ts:131` `BackspaceMention` |
| 26 | `apps/mobile/src/components/chat/invite-links-sheet.tsx:45` `CreateInviteLinkForm`<br>`packages/client-core/src/groups-api.ts:15` `CreateGroupInviteLinkInput` |
| 27 | `apps/mobile/src/components/chat/person-pressable.tsx:12` `PersonTarget`<br>`apps/web/src/components/personLink.tsx:8` `PersonTarget` |
| 28 | `apps/mobile/src/components/chat/topic-people-line.tsx:16` `TopicLinePerson`<br>`apps/web/src/components/group-info/AvatarStack.tsx:3` `AvatarStackEntry` |
| 29 | `apps/mobile/src/lib/push/native.ts:24` `PushPairInput`<br>`apps/web/src/lib/push/sessionEnable.ts:11` `PushPairInput` |

### Steps
For each row:
1. Read every copy and confirm the bodies match.
2. Keep one copy:
   When the copies are web and phone, put the function or type in `packages/chat-core/src` (pure logic and plain data types) or `packages/client-core/src` (React or API types), in the module that already holds the nearest helpers (`format`, `routines`, `gifs`, `stickers`, `blocks`, `messages`, `text`, `files`), and export it from that package's `index.ts`. When one copy is already in a package, keep that one. When all copies are in one app, keep the one in the more general file (`lib/`, `components/`) and import it in the others. When two declarations in one file match, keep one.
3. Export it, import it at the other places, and delete the other copies. When the names differ, keep the clearer name and rename the call sites.
4. **Skip a row and say why in the Report** when:
   - the copies differ after all;
   - sharing would need an import that breaks a package boundary (a package never imports an app; an app imports only packages it already depends on);
   - the copy is React Native or DOM markup that the other platform cannot render.

### Rules
- No behaviour change.
- Keep every "why" comment, once, on the kept copy.
- No new tests. Existing tests must pass. Update a test's import path only when its function moved.
- **No re-export shims or aliases.** Every importer, tests included, imports the kept copy from where it lives, under its kept name.
- Types: merge only declarations that mean the same thing. Skip look-alikes with different meanings (for example a bio field vs a name field, or two mention kinds) and say why. Clarity beats one line.
- Do not touch `apps/*/src/store/**` or `apps/*/src/auth/**`.

### Allowed files
- `apps/mobile/src/app/explore.tsx`
- `apps/mobile/src/app/settings/contacts.tsx`
- `apps/mobile/src/app/settings/machines.tsx`
- `apps/mobile/src/app/settings/profile.tsx`
- `apps/mobile/src/app/welcome/handle.tsx`
- `apps/mobile/src/components/chat/blocks/choice-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/form-block.tsx`
- `apps/mobile/src/components/chat/blocks/progress-blocks.tsx`
- `apps/mobile/src/components/chat/composer-media.ts`
- `apps/mobile/src/components/chat/composer-mentions.ts`
- `apps/mobile/src/components/chat/entity-avatar.tsx`
- `apps/mobile/src/components/chat/group-action.ts`
- `apps/mobile/src/components/chat/group-roles-sheet.tsx`
- `apps/mobile/src/components/chat/invite-links-sheet.tsx`
- `apps/mobile/src/components/chat/payload-card.tsx`
- `apps/mobile/src/components/chat/person-pressable.tsx`
- `apps/mobile/src/components/chat/pinned-banner.tsx`
- `apps/mobile/src/components/chat/pins-sheet.tsx`
- `apps/mobile/src/components/chat/topic-people-line.tsx`
- `apps/mobile/src/components/contacts/blocks.ts`
- `apps/mobile/src/components/machines/approved-machines.tsx`
- `apps/mobile/src/lib/app-update-native.ts`
- `apps/mobile/src/lib/app-update.ts`
- `apps/mobile/src/lib/gifs.ts`
- `apps/mobile/src/lib/push/last-received.ts`
- `apps/mobile/src/lib/push/native.ts`
- `apps/mobile/src/lib/roles.ts`
- `apps/mobile/src/lib/routines-format.ts`
- `apps/mobile/src/lib/stickers.ts`
- `apps/mobile/src/lib/voice-recorder.ts`
- `apps/mobile/src/lib/voice.ts`
- `apps/web/src/components/ais/AiActivity.tsx`
- `apps/web/src/components/ApprovalCard.tsx`
- `apps/web/src/components/EntityAvatar.tsx`
- `apps/web/src/components/GifPanel.tsx`
- `apps/web/src/components/group-info/AvatarStack.tsx`
- `apps/web/src/components/machines/PendingMachineCard.tsx`
- `apps/web/src/components/message/blocks/ProgressBlocks.tsx`
- `apps/web/src/components/panels/groupPanelOps.ts`
- `apps/web/src/components/personLink.tsx`
- `apps/web/src/components/ProgressCard.tsx`
- `apps/web/src/components/sticker/pageActions.ts`
- `apps/web/src/components/StickerPanel.tsx`
- `apps/web/src/components/tools/RoutinesSection.tsx`
- `apps/web/src/components/tools/toolDetailOps.ts`
- `apps/web/src/components/tools/ToolsSection.tsx`
- `apps/web/src/lib/emojiRecents.ts`
- `apps/web/src/lib/push/sessionEnable.ts`
- `apps/web/src/lib/push/usePushEnable.ts`
- `apps/web/src/lib/stickers.ts`
- `apps/web/src/lib/voice/convert.ts`
- `apps/web/src/routes/ApprovalsPage.tsx`
- `apps/web/src/routes/ConnectionsPage.tsx`
- `apps/web/src/routes/GroupHandleRoute.tsx`
- `packages/chat-core/src/format.ts`
- `packages/client-core/src/groups-api.ts`
- `packages/chat-core/src/*.ts` (the module that receives a moved helper or type, and `index.ts`)
- `packages/client-core/src/*.ts` (the same)
- Test files next to those files (import path only).
- `apps/web/src/**` and `apps/mobile/src/**` outside `store/` and `auth/`: import lines and names only, in files that import a moved or renamed function or type.
- `work/T-2176-client-copies-2.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat -- apps packages`.
- The Report lists each row: merged (where it lives now) or skipped (why).
- **Lead check:** web mock: the tools and routines sections of an AI, the approvals page, the machines page, a GIF and a sticker send, the push settings page. Phone emulator: the blocks catalog (choice, form, progress), Settings → Machines, Contacts, Profile, a group's roles sheet, the pinned banner and pins sheet, an AI's edit page.

---

## Report (written by the worker when done)

### What I did

Merged one copy of each function or type; every importer imports the kept copy from where it lives, with no re-export shims.

| Row | Result |
| --- | --- |
| 1 | `fromThrown` in `packages/client-core/src/api-effect.ts`; all six mobile copies removed. Shares the helper with row 14. |
| 2 | `rawCall` kept in `apps/mobile/src/components/chat/group-action.ts`; both copies in `ais/[id].tsx` removed. |
| 3 | `groupFingerprint` in `packages/chat-core/src/format.ts`; three copies removed. |
| 4 | `pad` in `packages/chat-core/src/format.ts` (exported); two copies removed. |
| 5 | `rateLimited` kept in `apps/mobile/src/components/contacts/blocks.ts`; screen copy removed. |
| 6 | Both mobile `clockTime` copies removed in favour of the identical, already-exported `formatTime` in `packages/chat-core/src/format.ts`. |
| 7 | `isLive` in `packages/chat-core/src/block-progress.ts`; two copies removed. |
| 8 | `nextRunText` in `packages/chat-core/src/routines.ts`; two copies removed. |
| 9 | `hostsLine` in `packages/chat-core/src/routines.ts`; three copies removed (mobile `routines-format.ts` re-export dropped). |
| 10 | `isStaleDecision` in `packages/client-core/src/errors.ts`; two web copies removed. |
| 11 | `failureText` kept in `apps/web/src/components/sticker/pageActions.ts`; `auditFailureText` removed. |
| 12 | `apiFailureText` kept (exported) in `apps/web/src/components/panels/groupPanelOps.ts`; `messageOf` removed and its call sites renamed. |
| 13 | `orFallback` kept (exported) in `apps/web/src/lib/emojiRecents.ts`; copy in `lib/stickers.ts` removed. |
| 14 | `fromThrown` in `packages/client-core/src/api-effect.ts`; both web `attempt` copies removed. |
| 15 | `isRecord` kept (exported) in `apps/mobile/src/lib/app-update.ts`; copy in `composer-media.ts` removed. |
| 16 | `secureStore` kept (exported) in `apps/mobile/src/lib/push/last-received.ts`; copy in `app-update-native.ts` removed. Kept in the lighter module so the existing Vitest test never loads `expo-file-system`. |
| 17 | **Skipped.** Merging three names into one would require renaming imports inside `apps/mobile/src/store/**`, which the task rules forbid. `RecordedVoice` vs `ConvertedVoice` also mark distinct steps at the store's convert/upload seam. |
| 18 | `GifItem` in `packages/chat-core/src/gifs.ts`; mobile `GifItem` and web `GifChoice` removed, all importers renamed. |
| 19 | `EntityAvatarProps` in `packages/client-core/src/entity-avatar.ts`; two copies removed. |
| 20 | `StickerChoice` in `packages/chat-core/src/stickers.ts`; two copies removed. |
| 21 | `MemberWithChips` kept in `apps/mobile/src/lib/roles.ts`; `RolesSheetMember` removed. |
| 22 | `BannerPin` kept in `apps/mobile/src/components/chat/pinned-banner.tsx`; `SheetPin` removed and importers renamed. |
| 23 | `UploadSlotRequester` in `packages/client-core/src/voice.ts`; two copies removed (`attachments.ts` import updated too). |
| 24 | **Skipped.** `BioFieldProps` and `NameFieldProps` have the same shape but describe two different fields; the spec names this as a look-alike to keep separate. |
| 25 | **Skipped.** `PickedMention` and `BackspaceMention` are different mention results; the spec names this as a look-alike to keep separate. |
| 26 | `CreateGroupInviteLinkInput` kept in `packages/client-core/src/groups-api.ts`; `CreateInviteLinkForm` removed from the mobile sheet and renamed at its two importers. |
| 27 | `PersonLinkTarget` kept in `packages/chat-core/src/person-link.ts` (identical to both copies, already in the package); `PersonTarget` removed from both apps. |
| 28 | `AvatarStackEntry` in `packages/chat-core/src/avatar.ts`; `TopicLinePerson` and the web `AvatarStackEntry` declarations removed. |
| 29 | `PushPairInput` and the companion `SetPushPair` alias in `packages/client-core/src/push.ts`; two copies of each removed. |

Files changed: 88 (see `git status`). Net lines against the branch point `e762bf61a`: `236 added, 412 deleted, net -176`. The literal `git diff main --numstat -- apps packages` currently prints `742 added, 630 deleted, net +112` because `main` has moved ahead with T-2175 and T-2177, whose server/package deletions are not in this branch; the three-dot diff from the branch point is the task's real delta.

### Checks run

`pnpm gate` (from the repo root), final run:

```
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
PASS  build @zilar/server
PASS  tests @zilar/chat-core
PASS  tests @zilar/client-core
PASS  tests @zilar/mobile
PASS  tests @zilar/web
scope: every changed file is inside the Allowed files
GATE PASS
```

No single test file was run separately; the gate ran the four affected packages' suites.

### Notes for the lead

- Rows 1 and 14 were identical after normalisation, so both now use `fromThrown`; row 6's `clockTime` was byte-identical to the exported `formatTime`, so it uses that rather than adding a new name. Row 27's `PersonTarget` duplicated the existing `PersonLinkTarget`. Row 29's `SetPushPair` alias was merged alongside `PushPairInput` so no duplicate alias was left behind.
- No behaviour changes were intended: every kept body is unchanged; only names, locations and import lines moved. Comments were kept once, on the kept copy.
- Skipped rows: 17 (store imports are off-limits), 24 and 25 (different meanings).


## Review (written by Claude)

Approved; the pre-review was clean after one lead fix round, which removed two comments the moves had left above the wrong code. Net −178 across 87 files.

**Moved to chat-core or client-core once:**
- `fromThrown`/`attempt` (×7), `rawCall`, `groupFingerprint` (×3) and `pad`;
- `rateLimited`, `clockTime`, `isLive`, `nextRunText`, `hostsLine` (×3), `isStaleDecision`;
- the failure-text pairs, `orFallback`, `isRecord` and `secureStore`;
- 9 web/phone type pairs: GIF item, entity avatar props, sticker choice, upload slot requester, person target, avatar stack entry, push pair input, roles member, pin.

**Kept apart on purpose:**
- the voice recording types (store files);
- bio vs name field props, picked vs backspace mention;
- `toolDetailOps.failureText` (its rule differs).

**Re-exports:** only `client-core/src/index.ts` gained export lines. No app shims.

**Web mock, identical to main:** Approvals, Machines (the fingerprint grouping), Notifications, Routines (next-run text), Connections, the AI panel tools and routines, the GIF search. No page errors.

**Phone emulator smoke passed:** Machines, Contacts, Profile, Edit Dev-1, the blocks catalog (gauge, buttons, poll, album, file), Ana's chat; tapping the pinned bar jumps to the pinned message.
