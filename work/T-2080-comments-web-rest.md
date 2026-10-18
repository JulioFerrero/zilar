---
id: T-2080
title: "Cut comments (web lib, store, routes, auth): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2080-comments-web-rest
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2080: Comment cut — web lib, store, routes, auth

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **2279 comment lines in 136 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

### Rules
Read `docs/COMMENTS.md` first and follow it exactly. In short:
- **Keep only WHY comments:**
  - security, permission, money and privacy notes;
  - protocol and data invariants;
  - platform and library workarounds, with the bug they work around;
  - units and limits;
  - tool directives (`eslint-disable…`, `@ts-expect-error`, `// effect-plain:`, `/// <reference>`).
- **Delete:**
  - task IDs and history ("T-1234", "moved unchanged", "size split", "replaces the old…", "during the transition");
  - narration that restates the code or the name;
  - JSDoc that repeats the parameters;
  - references to things that no longer exist;
  - commented-out code and banners.
- **Shorten** a multi-line block with one real "why" to one or two lines.

### Steps
1. Go through EVERY file in Allowed files; each has comments. Edit comments only.
2. Change NO code, string, import, type or formatting. The only allowed changes are:
   - removed or shortened comment lines;
   - removing a blank line left doubled by a removed block.
3. The target is to remove at least **1139** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `apps/web/src/App.tsx`
- `apps/web/src/auth/AuthProvider.tsx`
- `apps/web/src/cosmos.decorator.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/api/agent-tasks.ts`
- `apps/web/src/lib/api/ais.ts`
- `apps/web/src/lib/api/blocks.ts`
- `apps/web/src/lib/api/chats.ts`
- `apps/web/src/lib/api/devices.ts`
- `apps/web/src/lib/api/groups.ts`
- `apps/web/src/lib/api/http.ts`
- `apps/web/src/lib/api/machines.ts`
- `apps/web/src/lib/api/media.ts`
- `apps/web/src/lib/api/people.ts`
- `apps/web/src/lib/api/sessionGone.ts`
- `apps/web/src/lib/api/settings.ts`
- `apps/web/src/lib/api/stickers.ts`
- `apps/web/src/lib/api/topics.ts`
- `apps/web/src/lib/attachments.ts`
- `apps/web/src/lib/auth.ts`
- `apps/web/src/lib/avatar-crop.ts`
- `apps/web/src/lib/background-image.ts`
- `apps/web/src/lib/blockedJids.ts`
- `apps/web/src/lib/chatBackground.ts`
- `apps/web/src/lib/chatPrefs.ts`
- `apps/web/src/lib/clipboard.ts`
- `apps/web/src/lib/composer-drafts.ts`
- `apps/web/src/lib/contacts.ts`
- `apps/web/src/lib/drafts.ts`
- `apps/web/src/lib/effect/api-client.ts`
- `apps/web/src/lib/effect/runtime.ts`
- `apps/web/src/lib/effect/use-action.ts`
- `apps/web/src/lib/effect/use-query.ts`
- `apps/web/src/lib/emojiRecents.ts`
- `apps/web/src/lib/errors.ts`
- `apps/web/src/lib/foreground.ts`
- `apps/web/src/lib/format-duration.ts`
- `apps/web/src/lib/handleGate.ts`
- `apps/web/src/lib/handles.ts`
- `apps/web/src/lib/media-retry.ts`
- `apps/web/src/lib/open-file.ts`
- `apps/web/src/lib/push.ts`
- `apps/web/src/lib/push/badge.ts`
- `apps/web/src/lib/push/deviceStorage.ts`
- `apps/web/src/lib/push/inTab.ts`
- `apps/web/src/lib/push/pageActions.ts`
- `apps/web/src/lib/push/sessionEnable.ts`
- `apps/web/src/lib/push/usePushEnable.ts`
- `apps/web/src/lib/routines.ts`
- `apps/web/src/lib/scrollToMessage.ts`
- `apps/web/src/lib/sticker-images.ts`
- `apps/web/src/lib/sticker-motion.ts`
- `apps/web/src/lib/stickers.ts`
- `apps/web/src/lib/tools.ts`
- `apps/web/src/lib/topicsUi.ts`
- `apps/web/src/lib/useApprovalPolling.ts`
- `apps/web/src/lib/useChatFolders.ts`
- `apps/web/src/lib/useClientVersionCheck.ts`
- `apps/web/src/lib/useContactRequestCount.ts`
- `apps/web/src/lib/useContactRequests.ts`
- `apps/web/src/lib/useIsServerOwner.ts`
- `apps/web/src/lib/useMediaQuery.ts`
- `apps/web/src/lib/useMessageSearch.ts`
- `apps/web/src/lib/usePendingApprovalCount.ts`
- `apps/web/src/lib/usePeopleSearch.ts`
- `apps/web/src/lib/useSmoothText.ts`
- `apps/web/src/lib/useVoiceTranscription.ts`
- `apps/web/src/lib/voice.ts`
- `apps/web/src/lib/voice/convert.ts`
- `apps/web/src/lib/voice/recorder.ts`
- `apps/web/src/lib/voice/sample.ts`
- `apps/web/src/lib/voice/waveform.ts`
- `apps/web/src/routes/AddContactRoute.tsx`
- `apps/web/src/routes/AisPage.tsx`
- `apps/web/src/routes/AppRoutes.tsx`
- `apps/web/src/routes/ApprovalsPage.tsx`
- `apps/web/src/routes/BlockedPage.tsx`
- `apps/web/src/routes/ChatShell.tsx`
- `apps/web/src/routes/ChatView.tsx`
- `apps/web/src/routes/ConnectionsPage.tsx`
- `apps/web/src/routes/ContactsPage.tsx`
- `apps/web/src/routes/DevicesPage.tsx`
- `apps/web/src/routes/ExploreRoute.tsx`
- `apps/web/src/routes/FoldersPage.tsx`
- `apps/web/src/routes/GroupHandleRoute.tsx`
- `apps/web/src/routes/HandlePage.tsx`
- `apps/web/src/routes/IntegrationsPage.tsx`
- `apps/web/src/routes/InvitePage.tsx`
- `apps/web/src/routes/JoinPage.tsx`
- `apps/web/src/routes/LoginPage.tsx`
- `apps/web/src/routes/MachinesPage.tsx`
- `apps/web/src/routes/NamePage.tsx`
- `apps/web/src/routes/NotificationsPage.tsx`
- `apps/web/src/routes/ProfilePage.tsx`
- `apps/web/src/routes/RequestsPage.tsx`
- `apps/web/src/routes/RoutinesPage.tsx`
- `apps/web/src/routes/SettingsHubPage.tsx`
- `apps/web/src/routes/SetupPage.tsx`
- `apps/web/src/routes/StickerPackPage.tsx`
- `apps/web/src/routes/StickersPage.tsx`
- `apps/web/src/store/ChatStoreProvider.tsx`
- `apps/web/src/store/chatGroups.ts`
- `apps/web/src/store/chatListCache.ts`
- `apps/web/src/store/effects/badge.ts`
- `apps/web/src/store/effects/chatActions.ts`
- `apps/web/src/store/effects/chatRows.ts`
- `apps/web/src/store/effects/constants.ts`
- `apps/web/src/store/effects/ctx.ts`
- `apps/web/src/store/effects/groupActions.ts`
- `apps/web/src/store/effects/groupCreate.ts`
- `apps/web/src/store/effects/groupMembers.ts`
- `apps/web/src/store/effects/groupSettings.ts`
- `apps/web/src/store/effects/groupShared.ts`
- `apps/web/src/store/effects/groups.ts`
- `apps/web/src/store/effects/history.ts`
- `apps/web/src/store/effects/lifecycle.ts`
- `apps/web/src/store/effects/locals.ts`
- `apps/web/src/store/effects/pins.ts`
- `apps/web/src/store/effects/polling.ts`
- `apps/web/src/store/effects/portAdapters.ts`
- `apps/web/src/store/effects/portTypes.ts`
- `apps/web/src/store/effects/ports.ts`
- `apps/web/src/store/effects/prefs.ts`
- `apps/web/src/store/effects/reads.ts`
- `apps/web/src/store/effects/runtime.ts`
- `apps/web/src/store/effects/send.ts`
- `apps/web/src/store/effects/sendFailure.ts`
- `apps/web/src/store/effects/storeContext.ts`
- `apps/web/src/store/effects/topics.ts`
- `apps/web/src/store/effects/util.ts`
- `apps/web/src/store/groupStoreTypes.ts`
- `apps/web/src/store/messageCache.ts`
- `apps/web/src/store/realStore.ts`
- `apps/web/src/store/selectors.ts`
- `apps/web/src/store/store.ts`
- `apps/web/src/store/storeOptions.ts`
- `work/T-2080-comments-web-rest.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 1139 lines are removed.

---

## Report (written by the worker when done)

### What I did
- Went through every one of the 136 Allowed files and cut comments per `docs/COMMENTS.md`: kept only WHY (security/privacy, protocol and data invariants, platform workarounds, units and limits, tool directives), removed task IDs, history, narration, parameter-restating JSDoc and banners, and shortened long blocks to 1–3 lines.
- Comment lines in the group: 2284 before, 916 after (−1368). Net line removal (including blank lines left doubled by removed blocks): 1379, above the 1139 target.
- Changed no code, string, import, type or formatting: verified mechanically that for every file the sequence of non-comment, non-blank lines is byte-identical to `HEAD`, that every added line in the diff is a comment line, and that every removed line is a comment or a blank line next to one.
- Kept every tool directive (`effect-plain`, eslint/ts directives, `/// <reference>`); restored the `effect-plain` line in `store/chatListCache.ts` after the effect ratchet flagged the file.
- No tests added (the spec says no tests).

### Checks run
`pnpm gate` from the repo root:
```
PASS  install (frozen)  (2.2s)
PASS  format  (2.4s)
PASS  lint  (1.0s)
PASS  typecheck  (4.4s)
PASS  effect  (5.0s)
SKIP build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/web  (13.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
I ran the gate twice (the second time after amending only this report text); both runs ended with `GATE PASS`.
- No individual test files were run; the gate ran the `@zilar/web` tests.
- During the work I ran `pnpm exec prettier --check` on the changed files and `--write` on the 15 it flagged (it removed blank lines left doubled by removed comment blocks); after that I re-verified that the code lines were still identical.

Numbers for this change:
- `git show --shortstat HEAD -- apps`: `131 files changed, 759 insertions(+), 2138 deletions(-)` (net 1379 removed); the whole commit is `132 files changed, 795 insertions(+), 2139 deletions(-)`.
- `git diff main...HEAD --shortstat`: `132 files changed, 996 insertions(+), 2138 deletions(-)` when written (includes the spec and this task file; `main` moves as other tasks merge, so the commit's own stat above is the stable figure).

### Kept comments longer than 3 lines
- `apps/web/src/lib/open-file.ts:7-10` — the PDF viewer is client-side only; forcing `application/pdf` on another type would mask an active HTML/SVG file (security).
- `apps/web/src/routes/JoinPage.tsx:40-43` — join-by-link flow: the inline name gate avoids a blank member row and keeps the token on the page.
- `apps/web/src/store/chatGroups.ts:20-23` — sidebar fold, sort and pin order, easy to break when "simplifying".

### Notes for the lead
- Six empty `catch` blocks (AuthProvider ×2, chatListCache ×2, messageCache ×2) lost their only comment; prettier then collapsed `} catch {` to `} catch {}`, which is a code change. I kept a one-line WHY in each (`Best effort only.` / `Storage failures must never break messaging.`) so the code lines stay untouched; the original pairs of comments were merged into one per file.
- Five Allowed files kept all their comments and are unchanged: `cosmos.decorator.tsx`, `lib/composer-drafts.ts`, `routes/AisPage.tsx`, `routes/ConnectionsPage.tsx`, `store/effects/util.ts`.
- I removed the `(T-xxxx)` suffixes from the few comments I kept; no task ID remains in these files (checked with grep).

## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +759 -2138 net -1379; non-comment changed lines: 0. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
