---
id: T-2170
title: "One copy of each function written twice (web and phone): identical function bodies in different files get one home; no behaviour change"
status: merged
milestone: M5
branch: task/T-2170-client-fn-copies
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2170: One copy of each function written twice (web and phone)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead scanned every top-level function and arrow const at `91ff2a980`. Each row below is a group of functions whose bodies are identical after whitespace and comments are normalised, though the names may differ. Line numbers are where each copy starts.

| # | Copies |
| --- | --- |
| 1 | `apps/mobile/src/components/chat/blocks/choice-blocks.tsx:354` `chosenAnswer`<br>`apps/web/src/components/message/blocks/ButtonsBlock.tsx:30` `chosenAnswer` |
| 2 | `apps/mobile/src/components/chat/blocks/form-block.tsx:28` `sentAnswer`<br>`apps/web/src/components/message/blocks/FormBlock.tsx:29` `sentAnswer` |
| 3 | `apps/mobile/src/components/chat/new-chat-button.tsx:46` `matchesFilter`<br>`apps/web/src/components/NewChatButton.tsx:248` `matchesFilter` |
| 4 | `apps/mobile/src/components/chat/payload-card.tsx:370` `elapsedFor`<br>`apps/web/src/components/ProgressCard.tsx:21` `elapsedFor` |
| 5 | `apps/mobile/src/components/chat/chat-composer-dock.tsx:321` `deleteActionFor`<br>`apps/web/src/components/SelectionBar.tsx:12` `deleteActionFor` |
| 6 | `apps/mobile/src/components/chat/chat-composer-dock.tsx:478` `jidLocalpart`<br>`apps/web/src/components/Composer.tsx:96` `jidLocalpart` |
| 7 | `apps/mobile/src/components/chat/chat-composer-dock.tsx:209` `AddToTopicRow`<br>`apps/web/src/components/Composer.tsx:138` `AddToTopicRow` |
| 8 | `apps/mobile/src/components/chat/plain-bubble-body.tsx:236` `previewUrl`<br>`apps/web/src/components/MessageBubble.tsx:369` `previewUrl` |
| 9 | `apps/mobile/src/components/chat/message-bubble.tsx:64` `chipLabel`<br>`apps/web/src/components/MessageBubble.tsx:105` `chipLabel` |
| 10 | `apps/mobile/src/components/chat/album-members.tsx:8` `AlbumMembersProvider`<br>`apps/web/src/components/message/AlbumGrid.tsx:21` `AlbumMembersProvider` |
| 11 | `apps/mobile/src/components/chat/ai-activity-marks.tsx:21` `personOf`<br>`apps/web/src/components/topic/AiActivityMarks.tsx:7` `personOf` |
| 12 | `apps/mobile/src/components/chat/chat-picker-list.tsx:20` `canPostTo`<br>`apps/web/src/components/ForwardPicker.tsx:18` `canPostTo` |
| 13 | `apps/mobile/src/components/chat/chat-picker-list.tsx:12` `targetLabel`<br>`apps/web/src/components/ForwardPicker.tsx:11` `targetLabel` |
| 14 | `apps/mobile/src/components/chat/request-rows.tsx:44` `without`<br>`apps/web/src/components/chatList/RequestRows.tsx:39` `without` |
| 15 | `apps/mobile/src/app/settings/notifications.tsx:34` `deviceName`<br>`apps/web/src/routes/NotificationsPage.tsx:125` `deviceName` |
| 16 | `apps/mobile/src/lib/routines-format.ts:21` `routineStatusText`<br>`apps/web/src/components/tools/RoutinesSection.tsx:26` `statusText` |
| 17 | `apps/mobile/src/lib/routines-format.ts:35` `routineLastText`<br>`apps/web/src/components/tools/RoutinesSection.tsx:40` `lastStatusText` |
| 18 | `apps/mobile/src/lib/routines-format.ts:15` `toolLastRunText`<br>`apps/web/src/components/tools/ToolsSection.tsx:23` `lastRunText` |
| 19 | `apps/mobile/src/components/ais/tool-detail-body.tsx:413` `runStatusText`<br>`apps/web/src/components/tools/toolDetailOps.ts:35` `runStatusText` |
| 20 | `apps/mobile/src/components/chat/attachment-video.tsx:186` `isGifOrigin`<br>`packages/chat-core/src/media.ts:100` `isGifVideoName` |
| 21 | `apps/mobile/src/components/chat/file-bubble.tsx:119` `extensionOf`<br>`packages/chat-core/src/files.ts:22` `fileExtension` |
| 22 | `apps/web/src/components/MarkdownText.tsx:9` `safeUrl`<br>`packages/chat-core/src/markdown-ast.ts:40` `safeMarkdownUrl` |
| 23 | `apps/mobile/src/components/chat/haptics.ts:5` `tap`<br>`apps/mobile/src/components/chat/message-bubble.tsx:292` `lightHaptic`<br>`apps/mobile/src/components/chat/row-gesture.tsx:20` `lightHaptic` |
| 24 | `apps/mobile/src/app/(tabs)/ais.tsx:128` `withKey`<br>`apps/mobile/src/app/(tabs)/index.tsx:31` `withKey` |
| 25 | `apps/mobile/src/components/chat/topic-add-sheet.tsx:31` `AddGroup`<br>`apps/mobile/src/components/chat/topic-info-sheet.tsx:178` `InfoGroup` |
| 26 | `apps/mobile/src/components/chat/attachment-message.tsx:23` `isLoadableMediaUrl`<br>`apps/mobile/src/lib/voice-playback.ts:59` `isPlayableVoiceUrl` |

### Steps
For each row:
1. Read every copy and confirm the bodies match.
2. Keep one copy:
   When one copy is web and one is phone, put it in `packages/chat-core/src` (pure logic) or `packages/client-core/src` (a React hook or context). Use the chat-core module that already holds the nearest helpers (for example `blocks`, `files`, `media`, `ai`, `messages`), and export it from that package's `index.ts`. When the row already names a chat-core function, delete the app copy and import the chat-core one. When both copies are in the phone app, keep the one in the more general file (`haptics.ts`, `lib/`).
3. Export it, import it at the other places, and delete the other copies. When the names differ, keep the clearer name and rename the call sites.
4. **Skip a row and say why in the Report** when:
   - the copies differ after all;
   - sharing would need an import that breaks a package boundary (a package never imports an app; an app imports only packages it already depends on);
   - the copy is React Native or DOM markup that the other platform cannot render.

### Rules
- No behaviour change.
- Keep every "why" comment, once, on the kept copy.
- No new tests. Existing tests must pass. Update a test's import path only when its function moved.
- A web component and a phone component cannot be shared. `AddToTopicRow` is one in each app, so skip it unless its body is plain logic that can move to chat-core. `AddGroup`/`InfoGroup` are both phone components, so they may merge.

### Allowed files
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/app/(tabs)/index.tsx`
- `apps/mobile/src/app/settings/notifications.tsx`
- `apps/mobile/src/components/ais/tool-detail-body.tsx`
- `apps/mobile/src/components/chat/ai-activity-marks.tsx`
- `apps/mobile/src/components/chat/album-members.tsx`
- `apps/mobile/src/components/chat/attachment-message.tsx`
- `apps/mobile/src/components/chat/attachment-video.tsx`
- `apps/mobile/src/components/chat/blocks/choice-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/form-block.tsx`
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`
- `apps/mobile/src/components/chat/chat-picker-list.tsx`
- `apps/mobile/src/components/chat/file-bubble.tsx`
- `apps/mobile/src/components/chat/haptics.ts`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/chat/payload-card.tsx`
- `apps/mobile/src/components/chat/plain-bubble-body.tsx`
- `apps/mobile/src/components/chat/request-rows.tsx`
- `apps/mobile/src/components/chat/row-gesture.tsx`
- `apps/mobile/src/components/chat/topic-add-sheet.tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `apps/mobile/src/lib/routines-format.ts`
- `apps/mobile/src/lib/voice-playback.ts`
- `apps/web/src/components/chatList/RequestRows.tsx`
- `apps/web/src/components/Composer.tsx`
- `apps/web/src/components/ForwardPicker.tsx`
- `apps/web/src/components/MarkdownText.tsx`
- `apps/web/src/components/message/AlbumGrid.tsx`
- `apps/web/src/components/message/blocks/ButtonsBlock.tsx`
- `apps/web/src/components/message/blocks/FormBlock.tsx`
- `apps/web/src/components/MessageBubble.tsx`
- `apps/web/src/components/NewChatButton.tsx`
- `apps/web/src/components/ProgressCard.tsx`
- `apps/web/src/components/SelectionBar.tsx`
- `apps/web/src/components/tools/RoutinesSection.tsx`
- `apps/web/src/components/tools/toolDetailOps.ts`
- `apps/web/src/components/tools/ToolsSection.tsx`
- `apps/web/src/components/topic/AiActivityMarks.tsx`
- `apps/web/src/routes/NotificationsPage.tsx`
- `packages/chat-core/src/files.ts`
- `packages/chat-core/src/markdown-ast.ts`
- `packages/chat-core/src/media.ts`
- `packages/chat-core/src/index.ts`
- `packages/chat-core/src/blocks.ts`
- `packages/chat-core/src/messages.ts`
- `packages/chat-core/src/routines.ts`
- `packages/chat-core/src/topic-activity.ts`
- `packages/chat-core/src/format.ts`
- `packages/chat-core/src/text.ts`
- `packages/client-core/src/index.ts`
- `packages/client-core/src/album-members.ts`
- Test files next to those files (import path only).
- `apps/mobile/src/**` and `apps/web/src/**`: import lines only, for files that import a moved name (lead waiver for the fix round that removed the re-export shims).
- `work/T-2170-client-fn-copies.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat -- apps packages`.
- The Report lists each row: merged (where it lives now) or skipped (why).
- **Lead check:** web mock: a chat with cards (choice and form blocks), the new-chat filter, forward picker, selection bar, Notifications page, the AI tools and routines sections. Phone emulator: the same screens and the AIs tab.

---

## Report (written by the worker when done)

### Round

- Findings: 0 must-fix, 1 should-fix, 1 nit.
  - Finding 1 (seven import-only edits outside the original Allowed files): resolved by the lead's decision to keep them. The spec's Allowed files now cover import lines under `apps/mobile/src/**` and `apps/web/src/**`, so the gate reports no files outside scope. No code change.
  - Finding 2 (nit): restored the phone clause in the `canPostTo` comment in `packages/chat-core/src/messages.ts`. It now reads "A channel row is offered only where the caller may post; a plain member or an unknown role has no voice in the feed room."
- Tests added: none. The only code change is a comment, so there is no behaviour to test.
- Gate: `GATE PASS`, and scope reports every changed file inside the Allowed files.

```
PASS  install (frozen)  (1.1s)
PASS  format  (1.9s)
PASS  lint  (0.8s)
PASS  typecheck  (1.8s)
PASS  effect  (1.4s)
PASS  build @zilar/server  (0.5s)
PASS  tests @zilar/chat-core  (1.9s)
PASS  tests @zilar/client-core  (2.7s)
PASS  tests @zilar/mobile  (1.8s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: 17 soft-limit warnings (all pre-existing and at or below their size on main); no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### What I did

Moved each duplicated function to one shared copy. Where the kept copy took a clearer name, the call sites use the new name.

| # | Result |
| --- | --- |
| 1 | merged: `chosenAnswer` + `ChoiceAnswer` in `packages/chat-core/src/blocks.ts` |
| 2 | merged: `sentAnswer` + `FormAnswer` in `packages/chat-core/src/blocks.ts` |
| 3 | merged: `matchesContactFilter` in `packages/chat-core/src/text.ts` (was `matchesFilter`) |
| 4 | merged: `elapsedFor` in `packages/chat-core/src/blocks.ts` (the live check is inlined; each app keeps its own `isLive`) |
| 5 | merged: `deleteActionFor` in `packages/chat-core/src/messages.ts` |
| 6 | merged: `jidLocalpart` in `packages/chat-core/src/text.ts` |
| 7 | skipped: both copies are React components with different markup (`div`/web `Button` vs RN `View`/`Button`); only the render tree is duplicated |
| 8 | merged: `previewUrl` in `packages/chat-core/src/messages.ts` |
| 9 | merged: `chipLabel` in `packages/chat-core/src/messages.ts` |
| 10 | merged: `AlbumMembersProvider` + `useAlbumMembers` in `packages/client-core/src/album-members.ts`; both app modules re-export them |
| 11 | merged: `personOf` in `packages/chat-core/src/topic-activity.ts` |
| 12 | merged: `canPostTo` in `packages/chat-core/src/messages.ts` |
| 13 | merged: `targetLabel` in `packages/chat-core/src/text.ts` |
| 14 | merged: `withoutId` in `packages/chat-core/src/messages.ts` (was `without`) |
| 15 | merged: `deviceName` in `packages/chat-core/src/text.ts` |
| 16 | merged: `routineStatusText` in `packages/chat-core/src/routines.ts`; web's `statusText` call sites renamed |
| 17 | merged: `routineLastText` in `packages/chat-core/src/routines.ts`; web's `lastStatusText` call sites renamed |
| 18 | merged: `toolLastRunText` in `packages/chat-core/src/routines.ts`; web's `lastRunText` call sites renamed |
| 19 | merged: `runStatusText` in `packages/chat-core/src/routines.ts`; `toolDetailOps` re-exports it so `ToolDetailPanel` is unchanged |
| 20 | merged: kept `isGifVideoName` in `packages/chat-core/src/media.ts`; deleted the phone `isGifOrigin` |
| 21 | merged: kept `fileExtension` in `packages/chat-core/src/files.ts`; deleted the phone `extensionOf` |
| 22 | merged: kept `safeMarkdownUrl` in `packages/chat-core/src/markdown-ast.ts`, exported it from the chat-core index, and web imports it instead of `safeUrl` |
| 23 | merged: kept `tap` in `apps/mobile/src/components/chat/haptics.ts`; both `lightHaptic` copies deleted and their call sites use `tap` (aliased in `message-bubble` because a local gesture is also called `tap`) |
| 24 | merged: `withKey` in `packages/chat-core/src/messages.ts` (both copies were phone screen-local; no general mobile `lib/` file is in scope) |
| 25 | merged: kept `InfoGroup` in `apps/mobile/src/components/chat/topic-info-sheet.tsx` and exported it; `topic-add-sheet` now imports it instead of its own `AddGroup` |
| 26 | merged: `isLoadableMediaUrl` in `packages/chat-core/src/files.ts`; `attachment-message` re-exports the old name and `voice-playback` re-exports it as `isPlayableVoiceUrl` for existing callers |

The shared modules export through their package `index.ts` files. Comments that explain a why were kept once on the surviving copy. No tests were added or changed.

Fix round: removed every re-export shim left by the first pass. `apps/mobile/src/components/chat/album-members.tsx` is deleted and its importers use `@zilar/client-core`; `isLoadableMediaUrl` is imported from `@zilar/chat-core` (the `attachment-message` and `voice-playback` re-exports are gone, and `voice-message` uses `isLoadableMediaUrl`); the web album members come from `@zilar/client-core`; `runStatusText` is imported from `@zilar/chat-core` in `ToolDetailPanel`. The older `AttachmentViewer` and `SendFailure` re-exports were left alone. The voice gate one-line why ("the same gate as images; an untrusted voice shows its waveform but never loads.") is back beside the call in `apps/mobile/src/lib/voice-playback.ts`.

The fix round updates seven importers that were outside the original Allowed files (`album-grid`, `media-bubble`, `message-list`, `voice-message`, `MessageListRow`, `MessageMenuBody`, `ToolDetailPanel`), as the lead's fix instruction required; the lead has since allowed import lines under `apps/mobile/src/**` and `apps/web/src/**` in the spec.

### Checks run

`pnpm gate` (from the repo root):

```
PASS  install (frozen)  (1.0s)
PASS  format  (1.5s)
PASS  lint  (0.6s)
PASS  typecheck  (3.8s)
PASS  effect  (1.2s)
PASS  build @zilar/server  (0.5s)
PASS  tests @zilar/chat-core  (2.0s)
PASS  tests @zilar/client-core  (2.3s)
PASS  tests @zilar/mobile  (1.7s)
SKIP tests @zilar/web (no nearby test files)
scope: 7 file(s) outside the Allowed files:
  apps/mobile/src/components/chat/album-grid.tsx
  apps/mobile/src/components/chat/media-bubble.tsx
  apps/mobile/src/components/chat/message-list.tsx
  apps/mobile/src/components/chat/voice-message.tsx
  apps/web/src/components/MessageListRow.tsx
  apps/web/src/components/message/MessageMenuBody.tsx
  apps/web/src/components/tools/ToolDetailPanel.tsx
GATE PASS
```

No single test file was run separately; the gate ran the nearest tests for the touched packages. I did not run the web mock or the phone emulator checks, so the lead check in the spec is still open.

Line delta: the task branch is based on `91ff2a980`. Against that base, `git diff 91ff2a980 --numstat -- apps packages` gives 346 added, 541 deleted, net **-195** (the first round was -178; this round removes more lines). `main` has since advanced with T-2167/T-2168/T-2169/T-2172, so `git diff main --numstat` now includes those tasks and is not a clean measure of this branch.

### Notes for the lead

- Row 7 (`AddToTopicRow`) is the only skip: both copies are RN/DOM components with different markup and component imports, so there is no plain logic body to share.
- Rows 16–19 take structural parameter types in `chat-core/routines.ts` instead of importing `@zilar/api-contract`; chat-core does not depend on that package and adding the dependency was out of scope.
- Row 24 has no allowed general mobile `lib/` file, so `withKey` went to `chat-core/messages.ts` next to the other shared id-set helpers (`withoutId`).
- Row 26 re-exports keep the two phone modules' existing public names, so callers outside the allowed files (`album-grid`, `media-bubble`, `voice-message`) did not need edits. There is still one function body.


## Review (written by Claude)

Approved; the pre-review was clean after one lead fix round, one waiver and one autofix round. 2 nits: `isLoadableMediaUrl` parses the URL twice (pre-existing logic), and `withKey` sits in chat-core. Net −195 across 54 files.

**Moved once into chat-core or client-core:** 22 web/phone pure helpers and the album-members context: block answers, elapsed time, delete action, link preview, chips, picker rules, device names, the routine/tool texts. The phone dropped its copies of `isGifVideoName`, `fileExtension` and `safeMarkdownUrl`. One phone haptic `tap`, one `InfoGroup`.

**Skipped:** `AddToTopicRow`, which is markup in each app.

**Fix round:** removed the re-export shims (`isPlayableVoiceUrl`, `runStatusText`, `AlbumMembersProvider`…); importers now import from the package. Restored the voice "untrusted voice never loads" why and the `canPostTo` clause. The lead waived the scope note for the import-only edits.

**Web mock**, identical to main: the cards topic, the Notifications devices, the AI panel tools and routines texts. No page errors.

**Phone emulator smoke passed:** the blocks catalog (album, file card), Routines, Edit Dev-1, the dev-team chat (progress card elapsed time), Notifications, Ana's chat.
