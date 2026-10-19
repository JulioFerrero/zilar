---
id: T-2161
title: "Clean-up (web, phone, packages, wave 2): repeated blocks inside one file become one helper or one loop; no behaviour change"
status: merged
milestone: M5
branch: task/T-2161-intra-dedupe-clients-2
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2161: One copy of each block repeated inside a file (web, phone, packages, wave 2)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead scanned each file at `9766414d5` for runs of 6 or more normalised lines (comments, blanks, imports and lone braces ignored) that appear twice or more in the same file. The ranges below are where the copies sit; the groups are separated by `;`.

| File (lines) | Repeated ranges |
| --- | --- |
| `apps/mobile/src/app/settings/integrations.tsx` (627) | 232-238, 353-359 ; 240-245, 365-370 ; 241-246, 366-371, 466-471 ; 384-390, 486-492 |
| `apps/web/src/components/panels/TopicAddDialog.tsx` (375) | 293-346, 310-363 ; 300-306, 318-324 ; 334-339, 350-355 |
| `apps/mobile/src/components/chat/blocks/chart-blocks.tsx` (320) | 40-57, 229-246 |
| `apps/web/src/components/ChatBackgroundDialog.tsx` (534) | 100-110, 224-234 |
| `apps/mobile/src/components/chat/chat-search-results.tsx` (401) | 216-221, 327-332 ; 234-239, 335-340 ; 281-288, 346-353 ; 38-43, 82-87 |
| `packages/desk/src/tools/index.ts` (393) | 191-202, 271-282 ; 70-75, 331-336 |
| `apps/mobile/src/components/chat/visibility-fields.tsx` (343) | 235-254, 276-295 |
| `apps/mobile/src/components/group-info/root-page.tsx` (492) | 169-178, 219-228 |
| `apps/web/src/routes/NotificationsPage.tsx` (438) | 165-170, 244-249 ; 337-342, 352-357 ; 48-53, 367-372 ; 73-79, 384-390 |
| `apps/mobile/src/components/chat/invite-links-sheet.tsx` (347) | 245-254, 287-296 |
| `packages/devtools/src/xmpp-e2e/push-pending.ts` (252) | 172-182, 220-230 |
| `apps/web/src/components/channel-info/ChannelPeople.tsx` (191) | 99-108, 113-122 |
| `apps/mobile/src/components/chat/attachment-message.tsx` (171) | 76-85, 139-148 |
| `apps/mobile/src/components/settings/use-profile-settings.ts` (595) | 498-504, 534-540, 549-555 |
| `apps/web/src/routes/IntegrationsPage.tsx` (544) | 126-131, 468-473 ; 165-170, 447-452 ; 53-61, 374-382 |
| `apps/mobile/src/lib/attachment-picker.ts` (444) | 311-318, 385-392 ; 40-45, 71-76 |
| `apps/mobile/src/components/chat/media-bubble.tsx` (386) | 302-310, 342-350 |
| `packages/devtools/src/lead/autopilot.ts` (245) | 55-64, 178-187, 208-217 |
| `packages/client-core/src/tools-api.ts` (123) | 7-15, 23-31 |

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

### Allowed files
- `apps/mobile/src/app/settings/integrations.tsx`
- `apps/web/src/components/panels/TopicAddDialog.tsx`
- `apps/mobile/src/components/chat/blocks/chart-blocks.tsx`
- `apps/web/src/components/ChatBackgroundDialog.tsx`
- `apps/mobile/src/components/chat/chat-search-results.tsx`
- `packages/desk/src/tools/index.ts`
- `apps/mobile/src/components/chat/visibility-fields.tsx`
- `apps/mobile/src/components/group-info/root-page.tsx`
- `apps/web/src/routes/NotificationsPage.tsx`
- `apps/mobile/src/components/chat/invite-links-sheet.tsx`
- `packages/devtools/src/xmpp-e2e/push-pending.ts`
- `apps/web/src/components/channel-info/ChannelPeople.tsx`
- `apps/mobile/src/components/chat/attachment-message.tsx`
- `apps/mobile/src/components/settings/use-profile-settings.ts`
- `apps/web/src/routes/IntegrationsPage.tsx`
- `apps/mobile/src/lib/attachment-picker.ts`
- `apps/mobile/src/components/chat/media-bubble.tsx`
- `packages/devtools/src/lead/autopilot.ts`
- `packages/client-core/src/tools-api.ts`
- `work/T-2161-intra-dedupe-clients-2.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat`.
- The Report lists each group: merged (lines saved) or skipped (why).
- **Lead check:** web mock: topic add dialog, chat background dialog, notifications and integrations pages, channel people. Phone emulator: Settings → Integrations, the chart blocks in the blocks catalog, chat search results, the visibility sheet, group info, invite links, attachments and media bubbles.

---

## Report (written by the worker when done)

### What I did

Merged the repeated intra-file blocks below, with no behaviour change: the same markup, labels, styles, values and order. 13 product files changed; product lines are +203 / -321, net **-118** (see the `git diff main --numstat` line at the end of this section).

Per group from the spec table:

- `apps/mobile/src/app/settings/integrations.tsx`
  - 232-238, 353-359: **skipped.** The run is the shared tail of three `<SecretField>` calls whose label, value, placeholder, maxLength, show and showLabel all differ; a wrapper adds more props than it removes.
  - 240-245, 365-370 and 241-246, 366-371, 466-471: **merged** into `SaveError` (3 copies; one component). 1 line saved.
  - 384-390, 486-492: **skipped.** The two `RemoveConfirmDialog` calls differ by title and body; a wrapper must repeat those plus forward four fields, which is longer than the two calls.
- `apps/web/src/components/panels/TopicAddDialog.tsx`
  - 293-346 / 310-363, 300-306 / 318-324, 334-339 / 350-355: **merged.** The four `AddRow` map blocks became `personRows` and `aiRows`; the optional `tag` is passed through a conditional spread so `exactOptionalPropertyTypes` stays happy. 23 lines saved.
- `apps/mobile/src/components/chat/blocks/chart-blocks.tsx`
  - 40-57, 229-246: **merged** into `BlockHeading`, with the value colour passed as a class name. 2 lines saved.
- `apps/web/src/components/ChatBackgroundDialog.tsx`
  - 100-110, 224-234: **skipped.** One is the function parameter destructure and the other the object literal at its call site (rule 3); there is no repeated logic.
- `apps/mobile/src/components/chat/chat-search-results.tsx`
  - 216-221 / 327-332, 234-239 / 335-340, 281-288 / 346-353: **skipped.** Prop destructures, a prop type list and a component call site (rule 3).
  - 38-43, 82-87: **merged** into the `PeopleSearchOptions` type. 5 lines saved.
- `packages/desk/src/tools/index.ts`
  - 191-202 / 271-282 and 70-75 / 331-336: **skipped and reverted.** `commandFailure` and `tooLargeOutcome` left the file at 392 lines (net 0), so rule 4 says revert rather than add an abstraction that does not shrink the file.
- `apps/mobile/src/components/chat/visibility-fields.tsx`
  - 235-254, 276-295: **merged** into `createGuard(kind, …)`, keeping both exported signatures and the exact sentences. 1 line saved.
- `apps/mobile/src/components/group-info/root-page.tsx`
  - 169-178, 219-228: **skipped and reverted.** A `TopicLabel` component produced the same 491 lines (net 0); rule 4 says revert.
- `apps/web/src/routes/NotificationsPage.tsx`
  - 165-170, 244-249: **skipped.** Only the shared closing markup of two different rows (a device `Remove` and a chat `Unmute`); the content and buttons differ.
  - 337-342, 352-357: **merged** into `DeviceStatusCard` (the unsupported and server-off cards).
  - 48-53, 367-372 and 73-79, 384-390: **merged.** The `onlyWhileOpen` inline card now uses `ThisDeviceCard`; its `state` prop union gained `'Only while open'` so the same markup and behaviour are reused. 18 lines saved in this file.
- `apps/mobile/src/components/chat/invite-links-sheet.tsx`
  - 245-254, 287-296: **merged** into the shared `InviteLinkRowProps` type. 13 lines saved.
- `packages/devtools/src/xmpp-e2e/push-pending.ts`
  - 172-182, 220-230: **skipped.** The block is the same setup, but keeping the existing partial-connect cleanup (`alice.stop()` when bob's connect fails) and the per-user locals makes a helper save about one line.
- `apps/web/src/components/channel-info/ChannelPeople.tsx`
  - 99-108, 113-122: **skipped.** Two `<SubscriberRow>` call sites over two lists (rule 3).
- `apps/mobile/src/components/chat/attachment-message.tsx`
  - 76-85, 139-148: **merged** into a `pressableProps` object spread onto both `Pressable`s. 6 lines saved.
- `apps/mobile/src/components/settings/use-profile-settings.ts`
  - 498-504, 534-540, 549-555: **merged** into `failAvatar`. 7 lines saved.
- `apps/web/src/routes/IntegrationsPage.tsx`
  - 126-131, 468-473: **merged** into `RemoveButton`.
  - 165-170, 447-452: **merged** into `SaveError` (used for 4 copies in the file).
  - 53-61, 374-382: **skipped.** The run includes the end of `useIntegrationSave` options plus the derived `busy/saved/failure/errorMessage`; the error tag and missing-input sentence differ, and a generic helper would need those as parameters and be longer.
  - 14 lines saved in this file.
- `apps/mobile/src/lib/attachment-picker.ts`
  - 311-318, 385-392: **skipped.** The two readers differ by a `catchDefect` guard; a common helper saves about two lines.
  - 40-45, 71-76: **merged.** `AssetInput` is now declared once and reused by `pickedFile`. 8 lines saved.
- `apps/mobile/src/components/chat/media-bubble.tsx`
  - 302-310, 342-350: **merged** into a `pressableProps` object spread onto both `Pressable`s. 6 lines saved.
- `packages/devtools/src/lead/autopilot.ts`
  - 55-64, 178-187, 208-217: **merged** into `reportError`, keeping the one "Logging must never break the loop." comment. 14 lines saved.
- `packages/client-core/src/tools-api.ts`
  - 7-15, 23-31: **skipped.** An import list and its matching re-export (rule 3).

Net from `git diff main --numstat` (excluding `work/`): **+203 / -321, net -118 lines**.

### Checks run

- `pnpm install` — Done in 16s using pnpm v10.32.1.
- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/file-tools.test.ts` — 1 file passed, 3 tests passed. (The desk edit was later reverted under rule 4.)
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/autopilot.test.ts` — 1 file passed, 3 tests passed.
- `pnpm gate` from the repo root — **GATE PASS**:

```
PASS  install (frozen)  (1.5s)
PASS  format  (1.8s)
PASS  lint  (1.0s)
PASS  typecheck  (3.0s)
PASS  effect  (0.8s)
PASS  build @zilar/server  (0.6s)
PASS  tests @zilar/devtools  (1.2s)
PASS  tests @zilar/mobile  (2.4s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Notes for the lead

- No behaviour change was intended: markup, labels, styles, values and order are unchanged. The only type change is widening `ThisDeviceCard`'s `state` union to include `'Only while open'`, so the inline card could reuse it.
- Two extractions that would have centralised duplicated markup (`TopicLabel` in `root-page.tsx`, the `runCommand` failure helpers in `desk/src/tools/index.ts`) were reverted because they made no net line saving, per the task's rule 4.
- I added no tests. The web files have no nearby unit tests; the gate's phone/web smoke is the lead's check as listed in the task.
- Not tested here: the web and phone UI itself. I only ran typecheck, lint, format and the package tests; the lead's mock/emulator smoke still needs to cover the screens in the task.


## Review (written by Claude)

Approved; the pre-review was clean. Net −118 across 13 files: nine phone files, three web pages and devtools `autopilot.ts`. In `autopilot.ts`, one `reportError` helper keeps the "Logging must never break the loop" comment once. No other comment was lost.

**Web mock** (output identical to main):
- the topic add dialog's People and AIs tabs;
- Notifications;
- Integrations;
- no page errors.

**Phone emulator:**
- The smoke passed: Ana's chat, Integrations, the blocks catalog (bar chart, weather, event, place), Dev team group info, the dev-team chat.
- Chat-list search shows people and message results with the match highlighted.
