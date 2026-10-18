---
id: T-2094
title: "Web cleanup: lib/api.ts named re-export lists become export * lines, AppRoutes wraps its 19 protected routes in one RequireAuth layout route, and the 14 re-export-only shim files go (importers point at the real module) — no behaviour change"
status: merged
milestone: M5
branch: task/T-2094-web-barrels-routes
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2094: Web barrels, shims and the route wrapper

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down, and the leftovers of the 10-10 size splits go. The lead measured these on 2026-10-18 at `823b2f10d`.

### Facts
1. **`apps/web/src/lib/api.ts` (329 lines).** After its own `fetchExport` and `updateMeProfile` (`:1-39`), the rest of the file is long named lists, for example `export { chatEntryTopics, clearChatHistory, … } from './api/chats';` and `export type { … } from './api/chats';`, one pair per `./api/*` module. 157 files import from `@/lib/api`.
2. **`apps/web/src/routes/AppRoutes.tsx` (354 lines).**
   - `RequireAuth` is defined at `:78`.
   - About 19 routes repeat `element={<RequireAuth><Page /></RequireAuth>}` over 5 lines each (for example `/c/:chatJid` and `/settings`).
   - The file uses React Router, and `Outlet` comes from `react-router`.
3. **The shims.** These 14 files only re-export:
   - `apps/web/src/lib/voice.ts`
   - `apps/web/src/store/effects/groups.ts`
   - `apps/web/src/store/effects/polling.ts`
   - `apps/web/src/lib/chatPrefs.ts`
   - `apps/web/src/lib/routines.ts`
   - `apps/web/src/store/atomStore.ts`
   - `apps/web/src/store/effects/sendFailure.ts`
   - `apps/web/src/lib/useDelayed.ts`
   - `apps/web/src/lib/preview-message.ts`
   - `apps/web/src/lib/format-duration.ts`
   - `apps/web/src/lib/effect/errors.ts`
   - `apps/web/src/lib/effect/api-effect.ts`
   - `apps/web/src/components/chatList/ContactRequestsRow.tsx`
   - `apps/web/src/components/ais/models.ts`

### Steps
1. **`api.ts`.** Replace each named list with `export * from './api/<module>';`. If TypeScript reports a name exported by two modules (TS2308), keep one explicit `export { name } from …` for that name only. Keep `fetchExport`, `updateMeProfile` and the `API_BASE` / `ApiError` export.
2. **`AppRoutes`.** Nest the protected routes under one `<Route element={<RequireAuth><Outlet /></RequireAuth>}>` and give each child only its `path` and `element`. Paths, order and behaviour stay the same. A guest still lands on `/login` with `state.from`.
3. **Shims.** Delete the 14 files; each importer imports the same names from the module the shim pointed at.
4. **Before deleting,** `git grep` each shim path again. An importer outside the Allowed files: report BLOCKED with its path.
5. No tests. Report the line counts.

### Allowed files
- `apps/web/src/auth/AuthProvider.tsx`
- `apps/web/src/components/AddContactDialog.tsx`
- `apps/web/src/components/ais/AiActivity.tsx`
- `apps/web/src/components/ais/AiComputerSection.tsx`
- `apps/web/src/components/ais/AiHealthRow.tsx`
- `apps/web/src/components/ais/AiMachineSection.tsx`
- `apps/web/src/components/ais/AiMemorySection.tsx`
- `apps/web/src/components/ais/AiPanel.tsx`
- `apps/web/src/components/ais/aiPanelOps.ts`
- `apps/web/src/components/ais/errors.ts`
- `apps/web/src/components/ais/models.ts`
- `apps/web/src/components/ais/new-ai/useKeyCheck.ts`
- `apps/web/src/components/ais/new-ai/useNewAiFlow.ts`
- `apps/web/src/components/ApprovalCard.tsx`
- `apps/web/src/components/approvals/AlwaysAllowedList.tsx`
- `apps/web/src/components/approvals/ApprovalsListSkeleton.tsx`
- `apps/web/src/components/channel-info/ChannelPeople.tsx`
- `apps/web/src/components/ChannelPanel.tsx`
- `apps/web/src/components/ChatActionsMenu.tsx`
- `apps/web/src/components/ChatBackgroundDialog.tsx`
- `apps/web/src/components/ChatList.tsx`
- `apps/web/src/components/chatList/ChatListBody.tsx`
- `apps/web/src/components/chatList/ContactRequestsRow.tsx`
- `apps/web/src/components/ChatListItem.tsx`
- `apps/web/src/components/composer/composerShared.ts`
- `apps/web/src/components/composer/useComposerAttachments.ts`
- `apps/web/src/components/composer/useMentions.ts`
- `apps/web/src/components/composer/useVoiceRecorder.ts`
- `apps/web/src/components/connections/ConnectionRow.tsx`
- `apps/web/src/components/connections/ReplaceKeyForm.tsx`
- `apps/web/src/components/ContactPanel.tsx`
- `apps/web/src/components/ContactProfileRow.tsx`
- `apps/web/src/components/ExplorePage.tsx`
- `apps/web/src/components/folder/folderEditorModel.ts`
- `apps/web/src/components/FolderEditorDialog.tsx`
- `apps/web/src/components/GifPanel.tsx`
- `apps/web/src/components/InviteDialog.tsx`
- `apps/web/src/components/machines/AddMachineDialog.tsx`
- `apps/web/src/components/machines/ApprovedRow.tsx`
- `apps/web/src/components/machines/MachineListSkeleton.tsx`
- `apps/web/src/components/machines/machineRowOps.ts`
- `apps/web/src/components/machines/PendingRow.tsx`
- `apps/web/src/components/machines/RevokedRow.tsx`
- `apps/web/src/components/media/MediaBody.tsx`
- `apps/web/src/components/media/useShowInChat.ts`
- `apps/web/src/components/message/EmptyChat.tsx`
- `apps/web/src/components/MessageBubble.tsx`
- `apps/web/src/components/MessageSearchResults.tsx`
- `apps/web/src/components/NewGroupDialog.tsx`
- `apps/web/src/components/NewTopicDialog.tsx`
- `apps/web/src/components/panels/channelPanelOps.ts`
- `apps/web/src/components/panels/groupPanelOps.ts`
- `apps/web/src/components/panels/panelLists.ts`
- `apps/web/src/components/panels/topic-failure.ts`
- `apps/web/src/components/panels/TopicActionButtons.tsx`
- `apps/web/src/components/panels/TopicAddDialog.fixture.tsx`
- `apps/web/src/components/panels/TopicAddDialog.tsx`
- `apps/web/src/components/panels/TopicAisSection.tsx`
- `apps/web/src/components/panels/TopicMembersSection.tsx`
- `apps/web/src/components/panels/topicPanelOps.ts`
- `apps/web/src/components/panels/TopicRolesSection.tsx`
- `apps/web/src/components/PinnedBanner.tsx`
- `apps/web/src/components/PinsPanel.tsx`
- `apps/web/src/components/ProfileSettingsSection.tsx`
- `apps/web/src/components/ProgressCard.tsx`
- `apps/web/src/components/routines/RoutineRow.tsx`
- `apps/web/src/components/settings/integrationErrors.ts`
- `apps/web/src/components/settings/useIntegrationSave.ts`
- `apps/web/src/components/Skeleton.tsx`
- `apps/web/src/components/StepsPanel.tsx`
- `apps/web/src/components/sticker/FavoriteStar.tsx`
- `apps/web/src/components/sticker/pageActions.ts`
- `apps/web/src/components/StickerPanel.tsx`
- `apps/web/src/components/TelegramImportDialog.tsx`
- `apps/web/src/components/tools/DeleteToolButton.tsx`
- `apps/web/src/components/tools/RoutinesSection.tsx`
- `apps/web/src/components/tools/toolDetailOps.ts`
- `apps/web/src/components/tools/ToolDetailPanel.tsx`
- `apps/web/src/components/tools/ToolRunSection.tsx`
- `apps/web/src/components/tools/ToolSourceSection.tsx`
- `apps/web/src/components/tools/ToolsSection.tsx`
- `apps/web/src/components/topic/AisHereKey.tsx`
- `apps/web/src/components/topic/AiStatusLine.tsx`
- `apps/web/src/components/topic/TopicJoinView.tsx`
- `apps/web/src/components/topic/TopicLinkRow.tsx`
- `apps/web/src/components/TopicRow.tsx`
- `apps/web/src/components/useMuteToggle.ts`
- `apps/web/src/components/VisibilitySection.tsx`
- `apps/web/src/components/VoiceMessage.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/attachments.ts`
- `apps/web/src/lib/blockedJids.ts`
- `apps/web/src/lib/chatPrefs.ts`
- `apps/web/src/lib/effect/api-effect.ts`
- `apps/web/src/lib/effect/errors.ts`
- `apps/web/src/lib/format-duration.ts`
- `apps/web/src/lib/preview-message.ts`
- `apps/web/src/lib/push/pageActions.ts`
- `apps/web/src/lib/push/sessionEnable.test.ts`
- `apps/web/src/lib/push/sessionEnable.ts`
- `apps/web/src/lib/push/usePushEnable.ts`
- `apps/web/src/lib/routines.ts`
- `apps/web/src/lib/useApprovalPolling.ts`
- `apps/web/src/lib/useChatFolders.ts`
- `apps/web/src/lib/useContactRequestCount.ts`
- `apps/web/src/lib/useDelayed.ts`
- `apps/web/src/lib/useIsServerOwner.ts`
- `apps/web/src/lib/useMessageSearch.ts`
- `apps/web/src/lib/usePendingApprovalCount.ts`
- `apps/web/src/lib/usePeopleSearch.ts`
- `apps/web/src/lib/useVoiceTranscription.ts`
- `apps/web/src/lib/voice.ts`
- `apps/web/src/routes/AisPage.tsx`
- `apps/web/src/routes/AppRoutes.tsx`
- `apps/web/src/routes/ApprovalsPage.tsx`
- `apps/web/src/routes/BlockedPage.tsx`
- `apps/web/src/routes/ConnectionsPage.tsx`
- `apps/web/src/routes/ContactsPage.tsx`
- `apps/web/src/routes/DevicesPage.tsx`
- `apps/web/src/routes/FoldersPage.tsx`
- `apps/web/src/routes/GroupHandleRoute.tsx`
- `apps/web/src/routes/HandlePage.tsx`
- `apps/web/src/routes/IntegrationsPage.tsx`
- `apps/web/src/routes/JoinPage.tsx`
- `apps/web/src/routes/LoginPage.tsx`
- `apps/web/src/routes/MachinesPage.tsx`
- `apps/web/src/routes/NamePage.tsx`
- `apps/web/src/routes/RequestsPage.tsx`
- `apps/web/src/routes/RoutinesPage.tsx`
- `apps/web/src/routes/SettingsHubPage.tsx`
- `apps/web/src/routes/SetupPage.tsx`
- `apps/web/src/store/atomStore.ts`
- `apps/web/src/store/ChatStoreProvider.tsx`
- `apps/web/src/store/effects/chatActions.ts`
- `apps/web/src/store/effects/ctx.ts`
- `apps/web/src/store/effects/groupActions.ts`
- `apps/web/src/store/effects/groups.ts`
- `apps/web/src/store/effects/polling.ts`
- `apps/web/src/store/effects/portAdapters.ts`
- `apps/web/src/store/effects/ports.ts`
- `apps/web/src/store/effects/prefs.ts`
- `apps/web/src/store/effects/sendFailure.test.ts`
- `apps/web/src/store/effects/sendFailure.ts`
- `apps/web/src/store/effects/storeContext.ts`
- `apps/web/src/store/realStore.ts`
- `apps/web/src/store/store.ts`
- `work/T-2094-web-barrels-routes.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 300 lower.
- **Lead check, web mock:** `/`, `/c/<chat>`, `/settings` and `/settings/ais` open signed in. A signed-out visit to `/settings` goes to `/login`.

---

## Report (written by the worker when done)

### What I did

- `apps/web/src/lib/api.ts` (329 → 50 lines): replaced the nine named export lists (values and types) with one `export * from './api/<module>'` per module (`chats`, `groups`, `topics`, `ais`, `machines`, `stickers`, `media`, `people`, `settings`). No TS2308 conflict appeared, so no explicit re-export was needed. Kept `fetchExport`, `updateMeProfile`, `API_BASE` and `ApiError` as they were. Consequence of `export *`, as the spec intends: a few names the old lists omitted (`removeContact`, `deleteGroup`, `stopAiTurn`, …) are now re-exported too.
- `apps/web/src/routes/AppRoutes.tsx` (354 → 229 lines): the 19 protected routes now live under one pathless `<Route element={<RequireAuth><Outlet /></RequireAuth>}>` and each child keeps only its `path` and `element`. Paths and their relative order are unchanged; `RequireAuth` still sends a guest to `/login` with `state.from` and still applies the name and handle gates. `Outlet` is imported from `react-router`; `/invite`, `/j`, `/login`, `/setup`, `/welcome/*`, `/u/:handle`, `/:atHandle` and the catch-all stay outside the group.
- Deleted the 14 shim files (84 lines total) and pointed every importer at the real module:
  - `lib/voice.ts` → `lib/voice/{recorder,convert,waveform}` per imported name (`useVoiceRecorder`, `composerShared`, `ports`, `portAdapters`, `lib/attachments`).
  - `store/effects/groups.ts` → `./groupCreate`, `./groupSettings`, `./topics` (`groupActions.ts`).
  - `store/effects/polling.ts` and `store/effects/sendFailure.ts` → `@zilar/client-core/store`.
  - `lib/chatPrefs.ts`, `lib/routines.ts`, `lib/preview-message.ts`, `lib/format-duration.ts`, `components/ais/models.ts`, `lib/useDelayed.ts`, `store/atomStore.ts`, `lib/effect/errors.ts`, `lib/effect/api-effect.ts` → `@zilar/chat-core` / `@zilar/client-core`.
  - `components/chatList/ContactRequestsRow.tsx` → `RequestRows as ContactRequestsRow` from `./RequestRows`.
  - Three importers used relative paths the spec's `git grep` pattern missed: `AiPanel.tsx` (`./models`), `store/effects/groupActions.ts` (`./groups`), `store/effects/storeContext.ts` (`./polling`). They are all inside the Allowed files and were updated the same way. Duplicate imports from the same package were merged.
- No tests added (the spec says none).

### Checks run

- `pnpm install` (frozen at the end by the gate): done.
- `pnpm --filter @zilar/web typecheck`: passed (both `tsconfig.json` and `tsconfig.node.json`).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/push/sessionEnable.test.ts src/store/effects/sendFailure.test.ts`: 2 files, 6 tests passed. These are the two web tests whose imports touched a deleted shim.
- `pnpm gate` from the repo root: **GATE FAIL**, but only on the `comments` step, and only because `main` moved after this branch was cut (see Notes). Summary:
  - `gate: 147 changed file(s) against main`
  - `PASS  install (frozen)  (1.4s)`
  - `PASS  format  (1.9s)`
  - `PASS  lint  (0.6s)`
  - `PASS  typecheck  (0.7s)`
  - `PASS  effect  (3.3s)`
  - `SKIP build @zilar/server (no server, package or manifest change)`
  - `PASS  tests @zilar/web  (6.0s)`
  - `scope: every changed file is inside the Allowed files`
  - `FAIL  comments: 456 added comment line(s) cite a task ID (docs/COMMENTS.md)` — all 456 are in `apps/server/src/**` files this task never touched; they are the comment cleanups T-2086/T-2091 removed on `main`.
  - `GATE FAIL`
- Same gate binary at this branch's base commit, which isolates the branch diff: `pnpm --filter @zilar/devtools exec tsx src/gate/cli.ts --base 823b2f10d`: **GATE PASS**:
  - `gate: 147 changed file(s) against 823b2f10d`
  - `PASS  install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `SKIP build @zilar/server`, `PASS tests @zilar/web`
  - `scope: every changed file is inside the Allowed files`
  - `comments: no task IDs in added comments`
  - `GATE PASS`

### Notes for the lead

- **Base drift, the gate failure is not from this branch.** This branch was cut at `823b2f10d`. While I worked, `main` gained `9ca690ca3` (T-2091) and `5c37422e4` (T-2086, a server comment cleanup). The gate's comment step diffs `main` against the worktree (two-dot), so main's own comment deletions appear as 456 "added" `T-####` lines; none of those files are in my diff (`git diff --name-only main...HEAD` contains only Allowed files) and my own added comments contain no task IDs. `git merge`/`rebase`/branch switching are blocked in this environment, so I could not bring the branch onto current `main`. The same gate run at the branch point passes every step. The lead's merge, which rebases onto `main`, should therefore be green.
- **Line counts (product files only, `apps/` + `packages/`, vs `823b2f10d`): 204 added, 737 deleted, net −533**, so the "at least 300 lower" acceptance holds. `lib/api.ts` 329 → 50, `AppRoutes.tsx` 354 → 229, and the 14 shims (84 lines) are gone.
- `export *` also re-exports a handful of names the old lists left out (e.g. `removeContact`, `deleteGroup`, `stopAiTurn`). That is the spec's intent, but it is a small widening of `@/lib/api`'s public surface.
- I did not run the browser/lead check. `/`, `/c/<chat>`, `/settings` and `/settings/ais` signed in, and a signed-out `/settings` → `/login`, still need the web mock smoke. The nesting is the standard pathless layout route; the route paths and order are unchanged.
- Nothing else is blocked; no open questions.

## Review (written by Claude)

Approved; the pre-review was clean (1 nit).
- **Size.** −533 across 146 files:
  - `lib/api.ts` 288 lines → `export *`;
  - `AppRoutes` −125, with one `RequireAuth` layout route;
  - the 14 shims deleted.
- **Lead Playwright check, web mock** (`:5232`): `/`, `/c/ana@zilar.test`, `/settings` and `/settings/ais` render signed in, with no page errors.
- **Signed out.** With every `/api/*` call answered 401, `/settings`, `/settings/ais` and `/c/ana@zilar.test` all land on `/login`. That is identical to main (`:5233`), checked side by side.
