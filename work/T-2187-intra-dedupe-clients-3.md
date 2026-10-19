---
id: T-2187
title: "Clean-up (web and phone, wave 3 (5-line repeats)): repeated blocks inside one file become one helper or one loop; no behaviour change"
status: merged
milestone: M5
branch: task/T-2187-intra-dedupe-clients-3
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2187: One copy of each block repeated inside a file (web and phone, wave 3 (5-line repeats))

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead scanned each file at `50efd48ab` for runs of 6 or more normalised lines (comments, blanks, imports and lone braces ignored) that appear twice or more in the same file. The ranges below are where the copies sit; the groups are separated by `;`.

| File (lines) | Repeated ranges |
| --- | --- |
| `apps/web/src/components/ais/AiDangerZone.tsx` (198) | 91-123, 154-186 |
| `apps/web/src/components/PinnedBanner.tsx` (165) | 53-67, 147-162 |
| `apps/mobile/src/components/chat/pinned-banner.tsx` (137) | 45-58, 75-88 |
| `apps/web/src/components/ChatBackgroundDialog.tsx` (534) | 100-110, 224-234 |
| `apps/mobile/src/components/chat/chat-search-results.tsx` (392) | 207-212, 318-323 ; 225-230, 326-331 ; 272-278, 337-343 |
| `apps/mobile/src/components/chat/visibility-fields.tsx` (342) | 236-242, 260-266, 288-294 |
| `apps/web/src/components/channel-info/ChannelPeople.tsx` (191) | 52-56, 148-152 ; 99-108, 113-122 |
| `apps/mobile/src/app/settings/stickers.tsx` (717) | 482-488, 606-612 ; 63-67, 442-446, 546-550 |
| `apps/mobile/src/components/chat/message-list.tsx` (641) | 103-109, 538-544 ; 113-118, 386-391 |
| `apps/mobile/src/components/chat/media-sheet.tsx` (493) | 126-130, 186-190 ; 34-39, 116-121 ; 396-401, 451-456 |
| `apps/mobile/src/components/group-info/root-page.tsx` (492) | 169-177, 219-227 |
| `apps/web/src/components/composer/useRecordingLifecycle.ts` (156) | 13-18, 62-67 ; 29-36, 48-55 |
| `apps/web/src/components/ais/AiPanel.tsx` (657) | 137-142, 197-202, 284-289 |
| `apps/mobile/src/components/chat/blocks/choice-blocks.tsx` (568) | 42-72, 117-147 |
| `apps/mobile/src/app/me.tsx` (473) | 140-147, 158-165 |
| `apps/mobile/src/components/chat/voice-message.tsx` (456) | 118-125, 131-138 |
| `apps/mobile/src/lib/attachment-picker.ts` (436) | 303-310, 377-384 |
| `apps/mobile/src/components/chat/topic-add-sheet.tsx` (365) | 105-111, 313-318 ; 124-129, 327-332 |
| `apps/web/src/components/panels/GroupRolesSection.tsx` (260) | 138-142, 160-164, 183-187, 197-201 ; 139-143, 161-165 |
| `apps/mobile/src/lib/app-update-native.ts` (229) | 158-167, 194-203 |
| `apps/mobile/src/components/integrations/card-fields.tsx` (163) | 94-101, 116-123 |
| `apps/web/src/components/message/blocks/ChoiceBlocks.tsx` (158) | 29-37, 96-104 |

### Steps
For each group, read every copy:
1. **Same code:** keep one copy, as a local helper, a shared row-to-view mapper, a loop over a small table, or a shared JSX piece in the same file. Make the other places use it.
2. **Same shape, different data:** pass the difference as a parameter only when the result is shorter. Otherwise skip the group.
3. **A call site, not a copy:** skip the group when the repeat is only a call site or a destructure.
4. **Keep the sum smaller:** a helper must save more lines than it adds. If it doesn't, revert it and say so in the Report.

### Rules
- No behaviour change: the same SQL, the same values and order, the same log texts, the same markup, labels and styles.
- Keep every "why" comment, once.
- No new tests. Run the nearest existing tests with `--reporter=dot`.
- Do not touch `apps/*/src/store/**` or `apps/*/src/auth/**`.
- Earlier waves already merged what was clearly shorter. Merge only when the result is shorter, and skip repeated JSX that a helper would make harder to read; say why for each skip.
- Twin files (web `PinnedBanner.tsx` and phone `pinned-banner.tsx`) are separate apps: dedupe inside each file only.

### Allowed files
- `apps/web/src/components/ais/AiDangerZone.tsx`
- `apps/web/src/components/PinnedBanner.tsx`
- `apps/mobile/src/components/chat/pinned-banner.tsx`
- `apps/web/src/components/ChatBackgroundDialog.tsx`
- `apps/mobile/src/components/chat/chat-search-results.tsx`
- `apps/mobile/src/components/chat/visibility-fields.tsx`
- `apps/web/src/components/channel-info/ChannelPeople.tsx`
- `apps/mobile/src/app/settings/stickers.tsx`
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/components/chat/media-sheet.tsx`
- `apps/mobile/src/components/group-info/root-page.tsx`
- `apps/web/src/components/composer/useRecordingLifecycle.ts`
- `apps/web/src/components/ais/AiPanel.tsx`
- `apps/mobile/src/components/chat/blocks/choice-blocks.tsx`
- `apps/mobile/src/app/me.tsx`
- `apps/mobile/src/components/chat/voice-message.tsx`
- `apps/mobile/src/lib/attachment-picker.ts`
- `apps/mobile/src/components/chat/topic-add-sheet.tsx`
- `apps/web/src/components/panels/GroupRolesSection.tsx`
- `apps/mobile/src/lib/app-update-native.ts`
- `apps/mobile/src/components/integrations/card-fields.tsx`
- `apps/web/src/components/message/blocks/ChoiceBlocks.tsx`
- `work/T-2187-intra-dedupe-clients-3.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat`.
- The Report lists each group: merged (lines saved) or skipped (why).
- **Lead check:** web mock: the pinned banner, the chat background dialog, an AI's danger zone, channel people, group roles. Phone emulator: the pinned banner, chat search results, visibility fields, Settings → Stickers, the media sheet, group info, a voice message, me.

---

## Report (written by the worker when done)

### What I did

Deduped the repeated blocks listed in the spec inside 12 files, keeping markup, labels, styles, SQL-free data flow and order unchanged. No new dependencies and no tests were added.

Merged groups (net lines saved per `git diff main --numstat`):
- `ChannelPeople.tsx` (99-108, 113-122): the Admins/Subscribers row lists now come from one small table mapped with `Fragment` (-7).
- `stickers.tsx` (63-67, 442-446, 546-550): one `ActionError` component for the three alert rows (-4).
- `media-sheet.tsx` (126-130, 186-190): `EMPTY_SHEET_STATE` shared by the initial state and `selectTab`; (34-39, 116-121): `MediaSheetContentProps` extends `SheetState`; (396-401, 451-456): one `MediaItemRowProps` for `MediaRow`, `FileRow`, `LinkRow`, `VoiceRow` (-28).
- `useRecordingLifecycle.ts` (29-36, 48-55): one `releaseRecorder` `useCallback` used by the unmount cleanup and the chat switch (-7).
- `AiPanel.tsx` (137-142, 197-202, 284-289): one `AiSectionProps` for the three sections (-13).
- `choice-blocks.tsx` mobile (42-51, 117-126): one `useChoiceSelection` hook for the state, `selected` correction and `disabled`; the two `press` functions stay because their payloads and replies differ (-5).
- `me.tsx` (140-147, 158-165): one `catchAvatarError` Effect handler (-5).
- `voice-message.tsx` (118-125, 131-138): one `shared` object spread into `claim`/`resign` (-12).
- `topic-add-sheet.tsx` (105-111, 313-318): one `TopicAddBaseProps` extended by both prop types (-5).
- `app-update-native.ts` (158-167, 194-203): one `parseStoredObject` for the two readers (-4).
- `card-fields.tsx` (94-101, 116-123): one `ActionButtonProps` shared by `SaveButton`/`RemoveButton` (-7).
- `ChoiceBlocks.tsx` web (29-37, 96-104): one `useBlockSelection` hook for both blocks (-3).

Skipped groups:
- `AiDangerZone.tsx` (91-123, 154-186): a `ConfirmActions` helper was written and reverted; with the inline cancel handlers the call sites plus the helper were longer than the two copies (net +9).
- `PinnedBanner.tsx` web (53-67, 147-162): a `PinsError` helper was written and reverted; the helper plus two calls did not shrink the file (net +9).
- `pinned-banner.tsx` mobile (45-58, 75-88): same, reverted (net +1).
- `ChatBackgroundDialog.tsx` (100-110, 224-234): one side is the function's destructure, the other is the call that builds it; rule 3, no shorter merge.
- `chat-search-results.tsx` (207-212/318-323, 225-230/326-331): prop destructure and prop types. (272-278/337-343): the same `<PeopleSearchResult>` call in two components; a wrapper would add lines. Skipped.
- `visibility-fields.tsx` (236-242, 260-266, 288-294): repeated parameter lists and return types in three function signatures; a `CreateGuardResult` alias would save at most one line. Skipped.
- `GroupRolesSection.tsx` (action button prop runs): a `RoleButton` helper was written and reverted; seven call sites plus the helper were longer than the inline buttons (net +9).
- `message-list.tsx` (103-109, 538-544; 113-118, 386-391): destructured props and dependency arrays. Skipped.
- `group-info/root-page.tsx` (169-177, 219-227): a `TopicIdentity` helper was written and reverted; break-even (net 0).
- `attachment-picker.ts` (303-310, 377-384): the second copy omits `Effect.catchDefect`; sharing it would change behaviour. Skipped.
- `ChannelPeople.tsx` (52-56, 148-152): the avatar/name/role JSX is five lines; a component was longer. Skipped.
- `stickers.tsx` (482-488, 606-612): the overlapping Remove-button lines differ in context (Discover's added-state Check+Remove vs Packs' Remove-only), so they are not the same block. Skipped.
- `topic-add-sheet.tsx` (124-129, 327-332): the two prop destructures are a destructure, not a copy (rule 3). Skipped.
- `useRecordingLifecycle.ts` (13-18, 62-67): one side is the voice destructure, the other the dependency array (rule 3). Skipped.

No behaviour, markup, label, style, log text, value or order changed. The two `PinnedBanner` twins were handled only inside their own files.

### Checks run

- `pnpm install`: done (12.8s).
- `pnpm gate` from the repo root, final run:
  - `gate: 13 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`
  - `SKIP build @zilar/server`, `PASS tests @zilar/mobile`, `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
  - `GATE PASS`
- No single test file exists for the touched UI files; the gate ran the nearest mobile tests (`@zilar/mobile`, 1.7s) and skipped web (no nearby test files). I did not run any separate test command.
- `git diff main --numstat` on product files: 146 added, 246 removed, net **+100 lines saved** (the task file is excluded; it is new on this branch versus main).

### Notes for the lead

- The Report lists every group as merged or skipped with the reason; the skipped helpers were written, checked against the line count and reverted, as rule 4 asks.
- Nothing was pushed or merged. Status set to review.

### Round

- Finding 1 (should-fix, report-only): added the three missing skipped groups — `stickers.tsx` (482-488, 606-612), `topic-add-sheet.tsx` (124-129, 327-332), `useRecordingLifecycle.ts` (13-18, 62-67) — with the reason each is not merged. No product code changed.
- Tests added: none; the finding names no test and the change is report-only.
- `pnpm gate` from the repo root: `GATE PASS` (`PASS install`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/mobile`, `SKIP tests @zilar/web (no nearby test files)`); `scope: every changed file is inside the Allowed files`.

## Review (written by Claude)

Approved; the pre-review was clean after one autofix round. Net −100 across 12 files.

**Merged:** blocks repeated inside one file became one helper or loop, in:
- the phone: media sheet, voice message, choice blocks, Settings → Stickers, Me, topic add sheet, card fields, app update;
- the web: AI panel, channel people, recording lifecycle, choice blocks.

**Skipped, with reasons:** repeated JSX where a helper would read worse.

**Comments:** only a duplicate of the room-correction note went; it stays once in `choice-blocks.tsx`.

**Web mock, identical to main:** the cards topic (choice card), Notifications, the AI panel tools and routines. No page errors.

**Phone emulator smoke passed:**
- Me, Stickers, Integrations;
- Ana's media sheet (Media, Files, Links and Voice tabs);
- the blocks catalog (buttons, poll, pick-one selected and open, quick form).
