# Code reduction scan (read-only)

- Date: 2026-10-18
- Branch: `task/T-2013-reduce-code-scan`
- Worktree HEAD when measured: `5789e0333` (task spec commit on top of `f11c106ff`)
- Scope: `apps/*/src` and `packages/*/src`. Nothing in this task changed code, configs or `package.json`; tool output lives in `/tmp/zilar-T-2013/`.

## Tools and commands

Versions were picked with `npm view <tool> version` on 2026-10-18 and every run used `pnpm dlx` with that exact version.

| Tool | Version | Command |
| --- | --- | --- |
| jscpd | `5.4.1` | `nice -n 10 pnpm dlx jscpd@5.4.1 --min-lines 8 --min-tokens 70 --reporters json --absolute --output /tmp/zilar-T-2013/jscpd-final --ignore '<ignores>' apps/*/src packages/*/src` |
| knip | `6.42.0` | `nice -n 10 pnpm dlx knip@6.42.0 --no-progress --include files,exports,types,dependencies --reporter json --no-exit-code > /tmp/zilar-T-2013/knip.json` |

jscpd ignore list: `**/*.test.*`, `**/test-*`, `**/test/**`, `**/mocks/**`, `**/mock/**`, `**/mock-backend/**`, `**/generated/**`, `**/dist/**`, `**/node_modules/**`.

Per-unit jscpd percentages were measured by running the same command once per `apps/*/src` and `packages/*/src` directory, writing to `/tmp/zilar-T-2013/per-pkg-final/<unit>/jscpd-report.json`. That file also carries the raw JSON for the overall run and for every unit.

## Summary

| Area | Measured volume | Estimated deletable lines | Notes |
| --- | --- | ---: | --- |
| Duplication (jscpd) | 4,558 duplicated lines in 260 clones over 275,060 scanned lines (1.66%) | up to 4,558 | Counts each clone once. Includes 1,119 lines in clones that span `apps/web` and `apps/mobile` (55 clusters). |
| Unused code (knip) | 25 unused files (2,524 lines); 1,393 unused exports and 516 unused types in 513 files; 5 unused dependencies and 8 unused devDependencies | 174 confirmed + up to 1,909 | 174 lines are files with no importer at all. 20 of the 25 files are entry points, Expo plugins or build scripts (false positives). The 1,909 = one line per unused export/type, an upper bound (removing only the `export` keyword frees no line). |
| Web/phone twins | 224 same-name modules (219 non-test), 600 exact shared lines across 25 pairs | not additive | The 600 lines also appear in the duplication total. 55 cross-app clones total 1,119 lines. |
| Hand-rolled helpers | 13 kinds, 57 local sites (section 4) | ~540 | Hand count, not a tool: 394 lines are the mobile Markdown parser; ~150 lines are the other helper bodies. |
| This document | `docs/audit/reduce-scan.md` | 0 | Measurement only. |

Upper bound if every measured item is removed once: 4,558 (duplication) + 174 (dead files) + up to 1,909 (export lines) + ~150 (non-Markdown helper bodies) ≈ 6,800 lines. The mobile Markdown parser is already inside the duplication/helper count, so it is not added twice. Overlaps between duplication and twins are not subtracted.

---

## 1. Duplication (jscpd 5.4.1)

### Overall and per unit

Overall run: **260 clones, 4,558 duplicated lines of 275,060 (1.66%)**, 1,931 files scanned.

| Unit | Duplicated lines | Scanned lines | Duplicated % | Clones |
| --- | ---: | ---: | ---: | ---: |
| `apps/mobile` | 1,060 | 81,640 | 1.30% | 63 |
| `apps/runner` | 0 | 1,576 | 0.00% | 0 |
| `apps/server` | 1,116 | 81,662 | 1.37% | 71 |
| `apps/web` | 701 | 61,172 | 1.15% | 41 |
| `packages/api-contract` | 0 | 4,945 | 0.00% | 0 |
| `packages/chat-core` | 0 | 5,623 | 0.00% | 0 |
| `packages/client-core` | 105 | 8,780 | 1.20% | 7 |
| `packages/desk` | 43 | 4,298 | 1.00% | 3 |
| `packages/devtools` | 109 | 15,724 | 0.69% | 6 |
| `packages/mock-backend` | excluded | 0 | – | – |
| `packages/protocol` | 0 | 1,585 | 0.00% | 0 |
| `packages/runner-tunnel` | 15 | 2,976 | 0.50% | 1 |
| `packages/ui-tokens` | 0 | 201 | 0.00% | 0 |
| `packages/xmpp-core` | 0 | 4,878 | 0.00% | 0 |

The per-unit runs see only clones inside that unit and sum to 3,149 lines. The overall run sees 4,558, so **1,409 duplicated lines are clones that span two units** (mostly `apps/web`↔`apps/mobile`, listed below).

`packages/mock-backend` was excluded as mocks. `packages/ball-avatar` has no `src` directory (its code is `index.ts` at the package root), so it was outside the requested globs.

By file type in the overall run:

| Format | Clones | Duplicated lines | Lines | % |
| --- | ---: | ---: | ---: | ---: |
| tsx | 114 | 2,053 | 92,771 | 2.21% |
| typescript | 142 | 2,434 | 179,238 | 1.36% |
| css | 4 | 71 | 1,766 | 4.02% |
| javascript / json / markup | 0 | 0 | 1,285 | 0.00% |

### The 40 largest clone clusters

`Location` is `file:start-end`. "Guess" is a one-line reading of the copied text.

| # | Lines | Tokens | Location A | Location B | Guess |
| ---: | ---: | ---: | --- | --- | --- |
| 1 | 97 | 665 | `apps/mobile/src/types/xmpp.d.ts:6-102` | `packages/xmpp-core/src/types/xmpp.d.ts:4-104` | Ambient `@xmpp/client` type declarations, copied verbatim. |
| 2 | 47 | 146 | `apps/mobile/src/components/ais/computer-picker.tsx:13-59` | `apps/web/src/components/ais/AiComputerSection.tsx:14-60` | AI computer (desk) picker list and selection UI. |
| 3 | 47 | 211 | `apps/mobile/src/lib/composer-drafts.ts:200-246` | `apps/web/src/lib/composer-drafts.ts:121-167` | Composer draft persistence: read/write a draft per chat. |
| 4 | 44 | 200 | `apps/mobile/src/components/chat/topic-not-in-row.tsx:63-106` | `apps/web/src/components/topic/TopicNotInRow.tsx:45-88` | "Topic not in row" notice card (join/ask) twin UI. |
| 5 | 42 | 202 | `apps/mobile/src/lib/chat-list-cache.ts:18-59` | `apps/web/src/store/chatListCache.ts:9-53` | Persisted chat-list cache envelope and version check. |
| 6 | 38 | 186 | `apps/mobile/src/lib/use-client-version.ts:30-67` | `apps/web/src/lib/useClientVersionCheck.ts:34-71` | Client version check hook: fetch, compare, error state. |
| 7 | 37 | 231 | `apps/web/src/components/LinkText.tsx:62-98` | `apps/web/src/components/LinkText.tsx:106-142` | Linkify/token rendering body repeated inside one component. |
| 8 | 35 | 114 | `apps/server/src/actions/recovery.ts:41-75` | `apps/server/src/agents/log/retention.ts:67-88` | Background sweep loop: claim rows, log and continue on error. |
| 9 | 34 | 208 | `apps/mobile/src/components/contacts/use-people-prefix-search.ts:62-95` | `apps/web/src/lib/usePeopleSearch.ts:65-98` | Case-insensitive name/handle prefix search hook. |
| 10 | 34 | 112 | `apps/server/src/actions/recovery.ts:42-75` | `apps/server/src/approvals/sweeper.ts:74-105` | Scheduled sweep scaffolding: interval, error log, continue. |
| 11 | 34 | 71 | `packages/api-contract/src/chat-folders.ts:8-41` | `packages/chat-core/src/folders.ts:3-34` | Folder icon/name constants and schema mirrored across packages. |
| 12 | 32 | 111 | `apps/mobile/src/components/chat/blocks/block-icons.ts:28-59` | `apps/web/src/components/message/blocks/blockIcons.ts:28-59` | Lucide icon map for every block kind. |
| 13 | 32 | 153 | `apps/server/src/card-media/sniff.ts:46-77` | `apps/server/src/card-media/strip.ts:16-45` | Byte-buffer scanning helpers (magic-byte sniff and strip). |
| 14 | 30 | 235 | `apps/mobile/src/app/chat/[id].tsx:94-123` | `apps/mobile/src/app/chat/[id].tsx:134-163` | Chat screen header/body layout duplicated branch in one file. |
| 15 | 30 | 164 | `apps/web/src/components/message/AttachmentBody.tsx:170-199` | `apps/web/src/components/message/AttachmentBody.tsx:257-285` | Attachment body layout repeated for two media variants. |
| 16 | 29 | 97 | `apps/mobile/src/app/settings/blocked.tsx:63-91` | `apps/mobile/src/app/settings/requests.tsx:72-98` | Blocked/request list row state machine. |
| 17 | 29 | 247 | `apps/mobile/src/components/chat/entity-avatar.tsx:46-74` | `apps/web/src/components/EntityAvatar.tsx:46-74` | Avatar URL resolution and initials fallback. |
| 18 | 29 | 86 | `apps/mobile/src/components/chat/new-message-sheet.tsx:11-39` | `apps/web/src/components/NewMessageDialog.tsx:10-33` | New-message picker state and row list. |
| 19 | 29 | 86 | `apps/mobile/src/components/chat/selection-bar.tsx:15-43` | `apps/web/src/components/SelectionBar.tsx:7-34` | Multi-select action bar (copy/delete/forward). |
| 20 | 29 | 143 | `apps/mobile/src/store/offline-cache.ts:66-94` | `apps/web/src/store/messageCache.ts:25-48` | Per-chat message cache envelope and trim. |
| 21 | 29 | 153 | `apps/server/src/routines/schedule.ts:84-112` | `apps/server/src/tools/schemas.ts:149-177` | Zod schema factory / schedule field definitions. |
| 22 | 28 | 152 | `apps/mobile/src/auth/AuthFlow.tsx:141-168` | `apps/mobile/src/auth/NameForm.tsx:52-79` | Name entry form and validation. |
| 23 | 28 | 172 | `apps/mobile/src/components/chat/progress-card.tsx:16-43` | `apps/web/src/components/ProgressCard.tsx:13-40` | Progress-card body and step rendering. |
| 24 | 28 | 172 | `apps/server/src/tools/hosts.ts:30-57` | `apps/server/src/tools/hosts.ts:98-125` | Host tool argument handling repeated for two tools. |
| 25 | 27 | 149 | `apps/mobile/src/app/welcome/handle.tsx:129-155` | `apps/mobile/src/auth/AuthFlow.tsx:142-168` | Handle form field and validation. |
| 26 | 26 | 146 | `apps/mobile/src/app/welcome/handle.tsx:132-157` | `apps/mobile/src/auth/AuthFlow.tsx:145-169` | Handle submit/claim flow. |
| 27 | 26 | 130 | `apps/mobile/src/components/chat/blocks/buttons-block.tsx:11-36` | `apps/web/src/components/message/blocks/ButtonsBlock.tsx:22-47` | Block buttons row: labels and press handling. |
| 28 | 26 | 78 | `apps/mobile/src/components/chat/chat-picker-list.tsx:10-35` | `apps/web/src/components/ForwardPicker.tsx:9-35` | Chat picker list with search. |
| 29 | 26 | 156 | `apps/server/src/audit/list.ts:257-282` | `apps/server/src/topics/access.ts:154-179` | SQL access predicate / visibility filter. |
| 30 | 26 | 143 | `apps/server/src/media/extract.ts:27-52` | `packages/chat-core/src/links.ts:24-46` | URL/entity extraction from message text. |
| 31 | 25 | 96 | `apps/mobile/src/app/settings/blocked.tsx:63-87` | `apps/mobile/src/app/settings/contacts.tsx:74-98` | Settings list row and empty state. |
| 32 | 25 | 142 | `apps/mobile/src/store/effects/history-ctx.ts:24-48` | `apps/mobile/src/store/effects/lifecycle.ts:59-81` | History context adapter wiring. |
| 33 | 25 | 181 | `apps/mobile/src/types/xmpp.d.ts:6-30` | `packages/devtools/src/xmpp-client.d.ts:3-27` | Minimal ambient `@xmpp/client` types. |
| 34 | 25 | 146 | `apps/server/src/link-preview/parse.ts:153-177` | `apps/server/src/web-tools/html.ts:152-176` | HTML attribute/text extraction. |
| 35 | 25 | 132 | `apps/web/src/components/ChatListItem.tsx:209-233` | `apps/web/src/components/TopicRow.tsx:200-224` | Chat-list row skeleton: avatar, title, preview, badge. |
| 36 | 24 | 97 | `apps/mobile/src/lib/topics-api.ts:80-103` | `apps/web/src/lib/api/topics.ts:33-55` | Topic list API call and decode. |
| 37 | 24 | 203 | `apps/server/src/search/archive-query.ts:74-97` | `apps/server/src/search/archive-query.ts:105-128` | Archive SQL query builder branch for edit/delete. |
| 38 | 23 | 179 | `apps/mobile/src/components/chat/attachment-body.tsx:54-76` | `apps/mobile/src/components/chat/media-bubble.tsx:77-98` | Attachment bubble sizing and overlay. |
| 39 | 23 | 82 | `apps/mobile/src/components/chat/chat-list-item.tsx:30-52` | `apps/mobile/src/components/chat/group-list-item.tsx:19-46` | Unread badge and row layout. |
| 40 | 23 | 82 | `apps/mobile/src/components/chat/chat-list-item.tsx:30-52` | `apps/mobile/src/components/chat/topic-row.tsx:21-50` | Unread badge and row layout. |

### Clusters that span `apps/web` and `apps/mobile`

55 clusters, 1,119 shared lines. These are the candidates for moving logic into `packages/client-core` or `packages/chat-core`; each row is a separate clone.

| Lines | Tokens | Location A | Location B |
| ---: | ---: | --- | --- |
| 47 | 146 | `apps/mobile/src/components/ais/computer-picker.tsx:13-59` | `apps/web/src/components/ais/AiComputerSection.tsx:14-60` |
| 47 | 211 | `apps/mobile/src/lib/composer-drafts.ts:200-246` | `apps/web/src/lib/composer-drafts.ts:121-167` |
| 44 | 200 | `apps/mobile/src/components/chat/topic-not-in-row.tsx:63-106` | `apps/web/src/components/topic/TopicNotInRow.tsx:45-88` |
| 42 | 202 | `apps/mobile/src/lib/chat-list-cache.ts:18-59` | `apps/web/src/store/chatListCache.ts:9-53` |
| 38 | 186 | `apps/mobile/src/lib/use-client-version.ts:30-67` | `apps/web/src/lib/useClientVersionCheck.ts:34-71` |
| 34 | 208 | `apps/mobile/src/components/contacts/use-people-prefix-search.ts:62-95` | `apps/web/src/lib/usePeopleSearch.ts:65-98` |
| 32 | 111 | `apps/mobile/src/components/chat/blocks/block-icons.ts:28-59` | `apps/web/src/components/message/blocks/blockIcons.ts:28-59` |
| 29 | 247 | `apps/mobile/src/components/chat/entity-avatar.tsx:46-74` | `apps/web/src/components/EntityAvatar.tsx:46-74` |
| 29 | 86 | `apps/mobile/src/components/chat/new-message-sheet.tsx:11-39` | `apps/web/src/components/NewMessageDialog.tsx:10-33` |
| 29 | 86 | `apps/mobile/src/components/chat/selection-bar.tsx:15-43` | `apps/web/src/components/SelectionBar.tsx:7-34` |
| 29 | 143 | `apps/mobile/src/store/offline-cache.ts:66-94` | `apps/web/src/store/messageCache.ts:25-48` |
| 28 | 172 | `apps/mobile/src/components/chat/progress-card.tsx:16-43` | `apps/web/src/components/ProgressCard.tsx:13-40` |
| 26 | 130 | `apps/mobile/src/components/chat/blocks/buttons-block.tsx:11-36` | `apps/web/src/components/message/blocks/ButtonsBlock.tsx:22-47` |
| 26 | 78 | `apps/mobile/src/components/chat/chat-picker-list.tsx:10-35` | `apps/web/src/components/ForwardPicker.tsx:9-35` |
| 24 | 97 | `apps/mobile/src/lib/topics-api.ts:80-103` | `apps/web/src/lib/api/topics.ts:33-55` |
| 23 | 93 | `apps/mobile/src/components/chat/steps-sheet.tsx:57-79` | `apps/web/src/components/StepsPanel.tsx:30-52` |
| 23 | 86 | `apps/mobile/src/components/chat/steps-sheet.tsx:107-129` | `apps/web/src/components/StepsPanel.tsx:114-136` |
| 22 | 73 | `apps/mobile/src/auth/InviteCodeField.tsx:1-22` | `apps/web/src/components/auth/InviteCodeField.tsx:1-22` |
| 22 | 91 | `apps/mobile/src/components/chat/blocks/chart-blocks.tsx:13-34` | `apps/web/src/components/message/blocks/ChartBlocks.tsx:5-24` |
| 21 | 96 | `apps/mobile/src/components/chat/blocks/progress-blocks.tsx:13-33` | `apps/web/src/components/message/blocks/ProgressBlocks.tsx:5-25` |
| 21 | 70 | `apps/mobile/src/components/chat/blocks/weather-block.tsx:16-36` | `apps/web/src/components/message/blocks/WeatherBlock.tsx:12-28` |
| 21 | 93 | `apps/mobile/src/lib/chat-list-cache.ts:161-181` | `apps/web/src/store/chatListCache.ts:118-138` |
| 19 | 73 | `apps/mobile/src/auth/OtpInput.tsx:6-24` | `apps/web/src/components/auth/OtpInput.tsx:4-22` |
| 19 | 195 | `apps/mobile/src/components/chat/steps-sheet.tsx:233-251` | `apps/web/src/components/StepsPanel.tsx:225-243` |
| 19 | 70 | `apps/mobile/src/lib/use-client-version.ts:6-24` | `apps/web/src/lib/useClientVersionCheck.ts:6-22` |
| 18 | 78 | `apps/mobile/src/components/chat/blocks/bars-block.tsx:19-36` | `apps/web/src/components/message/blocks/BarsBlock.tsx:10-27` |
| 18 | 84 | `apps/mobile/src/components/chat/blocks/poll-block.tsx:41-58` | `apps/web/src/components/message/blocks/PollBlock.tsx:57-74` |
| 18 | 111 | `apps/mobile/src/components/chat/chat-composer-dock.tsx:170-187` | `apps/web/src/components/Composer.tsx:169-187` |
| 18 | 105 | `apps/mobile/src/components/chat/empty-chat.tsx:49-66` | `apps/web/src/components/message/EmptyChat.tsx:43-60` |
| 17 | 75 | `apps/mobile/src/components/chat/blocks/data-blocks.tsx:8-24` | `apps/web/src/components/message/blocks/DataBlocks.tsx:4-21` |
| 16 | 116 | `apps/mobile/src/global.css:13-28` | `apps/web/src/index.css:70-85` |
| 15 | 103 | `apps/mobile/src/components/chat/blocks/block-card.tsx:77-91` | `apps/web/src/components/message/blocks/BlockCard.tsx:27-41` |
| 15 | 97 | `apps/mobile/src/components/chat/chat-picker-list.tsx:35-49` | `apps/web/src/components/ForwardPicker.tsx:48-62` |
| 15 | 92 | `apps/mobile/src/components/chat/new-topic-sheet.tsx:56-70` | `apps/web/src/components/NewTopicDialog.tsx:98-112` |
| 15 | 105 | `apps/mobile/src/lib/voice.ts:182-196` | `apps/web/src/lib/voice/convert.ts:57-71` |
| 15 | 88 | `apps/mobile/src/store/offline-cache.ts:120-134` | `apps/web/src/store/messageCache.ts:77-91` |
| 14 | 87 | `apps/mobile/src/components/contacts/use-people-prefix-search.ts:76-89` | `apps/web/src/lib/usePeopleSearch.ts:153-165` |
| 14 | 129 | `apps/mobile/src/store/effects/history.ts:111-124` | `apps/web/src/store/effects/history.ts:210-227` |
| 13 | 75 | `apps/mobile/src/components/chat/ai-activity-marks.tsx:168-180` | `apps/web/src/components/topic/AiActivityMarks.tsx:86-98` |
| 13 | 81 | `apps/mobile/src/components/chat/forward-sheet.tsx:35-47` | `apps/web/src/components/ForwardPicker.tsx:62-74` |
| 13 | 77 | `apps/mobile/src/components/chat/plain-bubble-body.tsx:122-134` | `apps/web/src/components/message/MessageTextBody.tsx:18-30` |
| 13 | 105 | `apps/mobile/src/components/chat/selection-bar.tsx:59-71` | `apps/web/src/components/SelectionBar.tsx:46-56` |
| 13 | 74 | `apps/mobile/src/components/chat/topic-link-row.tsx:36-48` | `apps/web/src/components/topic/TopicLinkRow.tsx:75-87` |
| 12 | 96 | `apps/mobile/src/components/chat/album-grid.tsx:46-57` | `apps/web/src/components/message/AlbumGrid.tsx:50-56` |
| 12 | 81 | `apps/mobile/src/components/chat/group-roles-sheet.tsx:66-77` | `apps/web/src/components/panels/GroupRolesSection.tsx:30-39` |
| 12 | 86 | `apps/mobile/src/components/chat/handoff-line.tsx:26-37` | `apps/web/src/components/message/HandoffLine.tsx:23-34` |
| 12 | 82 | `apps/mobile/src/components/chat/progress-card.tsx:86-97` | `apps/web/src/components/ProgressCard.tsx:114-125` |
| 11 | 76 | `apps/mobile/src/components/chat/blocks/form-block.tsx:24-34` | `apps/web/src/components/message/blocks/FormBlock.tsx:27-37` |
| 11 | 70 | `apps/mobile/src/components/chat/chat-composer-dock.tsx:160-170` | `apps/web/src/components/Composer.tsx:159-169` |
| 11 | 105 | `apps/mobile/src/components/chat/invite-links-sheet.tsx:30-40` | `apps/web/src/components/InviteLinksSection.tsx:28-38` |
| 11 | 75 | `apps/mobile/src/components/chat/request-rows.tsx:119-129` | `apps/web/src/components/chatList/RequestRows.tsx:113-123` |
| 11 | 83 | `apps/mobile/src/lib/ais-api.ts:166-176` | `apps/web/src/lib/api/ais.ts:78-88` |
| 10 | 78 | `apps/mobile/src/lib/connections-api.ts:86-95` | `apps/web/src/lib/api/ais.ts:176-185` |
| 10 | 78 | `apps/mobile/src/store/effects/groups.ts:210-219` | `apps/web/src/store/effects/groupMembers.ts:151-160` |
| 9 | 87 | `apps/mobile/src/lib/search-api.ts:70-78` | `apps/web/src/lib/api/media.ts:169-175` |

Notes:

- The top of this list is real twin logic: chat-list cache (5, 42 lines), composer drafts (3, 47 lines), client-version check (6, 38 lines), people search (9, 34 lines), entity avatar (17, 29 lines), message cache (20, 29 lines), composer dock/Composer (18 lines), voice conversion (15 lines).
- Many block rows (`bars-block`, `poll-block`, `block-card`, `data-blocks`, `chart-blocks`, `progress-blocks`, `weather-block`, `buttons-block`) are the same block payload rendered with DOM vs React Native primitives. The shared part is payload-to-view-model, not the JSX.
- `apps/mobile/src/global.css` ↔ `apps/web/src/index.css` (16 lines) is shared Tailwind theme token text.

---

## 2. Unused code (knip 6.42.0)

Command and output are in the "Tools and commands" section. Knip analyzed workspaces automatically; no `knip.json` exists in the repo and none was added.

| Issue type | Count |
| --- | ---: |
| Unused files | 25 |
| Unused exports | 1,393 in 513 files |
| Unused types | 516 |
| Unused dependencies | 5 |
| Unused devDependencies | 8 |

### Unused files (25, full list)

`Lines` is `wc -l` of the file.

| File | Lines | Reading |
| --- | ---: | --- |
| `deploy/scripts/healthcheck.mjs` | 16 | Entry point run by deploy tooling — false positive. |
| `tools/brand-3d/main.js` | 260 | Standalone asset script — entry point, false positive. |
| `apps/mobile/plugins/with-release-signing.js` | 99 | Expo config plugin, loaded by `app.config` — false positive. |
| `apps/mobile/modules/zilar-whistle/src/index.ts` | 16 | Expo native-module entry — false positive. |
| `apps/mobile/src/mock/load.ts` | 27 | Mock gate loaded through `require`/dynamic import — false positive. |
| `apps/mobile/src/lib/native-pitfalls-scan.ts` | 88 | Dev-time scan tool ("never runs in the app"); no script references it. Candidate for deletion if retired. |
| `apps/mobile/src/lib/whistle-last-voice.ts` | 18 | Re-export shim; no importer in any `src` tree now. Dead. |
| `apps/mobile/src/lib/xmpp-node-stubs/empty.js` | 12 | Bundler resolve stub — false positive. |
| `apps/web/public/sw.js` | 123 | Service-worker entry — false positive. |
| `apps/web/src/components/ais/templates.ts` | 8 | Re-export to `@zilar/chat-core`; no importer. Dead. |
| `apps/server/src/connections/smoke-client.ts` | 31 | CLI smoke client entry — false positive. |
| `apps/server/src/effect/logger.ts` | 93 | Effect logger bridge; no importer (test-support imports `./logger`, a different file). Dead. |
| `apps/server/src/effect/runtime.ts` | 40 | `makeServerRuntime`/`ServerLayer`; no importer after the Effect edge migration. Dead. |
| `apps/server/src/sandbox/tool-prelude.ts` | 96 | Worker bundle source, concatenated at build time — false positive. |
| `apps/server/src/sandbox/tool-worker-fetch.ts` | 215 | Imported by `tool-worker.ts`; knip cannot see the worker bundle entry — false positive. |
| `apps/server/src/sandbox/tool-worker-vm.ts` | 151 | Same worker bundle as above — false positive. |
| `apps/server/src/sandbox/tool-worker.ts` | 288 | Worker entry bundled to `dist/tool-worker.mjs` — false positive. |
| `apps/server/src/voice-transcription/schemas.ts` | 11 | Re-export to `@zilar/api-contract`; no importer. Dead. |
| `apps/server/src/xmpp/routes.ts` | 4 | Re-export of token constants; no importer (comment says tests, but no test imports it). Dead. |
| `packages/devtools/src/code-map/page.js` | 225 | Browser page script — entry point, false positive. |
| `packages/devtools/src/code-map/treemap.js` | 246 | Browser page script — entry point, false positive. |
| `packages/devtools/src/effect-map/ratchet-cli.ts` | 94 | CLI entry — false positive. |
| `packages/devtools/src/effect-map/ratchet.ts` | 36 | Imported by `ratchet-cli.ts` (entry) — false positive. |
| `packages/desk/src/serve.ts` | 230 | CLI entry — false positive. |
| `packages/desk/src/egress/main.ts` | 97 | CLI entry — false positive. |

Totals: 2,524 lines listed; 174 lines have no importer at all (whistle-last-voice 18, templates 8, effect/logger 93, effect/runtime 40, voice-transcription/schemas 11, xmpp/routes 4). Another 88 lines (`native-pitfalls-scan.ts`) are a dev tool with no current script reference.

### Unused dependencies (13, full list)

| package.json | Dependency | Reading |
| --- | --- | --- |
| `apps/mobile` | `react-native-css-interop` | NativeWind runtime peer — false positive. |
| `apps/mobile` (dev) | `@babel/plugin-transform-react-jsx` | Babel/Expo config plugin — false positive. |
| `packages/mock-backend` | `@zilar/chat-core` | No import found in the package's `src`; likely removable. |
| `apps/server` | `@xmpp/client` | Only mentioned in comments/ambient types; server deliberately does not import it. Likely removable. |
| `apps/server` | `quickjs-emscripten` | Imported by `sandbox/tool-worker*.ts`, which knip cannot see (worker bundle) — false positive. |
| `apps/server` | `ws` | No direct import in `src`; probably needed by `@xmpp/component` at runtime. Verify before removing. |
| `apps/server` (dev) | `pino-pretty` | Resolved by name in `logger.ts` transport target — false positive. |
| `packages/client-core` (dev) | `@testing-library/dom` | No test in the package imports it. Likely removable. |
| `packages/client-core` (dev) | `@testing-library/react` | Same. Likely removable. |
| `packages/client-core` (dev) | `@types/react-dom` | Platform-neutral package; no React DOM usage. Likely removable. |
| `packages/client-core` (dev) | `react-dom` | Same. Likely removable. |
| `packages/chat-core` (dev) | `unicode-emoji-json` | Used by `scripts/gen-emoji.ts` to generate `emoji-table.generated.ts`; knip does not scan the script. False positive. |
| `packages/devtools` (dev) | `ink-testing-library` | Tests render through `watch-app/view.tsx`; import may be dynamic. Test-only false positive. |

### Unused exports (top 100 files by count)

1,393 exports and 516 types total; this is the full list of unused exports for the 100 files with the most of them. A name appearing here means knip found no import of it outside its own file; it may still be used inside that file, in which case only the `export` keyword is removable. Generated by the knip JSON reporter, not hand-picked.

| # | File | Count | Unused exports |
| ---: | --- | ---: | --- |
| 1 | `apps/server/src/agents/tools.ts` | 39 | `ACTION_NAME_MAX_LENGTH`, `BASH_TOOL`, `DESK_TOOL_NAMES`, `EDIT_TOOL`, `GIT_TOOL`, `GLOB_TOOL`, `GREP_TOOL`, `PERSONA_MAX_LENGTH`, `READ_TOOL`, `REMEMBERED_FACT_MAX_LENGTH`, `WRITE_TOOL`, `AskPeopleArgsSchema`, `BashArgsSchema`, `DelegateArgsSchema`, `EditArgsSchema`, `FetchMediaArgsSchema`, `GitArgsSchema`, `GlobArgsSchema`, `GrepArgsSchema`, `MemoryZoomArgsSchema`, `PostBlocksArgsSchema`, `ReadArgsSchema`, `RecallArgsSchema`, `RememberArgsSchema`, `RequestActionArgsSchema`, `RevertPersonaArgsSchema`, `SaveTextMediaArgsSchema`, `TaskStatusArgsSchema`, `UpdatePersonaArgsSchema`, `WriteArgsSchema`, `TOOL_NAME_MAX_LENGTH`, `POST_BLOCKS_TOOL_DEF`, `FETCH_MEDIA_TOOL_DEF`, `SAVE_TEXT_MEDIA_TOOL_DEF`, `ASK_PEOPLE_TOOL_DEF`, `MEMORY_TOOLS`, `TASK_STATUS_TOOL_DEF`, `buildDelegateTool`, `sanitizeSummary` |
| 2 | `apps/server/src/stickers/service.ts` | 19 | `STICKER_PACKS_MAX_PER_USER`, `STICKER_PACK_TITLE_MAX`, `STICKER_PACK_TITLE_MIN`, `STICKER_EMOJI_MAX`, `DISCOVER_PAGE_SIZE`, `stickerVisibilitySchema`, `createPackBodySchema`, `patchPackBodySchema`, `serverPackageRoot`, `SERVER_PACKAGE_ROOT`, `toStickerView`, `toPackView`, `escapeLike`, `reorderPanelBodySchema`, `STICKER_FAVORITES_MAX`, `favoriteBodySchema`, `TELEGRAM_IMPORT_CONSIDER_MAX`, `TELEGRAM_IMPORT_STICKERS_MAX`, `TELEGRAM_IMPORT_CONCURRENCY` |
| 3 | `apps/mobile/src/lib/depth.ts` | 16 | `ACCENT`, `EDGE`, `KEY_PRIMARY_GRADIENT`, `KEY_PRIMARY_SHADOW`, `KEY_ICON_GRADIENT`, `KEY_ICON_SHADOW`, `WELL_SHADOW`, `SEGMENT_GRADIENT`, `SEGMENT_SHADOW`, `PILL_GRADIENT`, `PILL_SHADOW`, `BUBBLE_OUT_GRADIENT`, `BUBBLE_OUT_SHADOW`, `BUBBLE_IN_GRADIENT`, `BUBBLE_IN_SHADOW`, `BUBBLE_GEN_SHADOW` |
| 4 | `apps/server/src/invite-links/service.ts` | 16 | `INVITE_LINK_CREATE_MAX_EXPIRY_HOURS`, `INVITE_LINK_CREATE_MAX_USES`, `INVITE_LINK_LABEL_MAX`, `INVITE_LINK_MIN_EXPIRY_HOURS`, `INVITE_LINK_MIN_MAX_USES`, `INVITE_LINK_TOKEN_BYTES`, `MAX_ACTIVE_INVITE_LINKS`, `INVALID_LINK`, `generateInviteToken`, `hashInviteToken`, `inviteTokenMatches`, `joinUrlFor`, `toInviteLinkView`, `tokenHintFor`, `linkIsUsable`, `assertGroupHasRoom` |
| 5 | `apps/server/src/agents/gateway.ts` | 13 | `AI_DRAIN_MS`, `AI_RESTART_REPLY`, `GATEWAY_RESOURCE`, `GROUP_JOIN_SKEW_MS`, `GROUP_RATE_WINDOW_MS`, `GROUP_TURNS_PER_WINDOW`, `LISTENER_EVERY_N_DEFAULT`, `LISTENER_QUIET_MS_DEFAULT`, `RECONCILE_INTERVAL_MS`, `RETRY_BASE_DELAY_MS`, `RETRY_MAX_DELAY_MS`, `ROUND_MAX_AI_TURNS`, `ROUND_MAX_HOPS` |
| 6 | `apps/server/src/web-tools/adapters.ts` | 13 | `DEFAULT_FETCH_CHARS`, `DEFAULT_FEED_LIMIT`, `MAX_FETCH_CHARS`, `MAX_FETCH_URL_CHARS`, `MAX_FEED_LIMIT`, `MAX_SEARCH_QUERY_CHARS`, `MAX_WIKIPEDIA_EXTRACT_CHARS`, `WEB_ACTIONS_PER_HOUR`, `WEB_ACTION_WINDOW_MS`, `formatFeedItems`, `parseWikipediaExtract`, `parseWikipediaSearch`, `wikipediaHost` |
| 7 | `apps/mobile/src/store/effects/polling.ts` | 12 | `DRAFT_END_FALLBACK_MS`, `DRAFT_IDLE_MS`, `FINISHED_TURNS_MAX`, `PINS_REFRESH_INTERVAL_MS`, `TOPIC_REFRESH_INTERVAL_MS`, `clearDraftTimeout`, `clearFinishedTurns`, `markTurnFinished`, `startChatsPolling`, `startDraftStream`, `startPinsPolling`, `withoutDraft` |
| 8 | `apps/web/src/lib/voice.ts` | 12 | `VOICE_FILENAME`, `VOICE_MIME`, `WAVEFORM_BUCKETS`, `isVoiceRecordingSupported`, `pickRecorderMime`, `voiceErrorFromGetUserMedia`, `convertVoice`, `convertVoiceEffect`, `uploadVoice`, `uploadVoiceEffect`, `computeWaveformEffect`, `sampleVoiceDataUrl` |
| 9 | `apps/server/src/link-preview/fetch.ts` | 11 | `LINK_PREVIEW_TIMEOUT_MS`, `LINK_PREVIEW_MAX_BYTES`, `LINK_PREVIEW_HIT_TTL_MS`, `LINK_PREVIEW_MISS_TTL_MS`, `LINK_PREVIEW_MAX_ENTRIES`, `LINK_PREVIEW_IMAGE_TIMEOUT_MS`, `LINK_PREVIEW_IMAGE_MAX_BYTES`, `LINK_PREVIEW_IMAGE_MAX_ENTRIES`, `LINK_PREVIEW_IMAGE_MAX_TOTAL_BYTES`, `LINK_PREVIEW_IMAGE_CONTENT_TYPES`, `normalizePreviewUrl` |
| 10 | `packages/runner-tunnel/src/protocol.ts` | 11 | `FRAME_RESET`, `HelloSchema`, `ChallengeSchema`, `AuthSchema`, `ReadySchema`, `HeartbeatSchema`, `TunnelOpenSchema`, `TunnelRefusedSchema`, `TunnelClosedSchema`, `TunnelPauseSchema`, `TunnelResumeSchema` |
| 11 | `apps/mobile/src/components/ais/ai-activity.tsx` | 9 | `ACTIVITY_LOAD_FAILED_MESSAGE`, `ACTIVITY_MORE_FAILED_MESSAGE`, `ACTIVITY_EMPTY_MESSAGE`, `loadActivityEffect`, `loadActivity`, `appendActivityEffect`, `appendActivity`, `AiActivityContent`, `AiActivityHeader` |
| 12 | `apps/mobile/src/lib/voice-transcribe-flow.ts` | 9 | `TRANSCRIBE_UNAVAILABLE_MESSAGE`, `TRANSCRIBE_DOWNLOAD_FAILED_MESSAGE`, `TRANSCRIBE_TOO_LONG_MESSAGE`, `TRANSCRIBE_EMPTY_MESSAGE`, `TRANSCRIBE_FAILED_MESSAGE`, `TranscribeTooLargeError`, `transcribeDownloadOverCap`, `transcribeCacheName`, `transcribeVoiceNoteEffect` |
| 13 | `apps/server/src/voice-transcription/pipeline.ts` | 9 | `VOICE_TRANSCRIPT_MAX_BYTES`, `VOICE_FETCH_TIMEOUT_MS`, `AudioUnavailable`, `VoiceTooLarge`, `NotAudio`, `TranscriptionFailed`, `transcriptErrorToHttp`, `fetchAndTranscribeAsEffect`, `AudioUnavailableError` |
| 14 | `apps/web/src/lib/handles.ts` | 9 | `ApiError`, `HANDLE_MAX_LENGTH`, `HANDLE_MIN_LENGTH`, `RESERVED_HANDLES`, `classifyHandle`, `isReservedHandle`, `isValidHandleShape`, `normalizeHandle`, `isRateLimited` |
| 15 | `apps/web/src/store/effects/constants.ts` | 9 | `TYPING_CLEAR_MS`, `PREVIEW_HISTORY_MAX`, `PAGE_HISTORY_MAX`, `SEND_TIMEOUT_MS`, `DRAFT_END_FALLBACK_MS`, `DRAFT_IDLE_MS`, `PINS_REFRESH_INTERVAL_MS`, `TOPIC_REFRESH_INTERVAL_MS`, `FINISHED_TURNS_MAX` |
| 16 | `packages/devtools/src/lead/watch-app.tsx` | 9 | `WatchApp`, `Footer`, `Header`, `TaskCard`, `badgeSegs`, `FilesLine`, `ModelBadge`, `speedSegs`, `StepTracker` |
| 17 | `packages/devtools/src/lead/watch.ts` | 9 | `fullClearOnResize`, `parseChangedFiles`, `liveStep`, `modelLabel`, `sessionSpeed`, `boardModelFor`, `boardTaskEntry`, `buildView`, `collectFiles` |
| 18 | `apps/mobile/modules/zilar-whistle/src/chunks.ts` | 8 | `WHISTLE_SAMPLE_RATE`, `WHISTLE_MAX_CHUNK_SAMPLES`, `WHISTLE_CUT_SEARCH_SAMPLES`, `downmixToMono`, `resampleMonoTo16k`, `planWhistleChunks`, `quietestCut`, `isSilentPcm` |
| 19 | `apps/mobile/src/components/ais/tool-actions.ts` | 8 | `MAX_RUN_INPUT_BYTES`, `RUN_INPUT_INVALID_MESSAGE`, `RUN_INPUT_TOO_BIG_MESSAGE`, `RUN_FORBIDDEN_MESSAGE`, `RUN_RATE_LIMITED_MESSAGE`, `RUN_UNAVAILABLE_MESSAGE`, `RUN_FAILED_MESSAGE`, `CHANGE_FORBIDDEN_MESSAGE` |
| 20 | `apps/mobile/src/components/chat/sticker-panel.tsx` | 8 | `STICKER_GRID_COLUMNS`, `STICKER_GRID_GAP`, `STICKER_GRID_PADDING`, `stickerCellSize`, `stickerThumbSize`, `DEFAULT_SHEET_WIDTH`, `isPanelStickerUrl`, `StickerPanel` |
| 21 | `apps/mobile/src/store/real-store.ts` | 8 | `MESSAGE_JUMP_MAX_PAGES`, `MESSAGE_JUMP_WAIT_MS`, `DRAFT_END_FALLBACK_MS`, `DRAFT_IDLE_MS`, `PINS_REFRESH_INTERVAL_MS`, `TOPIC_REFRESH_INTERVAL_MS`, `isUpdateStanza`, `summariesFor` |
| 22 | `apps/server/src/agents/delegation/service.ts` | 8 | `OBJECTIVE_MAX`, `CONTEXT_SUMMARY_MAX`, `DELEGATION_LIST_MAX`, `DELEGATION_ITEM_MAX`, `RETURN_FORMAT_MAX`, `RESULT_SUMMARY_MAX`, `checkDelegation`, `cancelDelegation` |
| 23 | `apps/server/src/contact-requests/api.ts` | 8 | `CONTACT_REQUEST_CREATE_RATE_LIMIT_MAX`, `CONTACT_REQUEST_CREATE_RATE_LIMIT_WINDOW_MS`, `CONTACT_REQUEST_READ_RATE_LIMIT_MAX`, `CONTACT_REQUEST_READ_RATE_LIMIT_WINDOW_MS`, `BY_HANDLE_RATE_LIMIT_MAX`, `BY_HANDLE_RATE_LIMIT_WINDOW_MS`, `USER_SEARCH_RATE_LIMIT_MAX`, `USER_SEARCH_RATE_LIMIT_WINDOW_MS` |
| 24 | `apps/server/src/media/api.ts` | 8 | `MEDIA_RATE_LIMIT_MAX`, `MEDIA_RATE_LIMIT_WINDOW_MS`, `MEDIA_DEFAULT_LIMIT`, `MEDIA_MAX_LIMIT`, `LINK_PREVIEW_RATE_LIMIT_MAX`, `LINK_PREVIEW_RATE_LIMIT_WINDOW_MS`, `LINK_PREVIEW_MAX_URL_CHARS`, `MEDIA_TYPES` |
| 25 | `apps/server/src/push/api.ts` | 8 | `PUSH_SUBSCRIBE_RATE_LIMIT_MAX`, `PUSH_SUBSCRIBE_RATE_LIMIT_WINDOW_MS`, `PUSH_SETTINGS_RATE_LIMIT_MAX`, `PUSH_SETTINGS_RATE_LIMIT_WINDOW_MS`, `PUSH_TEST_RATE_LIMIT_MAX`, `PUSH_TEST_RATE_LIMIT_WINDOW_MS`, `PUSH_PREVIEW_RATE_LIMIT_MAX`, `PUSH_PREVIEW_RATE_LIMIT_WINDOW_MS` |
| 26 | `apps/server/src/search/routes.ts` | 8 | `SEARCH_MAX_LIMIT`, `SEARCH_DEFAULT_LIMIT`, `SEARCH_WINDOW_MS`, `SEARCH_MIN_FUZZY_QUERY_CHARS`, `headlineToSnippet`, `buildArchiveQuery`, `buildArchiveEditsQuery`, `buildFuzzyCandidatesQuery` |
| 27 | `apps/web/src/lib/sticker-images.ts` | 8 | `fitStickerSize`, `STICKER_PREP_MAX_DIM`, `STICKER_PREP_MAX_BYTES`, `STICKER_PREP_UPLOAD_MAX_BYTES`, `STICKER_PREP_QUALITY_STEPS`, `STICKER_PREP_ACCEPTED_TYPES`, `formatStickerSize`, `formatStickerBytes` |
| 28 | `packages/devtools/src/lead/batch.ts` | 8 | `parseLintErrors`, `parsePrettierFiles`, `parseTypecheckErrors`, `parseVitestFailures`, `testArgsOf`, `BatchError`, `ownerOf`, `waveWorktree` |
| 29 | `packages/runner-tunnel/src/desk-frames.ts` | 8 | `MAX_MEMORY_BYTES`, `MAX_PIDS`, `MAX_DISK_BYTES`, `MAX_CPU_SHARES`, `MAX_COMMAND_TIMEOUT_MS`, `MAX_TASK_WALL_CLOCK_MS`, `DeskLimitsFrameSchema`, `DeskEgressFrameSchema` |
| 30 | `apps/mobile/src/components/stickers/sticker-native.ts` | 7 | `fitStickerSize`, `STICKER_PREP_MAX_DIM`, `STICKER_PREP_MAX_BYTES`, `STICKER_MOVE_MAX_BYTES`, `STICKER_PREP_QUALITY_STEPS`, `createStickerSizeReader`, `createStickerByteReader` |
| 31 | `apps/mobile/src/components/stickers/telegram-import.ts` | 7 | `INVALID_LINK_ERROR`, `PACK_NOT_FOUND_ERROR`, `CUSTOM_EMOJI_ERROR`, `TRY_LATER_ERROR`, `RATE_LIMITED_ERROR`, `PACK_LIMIT_ERROR`, `GENERIC_IMPORT_ERROR` |
| 32 | `apps/mobile/src/lib/attachment-downscale.ts` | 7 | `DOWNSCALE_MAX_SIDE`, `DOWNSCALE_MAX_BYTES`, `DOWNSCALE_QUALITY`, `longestSide`, `shouldDownscale`, `jpegName`, `createDownscaleSizeReader` |
| 33 | `apps/mobile/src/lib/roles.ts` | 7 | `ROLE_WRITE_DENIED_MESSAGE`, `ROLE_GONE_MESSAGE`, `ROLE_SAVE_FAILED_MESSAGE`, `ROLE_LOAD_FAILED_MESSAGE`, `topicRoleLabel`, `sortGroupRoles`, `rolesByUserId` |
| 34 | `apps/server/src/auth/export.ts` | 7 | `EXPORT_RATE_LIMIT_MAX`, `EXPORT_RATE_LIMIT_WINDOW_MS`, `EXPORT_MAX_MESSAGES`, `EXPORT_MAX_BYTES`, `EXPORT_PAGE_SIZE`, `createExportArchivePool`, `runExport` |
| 35 | `apps/server/src/invite-links/tokens.ts` | 7 | `INVITE_LINK_TOKEN_BYTES`, `INVITE_LINK_CREATE_MAX_EXPIRY_HOURS`, `INVITE_LINK_CREATE_MAX_USES`, `INVITE_LINK_LABEL_MAX`, `INVITE_LINK_MIN_EXPIRY_HOURS`, `INVITE_LINK_MIN_MAX_USES`, `INVALID_LINK` |
| 36 | `apps/server/src/machines/api.ts` | 7 | `PAIRING_CODE_RATE_LIMIT_MAX`, `PAIRING_CODE_RATE_LIMIT_WINDOW_MS`, `PAIR_GLOBAL_RATE_LIMIT_MAX`, `PAIR_IP_RATE_LIMIT_MAX`, `PAIR_RATE_LIMIT_WINDOW_MS`, `MACHINE_WRITE_RATE_LIMIT_MAX`, `MACHINE_WRITE_RATE_LIMIT_WINDOW_MS` |
| 37 | `apps/server/src/tools/adapters.ts` | 7 | `MAX_SAVE_MODEL_TEXT_CHARS`, `MAX_TOOL_POST_CHARS`, `TOOL_RUNS_PER_HOUR`, `TOOL_RUN_WINDOW_MS`, `describeSchedule`, `formatNextRun`, `MAX_TOOL_INPUT_BYTES` |
| 38 | `apps/web/src/store/realStore.ts` | 7 | `TOPIC_REFRESH_INTERVAL_MS`, `mergeWithPainted`, `summariesFor`, `SEND_TIMEOUT_MS`, `sendFailureReasonFor`, `DRAFT_END_FALLBACK_MS`, `DRAFT_IDLE_MS` |
| 39 | `apps/web/src/store/store.ts` | 7 | `matchesFolder`, `folderUnread`, `MUTE_DURATIONS`, `applyChatPrefs`, `effectivePrefFor`, `mutedUntilFor`, `sortPinnedFirst` |
| 40 | `packages/xmpp-core/src/stanza.ts` | 7 | `occupantIdOf`, `resolveSender`, `parseForward`, `albumElement`, `parseAlbum`, `ALBUM_ID_MAX`, `ALBUM_MAX` |
| 41 | `apps/mobile/src/components/ais/tools-section.tsx` | 6 | `TOOLS_LOAD_FAILED_MESSAGE`, `TOOLS_EMPTY_MESSAGE`, `loadAiToolsEffect`, `loadAiTools`, `closeDetailSheet`, `withoutTool` |
| 42 | `apps/mobile/src/components/chat/media-sheet.tsx` | 6 | `formatDuration`, `MEDIA_EMPTY_TEXT`, `MEDIA_LOADING_TEXT`, `formatMediaSize`, `MediaSheetContent`, `MEDIA_LOAD_ERROR_TEXT` |
| 43 | `apps/mobile/src/components/settings/avatar-native.ts` | 6 | `centeredSquareCrop`, `createAvatarTranscoder`, `createAvatarSizeReader`, `parseAvatarUploadBody`, `toAvatarUploadError`, `stagedAvatarName` |
| 44 | `apps/mobile/src/lib/pins-api.ts` | 6 | `PinsApiError`, `parsePinKind`, `parsePin`, `pinKindFor`, `pinLabel`, `pinSnapshotText` |
| 45 | `apps/mobile/src/lib/voice-transcripts.ts` | 6 | `StoredTranscriptSchema`, `TRANSCRIPTS_FILENAME`, `MAX_STORED_TRANSCRIPTS`, `MAX_TRANSCRIPT_CHARS`, `parseTranscripts`, `deleteTranscript` |
| 46 | `apps/server/src/agents/listener/score.ts` | 6 | `LISTENER_THRESHOLDS`, `thresholdFor`, `LISTENER_MESSAGE_TEXT_MAX`, `LISTENER_SYSTEM_MESSAGE`, `buildListenerMessages`, `parseListenerOutput` |
| 47 | `apps/server/src/agents/reply.ts` | 6 | `MODEL_CHAT_TIMEOUT_MS`, `REPLY_MAX_TOKENS`, `TOOL_CAPPED_RESULT`, `TOOL_REPEAT_RESULT`, `TOOL_RESULT_MAX_CHARS`, `TOOL_TURN_WALL_CLOCK_MS` |
| 48 | `apps/server/src/agents/tools/definitions.ts` | 6 | `TASK_TITLE_PARAM`, `TASK_TITLE_MAX_LENGTH`, `MEMORY_TOOLS`, `buildDelegateTool`, `ASK_PEOPLE_TOOL_DEF`, `TASK_STATUS_TOOL_DEF` |
| 49 | `apps/server/src/chat-folders/service.ts` | 6 | `FOLDER_CHATS_MAX`, `FOLDER_CHAT_TYPES`, `FOLDER_ICONS`, `FOLDER_NAME_MAX`, `FOLDERS_MAX`, `toChatFolderView` |
| 50 | `apps/server/src/chats/deliveries.ts` | 6 | `DELIVERED_IDS_MAX`, `DELIVERED_ID_MAX_LENGTH`, `archiveTimestampsForOrigins`, `putChatDelivery`, `maxArchiveId`, `deliveryScopeForChat` |
| 51 | `apps/server/src/groups/api.ts` | 6 | `ROLE_CHANGE_RATE_LIMIT_MAX`, `ROLE_CHANGE_RATE_LIMIT_WINDOW_MS`, `PUBLIC_JOIN_RATE_LIMIT_MAX`, `PUBLIC_JOIN_RATE_LIMIT_WINDOW_MS`, `GROUP_CREATE_RATE_LIMIT_MAX`, `GROUP_CREATE_RATE_LIMIT_WINDOW_MS` |
| 52 | `apps/server/src/handles/rules.ts` | 6 | `HANDLE_MAX_LENGTH`, `HANDLE_MIN_LENGTH`, `RESERVED_HANDLES`, `isReservedHandle`, `isValidHandleShape`, `suggestHandle` |
| 53 | `apps/server/src/stickers/schemas.ts` | 6 | `STICKER_PACK_TITLE_MAX`, `STICKER_PACK_TITLE_MIN`, `STICKER_EMOJI_MAX`, `stickerVisibilitySchema`, `createPackBodySchema`, `patchPackBodySchema` |
| 54 | `apps/server/src/topics/api.ts` | 6 | `TOPIC_CREATE_RATE_LIMIT_MAX`, `TOPIC_CREATE_RATE_LIMIT_WINDOW_MS`, `TOPIC_JOIN_RATE_LIMIT_MAX`, `TOPIC_JOIN_RATE_LIMIT_WINDOW_MS`, `TOPIC_PREVIEW_RATE_LIMIT_MAX`, `TOPIC_PREVIEW_RATE_LIMIT_WINDOW_MS` |
| 55 | `apps/web/src/lib/api.ts` | 6 | `chatEntryTopics`, `getInvite`, `topicSchema`, `approvalRuleSchema`, `publicApprovalSchema`, `machineSchema` |
| 56 | `apps/web/src/store/effects/chatRows.ts` | 6 | `advanceStatus`, `clearFailure`, `coreKind`, `moveChatToTop`, `rememberFinishedDraftMessage`, `sortMessages` |
| 57 | `packages/devtools/src/effect-map/generate.ts` | 6 | `blankNonCode`, `isExemptPath`, `markerReason`, `classifySource`, `signalHits`, `sourceFile` |
| 58 | `packages/devtools/src/lead/fallback.ts` | 6 | `DEEPSEEK_FLASH`, `FREE_DEEPSEEK_FLASH`, `FREE_GLM_FLASH`, `GO_DEEPSEEK_FLASH`, `GO_MUSE`, `PAID_MUSE` |
| 59 | `scripts/shots.ts` | 6 | `DESKTOP`, `PHONE`, `SHOT_SETUPS`, `DESKTOP_SHOTS`, `PHONE_SHOTS`, `parseShots` |
| 60 | `apps/mobile/src/components/ais/use-routine-actions.ts` | 5 | `ROUTINE_NEEDS_APPROVAL_MESSAGE`, `ROUTINE_FORBIDDEN_MESSAGE`, `ROUTINE_UPDATE_FAILED_MESSAGE`, `applyRoutineActionEffect`, `applyRoutineAction` |
| 61 | `apps/mobile/src/components/chat/invite-links-sheet.tsx` | 5 | `inviteLinkState`, `describeInviteLink`, `validateInviteLinkForm`, `InviteLinkRow`, `CreatedInviteLinkView` |
| 62 | `apps/mobile/src/components/chat/voice-recorder.tsx` | 5 | `runRecorderBegin`, `runRecorderBeginEffect`, `runRecorderFinish`, `runRecorderFinishEffect`, `waveformFromLevels` |
| 63 | `apps/mobile/src/lib/topics.ts` | 5 | `isTopicChat`, `isLegacyGroupChat`, `sortTopics`, `topicInFolder`, `mayManageTopic` |
| 64 | `apps/server/src/agents/context.ts` | 5 | `DM_HISTORY_CHAR_BUDGET`, `buildSystemMessage`, `buildGroupSystemMessage`, `buildMemoryMessage`, `capHistoryByChars` |
| 65 | `apps/server/src/backgrounds/service.ts` | 5 | `BACKGROUND_MAX_SIDE`, `BACKGROUND_MIN_SIDE`, `BACKGROUND_MAX_PER_USER`, `backgroundUrlFor`, `checkBackgroundBytes` |
| 66 | `apps/server/src/card-media/fetch.ts` | 5 | `CARD_MEDIA_URL_MAX_LENGTH`, `CARD_MEDIA_IMAGE_MAX_BYTES`, `CARD_MEDIA_FILE_MAX_BYTES`, `CARD_MEDIA_IMAGE_MAX_SIDE`, `CARD_MEDIA_IMAGE_MAX_PIXELS` |
| 67 | `apps/server/src/chats/delete-own.ts` | 5 | `CHAT_HISTORY_WRITE_RATE_LIMIT_MAX`, `CHAT_HISTORY_WRITE_RATE_LIMIT_WINDOW_MS`, `requireDmAccess`, `clearOwnHistory`, `deleteOwnArchiveRow` |
| 68 | `apps/server/src/contact-requests/service.ts` | 5 | `MAX_LIST_ROWS`, `isPendingPairViolation`, `RE_REQUEST_COOLDOWN_DAYS`, `resolveHandleUser`, `relationFor` |
| 69 | `apps/server/src/effect/edge.ts` | 5 | `allowedOrigins`, `durationSince`, `logPath`, `resolveRequestId`, `UNSAFE_METHODS` |
| 70 | `apps/server/src/media/indexer.ts` | 5 | `extractLinks`, `MEDIA_INDEX_MAX_ROWS`, `MEDIA_ITEMS_CAP_PER_CHAT`, `buildIndexQuery`, `buildTargetAuthorQuery` |
| 71 | `apps/server/src/pins/service.ts` | 5 | `PINS_MAX_PER_CHAT`, `PIN_MESSAGE_ID_MAX`, `PIN_SENDER_NAME_MAX`, `PIN_TEXT_MAX`, `toPinView` |
| 72 | `apps/server/src/stickers/image.ts` | 5 | `STICKER_MAX_DIMENSION`, `STICKER_MAX_DECODED_BYTES`, `isAnimatedImage`, `isAnimatedWebp`, `isAnimatedPng` |
| 73 | `apps/server/src/tools/schemas.ts` | 5 | `MAX_TOOL_SOURCE_BYTES`, `MAX_TOOL_HOSTS`, `toolDescriptionSchema`, `toolMessageSchema`, `toolSourceSchema` |
| 74 | `apps/server/src/topics/access.ts` | 5 | `TOPIC_NOT_FOUND`, `topicKindSchema`, `topicStatusSchema`, `topicVisibilitySchema`, `resolveOwnerName` |
| 75 | `apps/server/src/xmpp/admin-client.ts` | 5 | `RoomAffiliationEntrySchema`, `RoomAffiliationSchema`, `RosterEntrySchema`, `RosterSubscriptionSchema`, `EjabberdApiError` |
| 76 | `apps/web/src/lib/attachments.ts` | 5 | `AttachmentError`, `readImageSize`, `readImageSizeEffect`, `uploadAttachment`, `uploadAttachmentEffect` |
| 77 | `apps/web/src/store/effects/lifecycle.ts` | 5 | `CONNECT_RETRY_DELAYS_MS`, `readLastRead`, `saveMessages`, `scheduleChatsRefresh`, `saveChatList` |
| 78 | `apps/web/src/store/effects/polling.ts` | 5 | `clearFinishedTurns`, `startChatsPolling`, `startDraftStream`, `startPinsPolling`, `withoutDraft` |
| 79 | `packages/devtools/src/code-map/collect.ts` | 5 | `LINE_LIMIT`, `isScoped`, `classify`, `bandOf`, `countLines` |
| 80 | `packages/devtools/src/lead/model-schedule.ts` | 5 | `DEEPSEEK_FLASH`, `FREE_DEEPSEEK_FLASH`, `FREE_MUSE`, `GO_DEEPSEEK_FLASH`, `PAID_MUSE` |
| 81 | `apps/mobile/scripts/boot-check-launch.mjs` | 4 | `tryConnect`, `queryAppLog`, `createLineReader`, `isBundledIn` |
| 82 | `apps/mobile/src/components/ais/tool-detail-sheet.tsx` | 4 | `ToolDetailBody`, `SHEET_SCROLL_TAPS_PERSIST`, `TOOL_DETAIL_LOAD_FAILED_MESSAGE`, `TOOL_VERSION_LOAD_FAILED_MESSAGE` |
| 83 | `apps/mobile/src/components/chat/message-search.ts` | 4 | `MESSAGE_SEARCH_DEBOUNCE_MS`, `MESSAGE_SEARCH_LIMIT`, `MESSAGE_SEARCH_MIN_LENGTH`, `activeQuery` |
| 84 | `apps/mobile/src/components/contacts/blocks.ts` | 4 | `blockFailure`, `unblockFailure`, `performBlockEffect`, `performUnblockEffect` |
| 85 | `apps/mobile/src/lib/composer-drafts.ts` | 4 | `scopeToUser`, `loadScopedDrafts`, `getDraft`, `subscribe` |
| 86 | `apps/mobile/src/lib/stickers.ts` | 4 | `MAX_RECENT_STICKERS`, `apiOrigin`, `STICKER_PACK_HOST`, `FALLBACK_STICKER_SIZE` |
| 87 | `apps/mobile/src/lib/topics-api.ts` | 4 | `TopicsApiError`, `parseTopicVisibility`, `chatEntryTopics`, `glyphForTopicName` |
| 88 | `apps/mobile/src/lib/use-smooth-text.ts` | 4 | `SMOOTH_CATCH_UP_MS`, `SMOOTH_MIN_CHARS_PER_SECOND`, `safeCut`, `SmoothTextReveal` |
| 89 | `apps/mobile/src/lib/voice-native.ts` | 4 | `MIC_DENIED_MESSAGE`, `RECORD_FAILED_MESSAGE`, `buildRecordingOptions`, `voiceFailureReasonFor` |
| 90 | `apps/mobile/src/test/wait.ts` | 4 | `flushMicrotasks`, `settle`, `waitForAct`, `jsonResponseAt` |
| 91 | `apps/server/src/actions/gateway.ts` | 4 | `APPROVAL_TTL_MS`, `MAX_STORED_ARGS_BYTES`, `STUCK_RUNNING_MS`, `RESULT_SUMMARY_MAX` |
| 92 | `apps/server/src/actions/registry.ts` | 4 | `ACTION_MODEL_TEXT_MAX_CHARS`, `ADAPTER_DESCRIPTION_MAX_LENGTH`, `ADAPTER_ARGS_EXAMPLE_MAX_LENGTH`, `AdapterRegistryError` |
| 93 | `apps/server/src/agents/memory/store.ts` | 4 | `MEMORY_FACTS_MAX`, `MEMORY_RECALL_MAX`, `MEMORY_WINDOW`, `memoryRange` |
| 94 | `apps/server/src/blocks/api.ts` | 4 | `BLOCK_WRITE_RATE_LIMIT_MAX`, `BLOCK_WRITE_RATE_LIMIT_WINDOW_MS`, `BLOCK_READ_RATE_LIMIT_MAX`, `BLOCK_READ_RATE_LIMIT_WINDOW_MS` |
| 95 | `apps/server/src/chat-prefs/service.ts` | 4 | `CHAT_PREFS_MAX_ROWS`, `CHAT_PREFS_MAX_PINNED`, `CHAT_BACKGROUND_PRESET_IDS`, `toChatPrefView` |
| 96 | `apps/server/src/connections/api.ts` | 4 | `CONNECTION_TEST_RATE_LIMIT_MAX`, `CONNECTION_TEST_RATE_LIMIT_WINDOW_MS`, `CONNECTION_WRITE_RATE_LIMIT_MAX`, `CONNECTION_WRITE_RATE_LIMIT_WINDOW_MS` |
| 97 | `apps/server/src/handles/api.ts` | 4 | `HANDLE_CHECK_RATE_LIMIT_MAX`, `HANDLE_CHECK_RATE_LIMIT_WINDOW_MS`, `HANDLE_CLAIM_RATE_LIMIT_MAX`, `HANDLE_CLAIM_RATE_LIMIT_WINDOW_MS` |
| 98 | `apps/server/src/machines/codes.ts` | 4 | `PAIRING_CODE_ALPHABET`, `PAIRING_CODE_LENGTH`, `PAIRING_CODE_GROUP_SIZE`, `formatPairingCode` |
| 99 | `apps/server/src/machines/service.ts` | 4 | `fingerprintOfPublicKey`, `countActivePairingCodes`, `countMachines`, `countPendingMachines` |
| 100 | `apps/server/src/roles/service.ts` | 4 | `GROUP_NOT_FOUND`, `MAX_ROLES_PER_GROUP`, `ROLE_NOT_FOUND`, `toRoleDetail` |

Knip could not load `apps/mobile/metro.config.js` (it requires `tailwind.config`, which does not resolve in knip's process) and exited 2 even with `--no-exit-code`; it still produced the full JSON report. Mobile results may therefore miss imports created by Metro/NativeWind resolution. This is the only tool failure; runtime was seconds, not minutes.

---

## 3. Web and phone twins

Method: walk `apps/web/src` and `apps/mobile/src`, take each file's basename, lowercase it and remove `-`/`_`, then pair on that key. This is the rule in the task (`MessageBubble.tsx` ↔ `message-bubble.tsx`). Line counts are `wc -l`; shared lines are jscpd clones whose two files are exactly the pair.

- 224 pairs, 219 of them non-test (5 `realStore.*` test pairs are excluded from the appendix table).
- 25 pairs share exact clones, 600 lines in total.
- Name-only collisions: six mobile `errors.ts` modules (`auth`, `components/ais`, `components/connections`, `components/integrations`, `components/machines`, `lib/effect`) pair with each of the four web `errors.ts` modules (`components/ais`, `components/machines`, `lib/effect`, `lib`) because they share a basename. They are not semantic twins; only the per-module pairs are meaningful. `apps/web/src/components/ui/badge.tsx` ↔ `apps/mobile/src/lib/push/badge.ts` is also name-only.

The full 219-pair table is Appendix A. The pairs that carry non-UI logic are below.

### Non-UI logic pairs

"Holds" says what the module does, from its header and imports. "Move candidate" follows the task's question: could it live in a shared package? Line counts and shared lines match Appendix A.

| Web module | Mobile module | Lines (web/mobile) | Shared | Holds | Move candidate |
| --- | --- | ---: | ---: | --- | --- |
| `apps/web/src/lib/composer-drafts.ts` | `apps/mobile/src/lib/composer-drafts.ts` | 175 / 261 | 47 | Draft persistence per chat | `packages/client-core` |
| `apps/web/src/store/chatListCache.ts` | `apps/mobile/src/lib/chat-list-cache.ts` | 152 / 192 | 63 | Persisted chat-list cache + version | `packages/client-core` |
| `apps/web/src/lib/usePeopleSearch.ts` | `apps/mobile/src/components/contacts/use-people-search.ts` | 180 / 72 | 0 | Prefix search over names/handles | `packages/client-core` |
| `apps/web/src/lib/useMessageSearch.ts` | `apps/mobile/src/components/chat/use-message-search.ts` | 98 / 42 | 0 | Debounced message search scheduler | `packages/client-core` |
| `apps/web/src/lib/useContactRequests.ts` | `apps/mobile/src/lib/use-contact-requests.ts` | 63 / 60 | 0 | Contact-request list/actions | `packages/client-core` |
| `apps/web/src/lib/useDelayed.ts` | `apps/mobile/src/lib/use-delayed.ts` | 27 / 32 | 0 | Delayed value hook (debounce-like) | `packages/client-core` |
| `apps/web/src/lib/useSmoothText.ts` | `apps/mobile/src/lib/use-smooth-text.ts` | 187 / 255 | 0 | Streaming-text smoother | `packages/client-core` |
| `apps/web/src/lib/media-retry.ts` | `apps/mobile/src/lib/media-retry.ts` | 164 / 156 | 0 | Backoff retry for media loads | `packages/client-core` |
| `apps/web/src/lib/attachments.ts` | `apps/mobile/src/lib/attachments.ts` | 225 / 227 | 0 | Attachment normalization/limits | `packages/chat-core` |
| `apps/web/src/lib/stickers.ts` | `apps/mobile/src/lib/stickers.ts` | 137 / 260 | 0 | Sticker pack library + view models | `packages/client-core` |
| `apps/web/src/lib/push/badge.ts` | `apps/mobile/src/lib/push/badge.ts` | 100 / 84 | 0 | Push badge count formatting | `packages/client-core` |
| `apps/web/src/lib/drafts.ts` | `apps/mobile/src/lib/drafts.ts` | 160 / 335 | 0 | Draft stream reconnect + jittered backoff | `packages/client-core` |
| `apps/web/src/lib/auth.ts` | `apps/mobile/src/lib/auth.ts` | 42 / 144 | 0 | Auth/session helpers | partially: storage differs |
| `apps/web/src/lib/effect/api-client.ts` | `apps/mobile/src/lib/effect/api-client.ts` | 85 / 45 | 0 | API client layers | `packages/client-core` |
| `apps/web/src/components/personLink.tsx` | `apps/mobile/src/lib/person-link.ts` | 143 / 69 | 0 | JID/handle parsing and link text | `packages/chat-core` |
| `apps/web/src/lib/format.ts` | `apps/mobile/src/lib/format.ts` | 2 / 32 | 0 | Chat preview/subtitle formatting | `packages/chat-core` |
| `apps/web/src/components/MarkdownText.tsx` | `apps/mobile/src/components/chat/markdown-text.tsx` | 63 / 286 | 0 | Markdown rendering: `react-markdown` (web) vs local parser (mobile) | `packages/chat-core` or a library |
| `apps/web/src/store/effects/history.ts` | `apps/mobile/src/store/effects/history.ts` | 312 / 315 | 14 | History load adapter over `client-core` | already shared; adapters stay |
| `apps/web/src/store/effects/ports.ts` | `apps/mobile/src/store/effects/ports.ts` | 286 / 286 | 0 | Ports service definitions + platform adapters | interface only; adapters stay |
| `apps/web/src/store/effects/send.ts` | `apps/mobile/src/store/effects/send.ts` | 110 / 207 | 0 | Send effect adapter | already shared; adapters stay |
| `apps/web/src/store/effects/groupActions.ts` | `apps/mobile/src/store/effects/group-actions.ts` | 160 / 327 | 0 | Group action adapter | already shared; adapters stay |
| `apps/web/src/store/effects/pins.ts` | `apps/mobile/src/store/effects/pins.ts` | 119 / 219 | 0 | Pins adapter | already shared; adapters stay |
| `apps/web/src/store/effects/locals.ts` | `apps/mobile/src/store/effects/locals.ts` | 87 / 112 | 0 | Local cache adapter | already shared; adapters stay |
| `apps/web/src/store/effects/lifecycle.ts` | `apps/mobile/src/store/effects/lifecycle.ts` | 268 / 352 | 0 | Lifecycle/reconnect adapter | already shared; adapters stay |
| `apps/web/src/store/effects/chatRows.ts` | `apps/mobile/src/store/effects/chat-rows.ts` | 37 / 34 | 0 | Chat-row selectors over `client-core` | already shared |
| `apps/web/src/store/effects/topics.ts` | `apps/mobile/src/lib/topics.ts` | 189 / 244 | 0 | Topic store adapter / API | `packages/client-core` (API part) |
| `apps/web/src/lib/effect/errors.ts` | `apps/mobile/src/lib/effect/errors.ts` | 30 / 39 | 0 | Error normalization | `packages/client-core` |
| `apps/web/src/lib/effect/runtime.ts` | `apps/mobile/src/lib/effect/runtime.ts` | 20 / 21 | 0 | `runWeb`/`runMobile` runtime shim | platform-specific, small |
| `apps/web/src/lib/effect/use-action.ts` | `apps/mobile/src/lib/effect/use-action.ts` | 10 / 10 | 0 | Action hook | `packages/client-core` |
| `apps/web/src/lib/effect/use-query.ts` | `apps/mobile/src/lib/effect/use-query.ts` | 7 / 7 | 0 | Query hook | `packages/client-core` |
| `apps/web/src/lib/api/groups.ts` | `apps/mobile/src/store/effects/groups.ts` | 325 / 315 | 0 | Group API vs store adapter | `packages/client-core` (API part) |
| `apps/web/src/lib/api/stickers.ts` | `apps/mobile/src/lib/stickers.ts` | 268 / 260 | 0 | Sticker API | `packages/client-core` |

Cross-name clones that are not basename twins but hold the same logic (from section 1): `useClientVersionCheck.ts` ↔ `use-client-version.ts` (38 lines), `store/messageCache.ts` ↔ `store/offline-cache.ts` (29 lines), `usePeopleSearch.ts` ↔ `contacts/use-people-prefix-search.ts` (34 lines), `lib/api/topics.ts` ↔ `lib/topics-api.ts` (24 lines), `Composer.tsx` ↔ `chat-composer-dock.tsx` (18 lines), `lib/voice/convert.ts` ↔ `lib/voice.ts` (15 lines).

The store-effect rows marked "already shared" are adapters around `@zilar/client-core/store`; their size is platform wiring, not duplicated logic (§2 of `docs/audit/dedup-status.md` is the prior round). The rows above them have no `@zilar/*` import of the equivalent logic and still hold it locally.

---

## 4. Hand-rolled helpers

Found by grepping `apps/*/src` and `packages/*/src` (tests excluded) for the named patterns on 2026-10-18. "Existing dependency" checks the repo's installed `package.json` dependencies only; nothing was installed.

| Kind | Local sites (`file:line`) | Existing dependency that covers it | Notes |
| --- | --- | --- | --- |
| Debounce / throttle | `apps/mobile/src/components/settings/use-handle-check.ts:35`; `apps/mobile/src/components/chat/message-search.ts:55`; `apps/web/src/lib/useMessageSearch.ts:34`; `apps/web/src/lib/usePeopleSearch.ts:87`; `apps/mobile/src/components/contacts/use-people-prefix-search.ts:84`; `apps/web/src/lib/useDelayed.ts:17`; `apps/mobile/src/lib/use-delayed.ts:24` | `effect` (`Effect.sleep` + fiber interruption) | Every debounce in the repo is already built on Effect; there is no shared hook, so five implementations repeat the pattern. React Native `scrollEventThrottle={16}` (`message-list.tsx:343`) is a prop, not a helper. |
| Deep equality | none found | `effect` (`Equal.equals`) | No local `deepEqual`/`shallowEqual` function exists. |
| LRU / TTL caches | `apps/server/src/link-preview/fetch.ts:30` (hit/miss TTL, max entries, image cache); `apps/server/src/push/archives-cache.ts:14,89`; `apps/server/src/hands/desk-status.ts:24,104` (TTL + in-flight coalescing); `apps/server/src/agents/gateway/topic-follow.ts:19,60`; `apps/server/src/ai/catalog.ts:27,134`; `apps/server/src/routines/schedule.ts:203` (formatter cache) | `effect` (`Cache` with capacity/TTL, `Duration`) | Six local cache implementations; three are full LRU/TTL with eviction. `effect`'s `Cache` covers TTL and capacity but not the small synchronous maps. |
| Retry with backoff | `packages/runner-tunnel/src/runner/options.ts:75` (`computeBackoff`); `apps/web/src/lib/drafts.ts:48`; `apps/mobile/src/lib/drafts.ts:68`; `apps/web/src/lib/media-retry.ts:31`; `apps/mobile/src/lib/media-retry.ts:32`; `apps/mobile/src/auth/session-store.ts:96`; `apps/web/src/auth/AuthProvider.tsx:163`; `apps/server/src/push/api-subscribe.ts:82`; `apps/server/src/push/archive-scan.ts:77`; `apps/server/src/machines/pairing.ts:67`; `apps/server/src/topics/queries.ts:16` | `effect` (`Schedule.exponential` / `Effect.retry`) | `apps/server/src/ai/model-client.ts:270` already uses `Effect.retry`; the rest hand-roll attempts or set a `retry` flag. |
| Relative-time / date formatting | `apps/web/src/components/machines/ApprovedMachineCard.tsx:223` (`formatRelative`); `apps/mobile/src/components/settings/profile-logic.ts:88`; `apps/mobile/src/lib/routines-format.ts:31`; `apps/mobile/src/components/connections/connection-card.tsx:21`; `apps/server/src/agents/memory/mirror.ts:43`; `apps/server/src/routines/schedule.ts:205`; `apps/server/src/agents/prompt-time.ts:11` | `@zilar/chat-core` (`formatTime`, `formatDateSeparator`, `formatRelativeAudit`, `formatLastSeen`) | No `date-fns`/`dayjs`/`luxon` installed. Chat formatting is shared; the remaining sites are settings/admin text. A generic relative-time library would cover them. |
| Byte-size formatting | `apps/mobile/src/components/chat/file-bubble.tsx:148` (`formatSize`) | `@zilar/chat-core` (`formatFileSize`, `packages/chat-core/src/media.ts:27`) | One local duplicate of a shared function. |
| Duration formatting | `apps/mobile/src/components/chat/attach/gallery-grid.tsx:14` (`formatDuration(seconds)`); `apps/mobile/src/app/dev/whistle.tsx:290` (`formatMs`) | `@zilar/chat-core` (`formatDuration` in `format.ts:63`, `formatClock` in `format-duration.ts:6`) | `formatMs` is byte-for-byte the same behaviour as `formatClock`; the gallery variant adds an hours field. |
| UUID / random ids | `apps/mobile/src/lib/polyfills.ts:35` (`randomUuid` v4), `apps/mobile/src/store/effects/ports.ts:178` (`Math.random().toString(36)`) | none needed; `node:crypto` on the server, Hermes polyfill on the phone | The polyfill is required (AGENTS.md: Hermes has no `crypto.subtle`; app code calls `crypto.randomUUID` after the polyfill). `expo-crypto` is not installed. |
| URL / query building | `apps/mobile/src/lib/profile-api.ts:168`; `apps/server/src/stickers/api-decode.ts:48`; `apps/server/src/gifs/api.ts:78`; `apps/server/src/stickers/telegram/pack-input.ts:30` | native `URL`/`URLSearchParams` + `zod` | The server sites parse `request.originalUrl.slice(queryIndex + 1)` by hand instead of `new URL(...).searchParams`. |
| Markdown / text parsing | `apps/mobile/src/lib/markdown-blocks.ts:131` (`parseMarkdown`); `apps/mobile/src/lib/markdown-inline.ts`; `apps/mobile/src/lib/markdown.ts:14`; `packages/chat-core/src/markdown.ts:56` (`markdownToPlain`); `packages/devtools/src/plan-page/findings.ts:53` (`stripMarkdown`) | `react-markdown` + `remark-gfm` on web only | Mobile hand-rolls 394 lines of Markdown parser (`markdown*.ts`). No Markdown renderer for React Native is installed; `marked`/`micromark` would be the well-known choice. |
| Color math | `packages/chat-core/src/sender-color.ts:19` (`senderColor`) | none | Only a hash-to-hue function exists; no hex/RGB/HSL conversion or contrast math was found. `culori` is the well-known library if that changes. |
| Copy to clipboard | `apps/web/src/lib/clipboard.ts:11` (`copyText`); `apps/mobile/src/components/chat/new-chat-button.tsx:50` (`copyToClipboard`); `apps/mobile/src/components/chat/message-bubble-actions.tsx:43`; `apps/mobile/src/components/chat/selection-bar.tsx:93`; `apps/mobile/src/components/chat/use-group-invite-links.ts:102` | `expo-clipboard` (installed), `navigator.clipboard` on web | Several mobile call sites repeat the Effect wrapper around `Clipboard.setStringAsync`. |
| `sleep` / `withTimeout` | `apps/server/src/health.ts:113` (`withTimeout`); `apps/mobile/src/lib/push/native.ts:96` (`withTimeout`); `apps/server/src/routines/execute.ts:128` (`defaultSleep`); `packages/devtools/src/lead/autopilot.ts:231` (`sleep`); `packages/devtools/src/xmpp-e2e/harness.ts:23` (`sleep`); `packages/devtools/src/gate/cli.ts:199` (`sleepSync`) | `effect` (`Effect.sleep`, `Effect.timeout`) | Two local `withTimeout` implementations and four `sleep` helpers. |

Counts for the summary: 13 kinds, 57 sites; 394 lines in the mobile Markdown parser; about 150 lines in the other helper bodies.

---

## Method notes and limitations

- jscpd measures exact token clones only (default `--mode strict`). Semantic twins below `--min-lines 8` / `--min-tokens 70`, or reformatted code, are not counted.
- Per-unit percentages come from separate jscpd runs; they exclude clones that cross a unit boundary. The overall 1.66% includes those, which is why the per-unit sum (3,149) is smaller than 4,558.
- `apps/mobile/src/types/xmpp.d.ts` and `packages/xmpp-core/src/types/xmpp.d.ts` dominate the largest cluster (97 lines). Declaration files are included because the task did not exclude `.d.ts`.
- knip's metro-config load error is the only tool failure. It exited 2; the JSON was still complete (614 issue files). No config file or `package.json` was added or changed to work around it.
- The mobile Markdown parser line count is from `wc -l`; helper-body estimates are a hand count over the functions named in the table, not a tool measurement.
- This scan changed no source file. The only changed files in the task commit are `docs/audit/reduce-scan.md` and `work/T-2013-reduce-code-scan.md`.

## Appendix A: full twin list (219 non-test pairs)

| Web module | Web lines | Mobile module | Mobile lines | jscpd shared lines |
| --- | ---: | --- | ---: | ---: |
| `apps/web/src/components/AiBadge.tsx` | 16 | `apps/mobile/src/components/chat/ai-badge.tsx` | 13 | - |
| `apps/web/src/components/ApprovalCard.tsx` | 286 | `apps/mobile/src/components/chat/approval-card.tsx` | 233 | - |
| `apps/web/src/components/Avatar.tsx` | 41 | `apps/mobile/src/components/chat/avatar.tsx` | 115 | - |
| `apps/web/src/components/ChannelComposerBar.tsx` | 75 | `apps/mobile/src/components/chat/channel-composer-bar.tsx` | 149 | - |
| `apps/web/src/components/ChatHeader.tsx` | 393 | `apps/mobile/src/components/chat/chat-header.tsx` | 281 | - |
| `apps/web/src/components/ChatList.tsx` | 210 | `apps/mobile/src/components/chat/chat-list.tsx` | 145 | - |
| `apps/web/src/components/ChatList.tsx` | 210 | `apps/mobile/src/lib/chat-list.ts` | 85 | - |
| `apps/web/src/components/ChatListItem.tsx` | 234 | `apps/mobile/src/components/chat/chat-list-item.tsx` | 185 | - |
| `apps/web/src/components/ClientVersionBanner.tsx` | 32 | `apps/mobile/src/components/client-version-banner.tsx` | 32 | - |
| `apps/web/src/components/Composer.tsx` | 344 | `apps/mobile/src/components/chat/composer.tsx` | 313 | - |
| `apps/web/src/components/ConfirmDialog.tsx` | 63 | `apps/mobile/src/components/ui/confirm-dialog.tsx` | 120 | - |
| `apps/web/src/components/DateSeparator.tsx` | 18 | `apps/mobile/src/components/chat/date-separator.tsx` | 19 | - |
| `apps/web/src/components/EditBar.tsx` | 30 | `apps/mobile/src/components/chat/edit-bar.tsx` | 40 | - |
| `apps/web/src/components/EntityAvatar.tsx` | 75 | `apps/mobile/src/components/chat/entity-avatar.tsx` | 75 | 29 |
| `apps/web/src/components/FolderTabs.tsx` | 97 | `apps/mobile/src/components/chat/folder-tabs.tsx` | 186 | - |
| `apps/web/src/components/ForwardedHeader.tsx` | 16 | `apps/mobile/src/components/chat/forwarded-header.tsx` | 23 | - |
| `apps/web/src/components/GifPanel.tsx` | 375 | `apps/mobile/src/components/chat/gif-panel.tsx` | 284 | - |
| `apps/web/src/components/ImageMessage.tsx` | 112 | `apps/mobile/src/components/chat/image-message.tsx` | 26 | - |
| `apps/web/src/components/LinkText.tsx` | 164 | `apps/mobile/src/components/chat/link-text.tsx` | 126 | - |
| `apps/web/src/components/MarkdownText.tsx` | 63 | `apps/mobile/src/components/chat/markdown-text.tsx` | 286 | - |
| `apps/web/src/components/MentionPicker.tsx` | 70 | `apps/mobile/src/components/chat/mention-picker.tsx` | 59 | - |
| `apps/web/src/components/MessageBubble.tsx` | 400 | `apps/mobile/src/components/chat/message-bubble.tsx` | 390 | - |
| `apps/web/src/components/MessageList.tsx` | 251 | `apps/mobile/src/components/chat/message-list.tsx` | 362 | - |
| `apps/web/src/components/MessageListRow.tsx` | 126 | `apps/mobile/src/components/chat/message-list-row.tsx` | 202 | - |
| `apps/web/src/components/NewChatButton.tsx` | 250 | `apps/mobile/src/components/chat/new-chat-button.tsx` | 270 | - |
| `apps/web/src/components/NewGroupMembers.tsx` | 72 | `apps/mobile/src/components/group/new-group-members.tsx` | 128 | - |
| `apps/web/src/components/PackEditor.tsx` | 225 | `apps/mobile/src/components/stickers/pack-editor.ts` | 330 | - |
| `apps/web/src/components/PeopleSearchResult.tsx` | 135 | `apps/mobile/src/components/contacts/people-search-result.tsx` | 111 | - |
| `apps/web/src/components/PinnedBanner.tsx` | 178 | `apps/mobile/src/components/chat/pinned-banner.tsx` | 150 | - |
| `apps/web/src/components/ProgressCard.tsx` | 273 | `apps/mobile/src/components/chat/progress-card.tsx` | 242 | 40 |
| `apps/web/src/components/ReactionChips.tsx` | 54 | `apps/mobile/src/components/chat/reaction-chips.tsx` | 96 | - |
| `apps/web/src/components/ReplyQuote.tsx` | 60 | `apps/mobile/src/components/chat/reply-quote.tsx` | 69 | - |
| `apps/web/src/components/SelectionBar.tsx` | 181 | `apps/mobile/src/components/chat/selection-bar.tsx` | 166 | 42 |
| `apps/web/src/components/Skeleton.tsx` | 60 | `apps/mobile/src/components/chat/skeleton.tsx` | 137 | - |
| `apps/web/src/components/StickerMessage.tsx` | 87 | `apps/mobile/src/components/chat/sticker-message.tsx` | 108 | - |
| `apps/web/src/components/StickerPanel.tsx` | 299 | `apps/mobile/src/components/chat/sticker-panel.tsx` | 401 | - |
| `apps/web/src/components/TopicRow.tsx` | 225 | `apps/mobile/src/components/chat/topic-row.tsx` | 176 | - |
| `apps/web/src/components/TypingDots.tsx` | 17 | `apps/mobile/src/components/chat/typing-dots.tsx` | 93 | - |
| `apps/web/src/components/UnreadDivider.tsx` | 13 | `apps/mobile/src/components/chat/unread-divider.tsx` | 18 | - |
| `apps/web/src/components/VoiceMessage.tsx` | 324 | `apps/mobile/src/components/chat/voice-message.tsx` | 284 | - |
| `apps/web/src/components/ais/AiActivity.tsx` | 227 | `apps/mobile/src/components/ais/ai-activity.tsx` | 324 | - |
| `apps/web/src/components/ais/AiMemorySection.tsx` | 254 | `apps/mobile/src/components/ais/ai-memory-section.tsx` | 324 | - |
| `apps/web/src/components/ais/LimitsFields.tsx` | 60 | `apps/mobile/src/components/ais/limits-fields.tsx` | 84 | - |
| `apps/web/src/components/ais/ModelPicker.tsx` | 172 | `apps/mobile/src/components/ais/model-picker.tsx` | 117 | - |
| `apps/web/src/components/ais/errors.ts` | 15 | `apps/mobile/src/auth/errors.ts` | 27 | - |
| `apps/web/src/components/ais/errors.ts` | 15 | `apps/mobile/src/components/ais/errors.ts` | 19 | - |
| `apps/web/src/components/ais/errors.ts` | 15 | `apps/mobile/src/components/connections/errors.ts` | 32 | - |
| `apps/web/src/components/ais/errors.ts` | 15 | `apps/mobile/src/components/integrations/errors.ts` | 32 | - |
| `apps/web/src/components/ais/errors.ts` | 15 | `apps/mobile/src/components/machines/errors.ts` | 35 | - |
| `apps/web/src/components/ais/errors.ts` | 15 | `apps/mobile/src/lib/effect/errors.ts` | 39 | - |
| `apps/web/src/components/ais/limits.ts` | 10 | `apps/mobile/src/components/ais/limits.ts` | 10 | - |
| `apps/web/src/components/ais/models.ts` | 3 | `apps/mobile/src/components/ais/models.ts` | 9 | - |
| `apps/web/src/components/ais/new-ai/KeyStep.tsx` | 68 | `apps/mobile/src/components/ais/new-ai/key-step.tsx` | 67 | - |
| `apps/web/src/components/ais/new-ai/ModelStep.tsx` | 75 | `apps/mobile/src/components/ais/new-ai/model-step.tsx` | 96 | - |
| `apps/web/src/components/ais/new-ai/ProviderStep.tsx` | 76 | `apps/mobile/src/components/ais/new-ai/provider-step.tsx` | 81 | - |
| `apps/web/src/components/ais/new-ai/SetupStep.tsx` | 95 | `apps/mobile/src/components/ais/new-ai/setup-step.tsx` | 69 | - |
| `apps/web/src/components/ais/new-ai/useKeyCheck.ts` | 230 | `apps/mobile/src/components/connections/use-key-check.ts` | 244 | - |
| `apps/web/src/components/ais/new-ai/useNewAiFlow.ts` | 251 | `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts` | 262 | - |
| `apps/web/src/components/ais/templates.ts` | 8 | `apps/mobile/src/components/ais/templates.ts` | 8 | - |
| `apps/web/src/components/approvals/ApprovalRow.tsx` | 57 | `apps/mobile/src/components/approvals/approval-row.tsx` | 112 | - |
| `apps/web/src/components/auth/AuthFlow.tsx` | 280 | `apps/mobile/src/auth/AuthFlow.tsx` | 284 | - |
| `apps/web/src/components/auth/InviteCodeField.tsx` | 35 | `apps/mobile/src/auth/InviteCodeField.tsx` | 35 | 22 |
| `apps/web/src/components/auth/OtpInput.tsx` | 109 | `apps/mobile/src/auth/OtpInput.tsx` | 87 | 19 |
| `apps/web/src/components/chatList/RequestRows.tsx` | 282 | `apps/mobile/src/components/chat/request-rows.tsx` | 268 | 11 |
| `apps/web/src/components/folderIcon.tsx` | 61 | `apps/mobile/src/components/chat/folder-icon.ts` | 62 | - |
| `apps/web/src/components/group-info/AvatarStack.tsx` | 40 | `apps/mobile/src/components/group-info/avatar-stack.tsx` | 51 | - |
| `apps/web/src/components/group-info/PeoplePage.tsx` | 132 | `apps/mobile/src/components/channel-info/people-page.tsx` | 176 | - |
| `apps/web/src/components/group-info/TopicsSection.tsx` | 287 | `apps/mobile/src/components/group-info/topics-section.tsx` | 303 | - |
| `apps/web/src/components/machines/errors.ts` | 24 | `apps/mobile/src/auth/errors.ts` | 27 | - |
| `apps/web/src/components/machines/errors.ts` | 24 | `apps/mobile/src/components/ais/errors.ts` | 19 | - |
| `apps/web/src/components/machines/errors.ts` | 24 | `apps/mobile/src/components/connections/errors.ts` | 32 | - |
| `apps/web/src/components/machines/errors.ts` | 24 | `apps/mobile/src/components/integrations/errors.ts` | 32 | - |
| `apps/web/src/components/machines/errors.ts` | 24 | `apps/mobile/src/components/machines/errors.ts` | 35 | - |
| `apps/web/src/components/machines/errors.ts` | 24 | `apps/mobile/src/lib/effect/errors.ts` | 39 | - |
| `apps/web/src/components/media/MediaRows.tsx` | 116 | `apps/mobile/src/components/chat/media-rows.tsx` | 232 | - |
| `apps/web/src/components/message/AlbumGrid.tsx` | 255 | `apps/mobile/src/components/chat/album-grid.tsx` | 305 | 12 |
| `apps/web/src/components/message/AttachmentBody.tsx` | 367 | `apps/mobile/src/components/chat/attachment-body.tsx` | 237 | - |
| `apps/web/src/components/message/EmptyChat.tsx` | 112 | `apps/mobile/src/components/chat/empty-chat.tsx` | 123 | 18 |
| `apps/web/src/components/message/HandoffLine.tsx` | 81 | `apps/mobile/src/components/chat/handoff-line.tsx` | 85 | 12 |
| `apps/web/src/components/message/LinkPreviewCard.tsx` | 72 | `apps/mobile/src/components/chat/link-preview-card.tsx` | 176 | - |
| `apps/web/src/components/message/MediaMetaPill.tsx` | 30 | `apps/mobile/src/components/chat/media-meta-pill.tsx` | 41 | - |
| `apps/web/src/components/message/QuestionCard.tsx` | 97 | `apps/mobile/src/components/chat/question-card.tsx` | 88 | - |
| `apps/web/src/components/message/RoutineHeader.tsx` | 23 | `apps/mobile/src/components/chat/routine-header.tsx` | 34 | - |
| `apps/web/src/components/message/blocks/AlertBlock.tsx` | 141 | `apps/mobile/src/components/chat/blocks/alert-block.tsx` | 133 | - |
| `apps/web/src/components/message/blocks/BarsBlock.tsx` | 80 | `apps/mobile/src/components/chat/blocks/bars-block.tsx` | 104 | 18 |
| `apps/web/src/components/message/blocks/BlockCard.tsx` | 225 | `apps/mobile/src/components/chat/blocks/block-card.tsx` | 274 | 15 |
| `apps/web/src/components/message/blocks/BlockRespond.tsx` | 42 | `apps/mobile/src/components/chat/blocks/block-respond.tsx` | 82 | - |
| `apps/web/src/components/message/blocks/ButtonsBlock.tsx` | 141 | `apps/mobile/src/components/chat/blocks/buttons-block.tsx` | 133 | 26 |
| `apps/web/src/components/message/blocks/CalloutBlock.tsx` | 39 | `apps/mobile/src/components/chat/blocks/callout-block.tsx` | 35 | - |
| `apps/web/src/components/message/blocks/ChartBlocks.tsx` | 25 | `apps/mobile/src/components/chat/blocks/chart-blocks.tsx` | 35 | 22 |
| `apps/web/src/components/message/blocks/ChecklistBlock.tsx` | 108 | `apps/mobile/src/components/chat/blocks/checklist-block.tsx` | 126 | - |
| `apps/web/src/components/message/blocks/ChoiceBlock.tsx` | 91 | `apps/mobile/src/components/chat/blocks/choice-block.tsx` | 90 | - |
| `apps/web/src/components/message/blocks/ChoiceBlocks.tsx` | 37 | `apps/mobile/src/components/chat/blocks/choice-blocks.tsx` | 44 | - |
| `apps/web/src/components/message/blocks/ContentBlocks.tsx` | 34 | `apps/mobile/src/components/chat/blocks/content-blocks.tsx` | 42 | - |
| `apps/web/src/components/message/blocks/CountdownBlock.tsx` | 80 | `apps/mobile/src/components/chat/blocks/countdown-block.tsx` | 97 | - |
| `apps/web/src/components/message/blocks/DataBlocks.tsx` | 22 | `apps/mobile/src/components/chat/blocks/data-blocks.tsx` | 25 | 17 |
| `apps/web/src/components/message/blocks/EventBlock.tsx` | 38 | `apps/mobile/src/components/chat/blocks/event-block.tsx` | 50 | - |
| `apps/web/src/components/message/blocks/FigureBlock.tsx` | 58 | `apps/mobile/src/components/chat/blocks/figure-block.tsx` | 66 | - |
| `apps/web/src/components/message/blocks/FileBlock.tsx` | 46 | `apps/mobile/src/components/chat/blocks/file-block.tsx` | 110 | - |
| `apps/web/src/components/message/blocks/FormBlock.tsx` | 204 | `apps/mobile/src/components/chat/blocks/form-block.tsx` | 212 | 11 |
| `apps/web/src/components/message/blocks/GaugeBlock.tsx` | 64 | `apps/mobile/src/components/chat/blocks/gauge-block.tsx` | 77 | - |
| `apps/web/src/components/message/blocks/ImagesBlock.tsx` | 91 | `apps/mobile/src/components/chat/blocks/images-block.tsx` | 182 | - |
| `apps/web/src/components/message/blocks/LineBlock.tsx` | 98 | `apps/mobile/src/components/chat/blocks/line-block.tsx` | 122 | - |
| `apps/web/src/components/message/blocks/LinkBlock.tsx` | 41 | `apps/mobile/src/components/chat/blocks/link-block.tsx` | 53 | - |
| `apps/web/src/components/message/blocks/NumberBlock.tsx` | 62 | `apps/mobile/src/components/chat/blocks/number-block.tsx` | 78 | - |
| `apps/web/src/components/message/blocks/PlaceBlock.tsx` | 34 | `apps/mobile/src/components/chat/blocks/place-block.tsx` | 61 | - |
| `apps/web/src/components/message/blocks/PollBlock.tsx` | 180 | `apps/mobile/src/components/chat/blocks/poll-block.tsx` | 149 | 18 |
| `apps/web/src/components/message/blocks/ProgressBlock.tsx` | 61 | `apps/mobile/src/components/chat/blocks/progress-block.tsx` | 77 | - |
| `apps/web/src/components/message/blocks/ProgressBlocks.tsx` | 26 | `apps/mobile/src/components/chat/blocks/progress-blocks.tsx` | 34 | 21 |
| `apps/web/src/components/message/blocks/RatingBlock.tsx` | 83 | `apps/mobile/src/components/chat/blocks/rating-block.tsx` | 85 | - |
| `apps/web/src/components/message/blocks/StatsBlock.tsx` | 59 | `apps/mobile/src/components/chat/blocks/stats-block.tsx` | 80 | - |
| `apps/web/src/components/message/blocks/StatusBlock.tsx` | 74 | `apps/mobile/src/components/chat/blocks/status-block.tsx` | 75 | - |
| `apps/web/src/components/message/blocks/TableBlock.tsx` | 117 | `apps/mobile/src/components/chat/blocks/table-block.tsx` | 101 | - |
| `apps/web/src/components/message/blocks/TimelineBlock.tsx` | 113 | `apps/mobile/src/components/chat/blocks/timeline-block.tsx` | 107 | - |
| `apps/web/src/components/message/blocks/WeatherBlock.tsx` | 64 | `apps/mobile/src/components/chat/blocks/weather-block.tsx` | 76 | 21 |
| `apps/web/src/components/message/blocks/blockIcons.ts` | 60 | `apps/mobile/src/components/chat/blocks/block-icons.ts` | 60 | 32 |
| `apps/web/src/components/panels/TopicHeader.tsx` | 72 | `apps/mobile/src/app/dev/topic-header.tsx` | 21 | - |
| `apps/web/src/components/personLink.tsx` | 143 | `apps/mobile/src/lib/person-link.ts` | 69 | - |
| `apps/web/src/components/routines/RoutineRow.tsx` | 174 | `apps/mobile/src/components/routines/routine-row.tsx` | 123 | - |
| `apps/web/src/components/settings/EmailCard.tsx` | 122 | `apps/mobile/src/components/integrations/email-card.tsx` | 127 | - |
| `apps/web/src/components/settings/TelegramCard.tsx` | 116 | `apps/mobile/src/components/integrations/telegram-card.tsx` | 123 | - |
| `apps/web/src/components/settings/hub/rows.ts` | 90 | `apps/mobile/src/components/approvals/rows.ts` | 173 | - |
| `apps/web/src/components/sticker/EmojiCategoryBar.tsx` | 108 | `apps/mobile/src/components/chat/emoji-category-bar.tsx` | 112 | - |
| `apps/web/src/components/sticker/EmojiTab.tsx` | 246 | `apps/mobile/src/components/chat/emoji-tab.tsx` | 278 | - |
| `apps/web/src/components/tools/RoutinesSection.tsx` | 345 | `apps/mobile/src/components/ais/routines-section.tsx` | 239 | - |
| `apps/web/src/components/tools/ToolsSection.tsx` | 169 | `apps/mobile/src/components/ais/tools-section.tsx` | 178 | - |
| `apps/web/src/components/topic/AiActivityMarks.tsx` | 110 | `apps/mobile/src/components/chat/ai-activity-marks.tsx` | 196 | 13 |
| `apps/web/src/components/topic/AiStatusLine.tsx` | 90 | `apps/mobile/src/components/chat/ai-status-line.tsx` | 74 | - |
| `apps/web/src/components/topic/TopicJoinView.tsx` | 171 | `apps/mobile/src/components/chat/topic-join-view.tsx` | 177 | - |
| `apps/web/src/components/topic/TopicLinkRow.tsx` | 183 | `apps/mobile/src/components/chat/topic-link-row.tsx` | 149 | 13 |
| `apps/web/src/components/topic/TopicMuteLeave.tsx` | 92 | `apps/mobile/src/components/chat/topic-mute-leave.tsx` | 117 | - |
| `apps/web/src/components/topic/TopicNotInRow.tsx` | 89 | `apps/mobile/src/components/chat/topic-not-in-row.tsx` | 107 | 44 |
| `apps/web/src/components/topic/TopicPeopleLine.tsx` | 189 | `apps/mobile/src/components/chat/topic-people-line.tsx` | 210 | - |
| `apps/web/src/components/ui/badge.tsx` | 31 | `apps/mobile/src/lib/push/badge.ts` | 84 | - |
| `apps/web/src/components/ui/button.tsx` | 66 | `apps/mobile/src/components/ui/button.tsx` | 127 | - |
| `apps/web/src/components/ui/card.tsx` | 37 | `apps/mobile/src/components/ui/card.tsx` | 32 | - |
| `apps/web/src/components/ui/checkbox.tsx` | 43 | `apps/mobile/src/components/ui/checkbox.tsx` | 30 | - |
| `apps/web/src/components/ui/icon-button.tsx` | 45 | `apps/mobile/src/components/ui/icon-button.tsx` | 43 | - |
| `apps/web/src/components/ui/list-row.tsx` | 98 | `apps/mobile/src/components/ui/list-row.tsx` | 80 | - |
| `apps/web/src/components/ui/screen-header.tsx` | 58 | `apps/mobile/src/components/ui/screen-header.tsx` | 79 | - |
| `apps/web/src/components/ui/search-field.tsx` | 19 | `apps/mobile/src/components/ui/search-field.tsx` | 64 | - |
| `apps/web/src/components/ui/segmented-control.tsx` | 150 | `apps/mobile/src/components/ui/segmented-control.tsx` | 105 | - |
| `apps/web/src/components/ui/state-message.tsx` | 68 | `apps/mobile/src/components/ui/state-message.tsx` | 79 | - |
| `apps/web/src/components/ui/switch.tsx` | 53 | `apps/mobile/src/components/ui/switch.tsx` | 39 | - |
| `apps/web/src/components/ui/toast.tsx` | 73 | `apps/mobile/src/components/ui/toast.tsx` | 63 | - |
| `apps/web/src/components/useMessageListScroll.ts` | 228 | `apps/mobile/src/components/chat/use-message-list-scroll.ts` | 305 | - |
| `apps/web/src/lib/api/ais.ts` | 266 | `apps/mobile/src/app/(tabs)/ais.tsx` | 336 | - |
| `apps/web/src/lib/api/blocks.ts` | 36 | `apps/mobile/src/app/dev/blocks.tsx` | 21 | - |
| `apps/web/src/lib/api/blocks.ts` | 36 | `apps/mobile/src/components/contacts/blocks.ts` | 108 | - |
| `apps/web/src/lib/api/devices.ts` | 20 | `apps/mobile/src/app/settings/devices.tsx` | 376 | - |
| `apps/web/src/lib/api/groups.ts` | 325 | `apps/mobile/src/store/effects/groups.ts` | 315 | - |
| `apps/web/src/lib/api/machines.ts` | 46 | `apps/mobile/src/app/settings/machines.tsx` | 204 | - |
| `apps/web/src/lib/api/settings.ts` | 220 | `apps/mobile/src/app/(tabs)/settings.tsx` | 288 | - |
| `apps/web/src/lib/api/stickers.ts` | 268 | `apps/mobile/src/app/settings/stickers.tsx` | 321 | - |
| `apps/web/src/lib/api/stickers.ts` | 268 | `apps/mobile/src/lib/stickers.ts` | 260 | - |
| `apps/web/src/lib/api/topics.ts` | 143 | `apps/mobile/src/lib/topics.ts` | 244 | - |
| `apps/web/src/lib/attachments.ts` | 225 | `apps/mobile/src/lib/attachments.ts` | 227 | - |
| `apps/web/src/lib/attachments.ts` | 225 | `apps/mobile/src/mock/attachments.ts` | 40 | - |
| `apps/web/src/lib/auth.ts` | 42 | `apps/mobile/src/lib/auth.ts` | 144 | - |
| `apps/web/src/lib/chatBackground.ts` | 92 | `apps/mobile/src/components/chat/chat-background.tsx` | 31 | - |
| `apps/web/src/lib/chatPrefs.ts` | 12 | `apps/mobile/src/lib/chat-prefs.ts` | 64 | - |
| `apps/web/src/lib/composer-drafts.ts` | 175 | `apps/mobile/src/lib/composer-drafts.ts` | 261 | 47 |
| `apps/web/src/lib/contacts.ts` | 35 | `apps/mobile/src/app/settings/contacts.tsx` | 235 | - |
| `apps/web/src/lib/contacts.ts` | 35 | `apps/mobile/src/components/contacts/contacts.ts` | 68 | - |
| `apps/web/src/lib/drafts.ts` | 160 | `apps/mobile/src/lib/drafts.ts` | 335 | - |
| `apps/web/src/lib/effect/api-client.ts` | 85 | `apps/mobile/src/lib/effect/api-client.ts` | 45 | - |
| `apps/web/src/lib/effect/api-effect.ts` | 9 | `apps/mobile/src/lib/effect/api-effect.ts` | 9 | - |
| `apps/web/src/lib/effect/errors.ts` | 30 | `apps/mobile/src/auth/errors.ts` | 27 | - |
| `apps/web/src/lib/effect/errors.ts` | 30 | `apps/mobile/src/components/ais/errors.ts` | 19 | - |
| `apps/web/src/lib/effect/errors.ts` | 30 | `apps/mobile/src/components/connections/errors.ts` | 32 | - |
| `apps/web/src/lib/effect/errors.ts` | 30 | `apps/mobile/src/components/integrations/errors.ts` | 32 | - |
| `apps/web/src/lib/effect/errors.ts` | 30 | `apps/mobile/src/components/machines/errors.ts` | 35 | - |
| `apps/web/src/lib/effect/errors.ts` | 30 | `apps/mobile/src/lib/effect/errors.ts` | 39 | - |
| `apps/web/src/lib/effect/runtime.ts` | 20 | `apps/mobile/src/lib/effect/runtime.ts` | 21 | - |
| `apps/web/src/lib/effect/runtime.ts` | 20 | `apps/mobile/src/store/effects/runtime.ts` | 297 | - |
| `apps/web/src/lib/effect/use-action.ts` | 10 | `apps/mobile/src/lib/effect/use-action.ts` | 10 | - |
| `apps/web/src/lib/effect/use-query.ts` | 7 | `apps/mobile/src/lib/effect/use-query.ts` | 7 | - |
| `apps/web/src/lib/errors.ts` | 8 | `apps/mobile/src/auth/errors.ts` | 27 | - |
| `apps/web/src/lib/errors.ts` | 8 | `apps/mobile/src/components/ais/errors.ts` | 19 | - |
| `apps/web/src/lib/errors.ts` | 8 | `apps/mobile/src/components/connections/errors.ts` | 32 | - |
| `apps/web/src/lib/errors.ts` | 8 | `apps/mobile/src/components/integrations/errors.ts` | 32 | - |
| `apps/web/src/lib/errors.ts` | 8 | `apps/mobile/src/components/machines/errors.ts` | 35 | - |
| `apps/web/src/lib/errors.ts` | 8 | `apps/mobile/src/lib/effect/errors.ts` | 39 | - |
| `apps/web/src/lib/format.ts` | 2 | `apps/mobile/src/lib/format.ts` | 32 | - |
| `apps/web/src/lib/media-retry.ts` | 164 | `apps/mobile/src/lib/media-retry.ts` | 156 | - |
| `apps/web/src/lib/push/badge.ts` | 100 | `apps/mobile/src/lib/push/badge.ts` | 84 | - |
| `apps/web/src/lib/routines.ts` | 9 | `apps/mobile/src/app/settings/routines.tsx` | 251 | - |
| `apps/web/src/lib/stickers.ts` | 137 | `apps/mobile/src/app/settings/stickers.tsx` | 321 | - |
| `apps/web/src/lib/stickers.ts` | 137 | `apps/mobile/src/lib/stickers.ts` | 260 | - |
| `apps/web/src/lib/useContactRequests.ts` | 63 | `apps/mobile/src/lib/use-contact-requests.ts` | 60 | - |
| `apps/web/src/lib/useDelayed.ts` | 27 | `apps/mobile/src/lib/use-delayed.ts` | 32 | - |
| `apps/web/src/lib/useMessageSearch.ts` | 98 | `apps/mobile/src/components/chat/use-message-search.ts` | 42 | - |
| `apps/web/src/lib/usePeopleSearch.ts` | 180 | `apps/mobile/src/components/contacts/use-people-search.ts` | 72 | - |
| `apps/web/src/lib/useSmoothText.ts` | 187 | `apps/mobile/src/lib/use-smooth-text.ts` | 255 | - |
| `apps/web/src/lib/utils.ts` | 7 | `apps/mobile/src/lib/utils.ts` | 7 | - |
| `apps/web/src/lib/voice.ts` | 30 | `apps/mobile/src/lib/voice.ts` | 339 | - |
| `apps/web/src/mock/backend.ts` | 32 | `apps/mobile/src/mock/backend.ts` | 48 | - |
| `apps/web/src/mock/gate.ts` | 107 | `apps/mobile/src/mock/gate.ts` | 60 | - |
| `apps/web/src/mock/load.ts` | 23 | `apps/mobile/src/mock/load.ts` | 27 | - |
| `apps/web/src/store/ChatStoreProvider.tsx` | 115 | `apps/mobile/src/store/chat-store-provider.tsx` | 204 | - |
| `apps/web/src/store/atomStore.ts` | 3 | `apps/mobile/src/store/atomStore.ts` | 5 | - |
| `apps/web/src/store/chatListCache.ts` | 152 | `apps/mobile/src/lib/chat-list-cache.ts` | 192 | 63 |
| `apps/web/src/store/effects/badge.ts` | 25 | `apps/mobile/src/lib/push/badge.ts` | 84 | - |
| `apps/web/src/store/effects/chatRows.ts` | 37 | `apps/mobile/src/components/chat/chat-rows.tsx` | 108 | - |
| `apps/web/src/store/effects/chatRows.ts` | 37 | `apps/mobile/src/store/effects/chat-rows.ts` | 34 | - |
| `apps/web/src/store/effects/groupActions.ts` | 160 | `apps/mobile/src/store/effects/group-actions.ts` | 327 | - |
| `apps/web/src/store/effects/groups.ts` | 28 | `apps/mobile/src/store/effects/groups.ts` | 315 | - |
| `apps/web/src/store/effects/history.ts` | 312 | `apps/mobile/src/store/effects/history.ts` | 315 | 14 |
| `apps/web/src/store/effects/lifecycle.ts` | 268 | `apps/mobile/src/store/effects/lifecycle.ts` | 352 | - |
| `apps/web/src/store/effects/locals.ts` | 87 | `apps/mobile/src/store/effects/locals.ts` | 112 | - |
| `apps/web/src/store/effects/pins.ts` | 119 | `apps/mobile/src/store/effects/pins.ts` | 219 | - |
| `apps/web/src/store/effects/polling.ts` | 14 | `apps/mobile/src/store/effects/polling.ts` | 18 | - |
| `apps/web/src/store/effects/ports.ts` | 286 | `apps/mobile/src/store/effects/ports.ts` | 286 | - |
| `apps/web/src/store/effects/runtime.ts` | 19 | `apps/mobile/src/lib/effect/runtime.ts` | 21 | - |
| `apps/web/src/store/effects/runtime.ts` | 19 | `apps/mobile/src/store/effects/runtime.ts` | 297 | - |
| `apps/web/src/store/effects/send.ts` | 110 | `apps/mobile/src/store/effects/send.ts` | 207 | - |
| `apps/web/src/store/effects/topics.ts` | 189 | `apps/mobile/src/lib/topics.ts` | 244 | - |
| `apps/web/src/store/realStore.ts` | 117 | `apps/mobile/src/store/real-store.ts` | 397 | - |
| `apps/web/src/test/wait.ts` | 76 | `apps/mobile/src/test/wait.ts` | 110 | - |

## Appendix B: helper-site index

The `file:line` list is in section 4. No separate appendix is needed.
