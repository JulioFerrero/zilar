---
id: T-2077
title: "Cut comments (phone components outside chat and AIs, and phone auth): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2077-comments-phone-components-rest
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2077: Comment cut — phone components outside chat and AIs, and phone auth

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **1844 comment lines in 155 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

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
3. The target is to remove at least **922** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `apps/mobile/src/auth/AuthCard.tsx`
- `apps/mobile/src/auth/AuthFlow.tsx`
- `apps/mobile/src/auth/InviteCodeField.tsx`
- `apps/mobile/src/auth/NameForm.tsx`
- `apps/mobile/src/auth/OtpInput.tsx`
- `apps/mobile/src/auth/RequireAuth.tsx`
- `apps/mobile/src/auth/errors.ts`
- `apps/mobile/src/auth/guard.ts`
- `apps/mobile/src/auth/otp.ts`
- `apps/mobile/src/auth/secure-session-storage.ts`
- `apps/mobile/src/auth/session-storage.ts`
- `apps/mobile/src/auth/session-store.ts`
- `apps/mobile/src/auth/session.ts`
- `apps/mobile/src/components/approvals/always-allowed-row.tsx`
- `apps/mobile/src/components/approvals/approval-row.tsx`
- `apps/mobile/src/components/approvals/pending-tab.tsx`
- `apps/mobile/src/components/approvals/rows.ts`
- `apps/mobile/src/components/approvals/use-approvals.ts`
- `apps/mobile/src/components/channel-info/content-page.tsx`
- `apps/mobile/src/components/channel-info/more-menu.tsx`
- `apps/mobile/src/components/channel-info/people-page.tsx`
- `apps/mobile/src/components/channel-info/root-page.tsx`
- `apps/mobile/src/components/channel-info/settings-page.tsx`
- `apps/mobile/src/components/client-version-banner.tsx`
- `apps/mobile/src/components/connections/add-key-sheet.tsx`
- `apps/mobile/src/components/connections/connection-card.tsx`
- `apps/mobile/src/components/connections/connection-sheet.tsx`
- `apps/mobile/src/components/connections/connections-header.tsx`
- `apps/mobile/src/components/connections/errors.ts`
- `apps/mobile/src/components/connections/use-connections-api.ts`
- `apps/mobile/src/components/connections/use-connections.ts`
- `apps/mobile/src/components/connections/use-key-check.ts`
- `apps/mobile/src/components/contacts/add-contact.ts`
- `apps/mobile/src/components/contacts/blocks.ts`
- `apps/mobile/src/components/contacts/contact-chip.tsx`
- `apps/mobile/src/components/contacts/contact-list.tsx`
- `apps/mobile/src/components/contacts/contact-presence.ts`
- `apps/mobile/src/components/contacts/contact-row.tsx`
- `apps/mobile/src/components/contacts/contacts.ts`
- `apps/mobile/src/components/contacts/people-list-section.tsx`
- `apps/mobile/src/components/contacts/people-search-result.tsx`
- `apps/mobile/src/components/contacts/people-search.ts`
- `apps/mobile/src/components/contacts/person-row.tsx`
- `apps/mobile/src/components/contacts/profile-card.tsx`
- `apps/mobile/src/components/contacts/requests.ts`
- `apps/mobile/src/components/contacts/use-contacts-api.ts`
- `apps/mobile/src/components/contacts/use-people-prefix-search.ts`
- `apps/mobile/src/components/contacts/use-people-search.ts`
- `apps/mobile/src/components/directory/explore-helpers.ts`
- `apps/mobile/src/components/directory/handle-helpers.ts`
- `apps/mobile/src/components/directory/use-directory-api.ts`
- `apps/mobile/src/components/group-info/activity-page.tsx`
- `apps/mobile/src/components/group-info/ais-list.tsx`
- `apps/mobile/src/components/group-info/allowed-page.tsx`
- `apps/mobile/src/components/group-info/avatar-stack.tsx`
- `apps/mobile/src/components/group-info/group-info-pages.tsx`
- `apps/mobile/src/components/group-info/info-keys.tsx`
- `apps/mobile/src/components/group-info/info-row.tsx`
- `apps/mobile/src/components/group-info/members-list.tsx`
- `apps/mobile/src/components/group-info/members-page.tsx`
- `apps/mobile/src/components/group-info/root-page.tsx`
- `apps/mobile/src/components/group-info/settings-page.tsx`
- `apps/mobile/src/components/group-info/tools-page.tsx`
- `apps/mobile/src/components/group-info/topics-section.tsx`
- `apps/mobile/src/components/group-info/use-group-picture.ts`
- `apps/mobile/src/components/group/new-group-members.tsx`
- `apps/mobile/src/components/group/new-group-name.tsx`
- `apps/mobile/src/components/integrations/card-save.ts`
- `apps/mobile/src/components/integrations/errors.ts`
- `apps/mobile/src/components/integrations/use-card-actions.ts`
- `apps/mobile/src/components/integrations/use-integrations-api.ts`
- `apps/mobile/src/components/machines/add-machine-sheet.tsx`
- `apps/mobile/src/components/machines/approved-machines.tsx`
- `apps/mobile/src/components/machines/errors.ts`
- `apps/mobile/src/components/machines/machine-card.tsx`
- `apps/mobile/src/components/machines/machine-change.ts`
- `apps/mobile/src/components/machines/machine-row.tsx`
- `apps/mobile/src/components/machines/machine-sheet.tsx`
- `apps/mobile/src/components/machines/machines-header.tsx`
- `apps/mobile/src/components/machines/mutations.ts`
- `apps/mobile/src/components/machines/pending-machines.tsx`
- `apps/mobile/src/components/machines/revoked-machines.tsx`
- `apps/mobile/src/components/machines/use-machines-api.ts`
- `apps/mobile/src/components/machines/use-machines-list.ts`
- `apps/mobile/src/components/nav/floating-tab-bar.tsx`
- `apps/mobile/src/components/profile/profile-actions.tsx`
- `apps/mobile/src/components/profile/profile-block.tsx`
- `apps/mobile/src/components/profile/profile-header.tsx`
- `apps/mobile/src/components/profile/profile-info.tsx`
- `apps/mobile/src/components/profile/profile-media.tsx`
- `apps/mobile/src/components/profile/profile-person.ts`
- `apps/mobile/src/components/profile/profile-view.tsx`
- `apps/mobile/src/components/profile/use-profile-dm.ts`
- `apps/mobile/src/components/routines/routine-row.tsx`
- `apps/mobile/src/components/settings/app-version-row.tsx`
- `apps/mobile/src/components/settings/avatar-control.tsx`
- `apps/mobile/src/components/settings/avatar-native.ts`
- `apps/mobile/src/components/settings/bio-field.tsx`
- `apps/mobile/src/components/settings/folders.ts`
- `apps/mobile/src/components/settings/handle-field.tsx`
- `apps/mobile/src/components/settings/hub.ts`
- `apps/mobile/src/components/settings/name-field.tsx`
- `apps/mobile/src/components/settings/profile-logic.ts`
- `apps/mobile/src/components/settings/push-diagnostics.tsx`
- `apps/mobile/src/components/settings/refresh-scroll.tsx`
- `apps/mobile/src/components/settings/screen-shell.tsx`
- `apps/mobile/src/components/settings/use-focus-list.ts`
- `apps/mobile/src/components/settings/use-handle-check.ts`
- `apps/mobile/src/components/settings/use-profile-api.ts`
- `apps/mobile/src/components/settings/use-profile-avatar.ts`
- `apps/mobile/src/components/settings/use-profile-settings.ts`
- `apps/mobile/src/components/stickers/discover-tab.tsx`
- `apps/mobile/src/components/stickers/favorites-tab.tsx`
- `apps/mobile/src/components/stickers/order.ts`
- `apps/mobile/src/components/stickers/pack-actions.tsx`
- `apps/mobile/src/components/stickers/pack-card.tsx`
- `apps/mobile/src/components/stickers/pack-editor.ts`
- `apps/mobile/src/components/stickers/pack-grid.tsx`
- `apps/mobile/src/components/stickers/pack-sheet.tsx`
- `apps/mobile/src/components/stickers/pack-tile-sheet.tsx`
- `apps/mobile/src/components/stickers/pack-visibility-field.tsx`
- `apps/mobile/src/components/stickers/packs-tab.tsx`
- `apps/mobile/src/components/stickers/require-stickers-auth.tsx`
- `apps/mobile/src/components/stickers/sticker-native.ts`
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`
- `apps/mobile/src/components/stickers/telegram-import.ts`
- `apps/mobile/src/components/stickers/tile-size.ts`
- `apps/mobile/src/components/stickers/use-pack-editor.ts`
- `apps/mobile/src/components/stickers/use-pack-items.ts`
- `apps/mobile/src/components/stickers/use-stickers-api.ts`
- `apps/mobile/src/components/stickers/use-stickers-panel.ts`
- `apps/mobile/src/components/ui/action-sheet.tsx`
- `apps/mobile/src/components/ui/action-tiles.tsx`
- `apps/mobile/src/components/ui/bottom-sheet.tsx`
- `apps/mobile/src/components/ui/button.tsx`
- `apps/mobile/src/components/ui/card.tsx`
- `apps/mobile/src/components/ui/checkbox.tsx`
- `apps/mobile/src/components/ui/confirm-dialog.tsx`
- `apps/mobile/src/components/ui/count-badge.tsx`
- `apps/mobile/src/components/ui/icon-button.tsx`
- `apps/mobile/src/components/ui/icon-tile.tsx`
- `apps/mobile/src/components/ui/list-row.tsx`
- `apps/mobile/src/components/ui/screen-header.tsx`
- `apps/mobile/src/components/ui/search-field.tsx`
- `apps/mobile/src/components/ui/segmented-control.tsx`
- `apps/mobile/src/components/ui/select-sheet.tsx`
- `apps/mobile/src/components/ui/sheet-queue.ts`
- `apps/mobile/src/components/ui/state-message.tsx`
- `apps/mobile/src/components/ui/step-track.tsx`
- `apps/mobile/src/components/ui/switch.tsx`
- `apps/mobile/src/components/ui/text-field.tsx`
- `apps/mobile/src/components/ui/text.tsx`
- `apps/mobile/src/components/ui/toast.tsx`
- `apps/mobile/src/components/ui/use-key-press.ts`
- `apps/mobile/src/components/update/update-dialog.tsx`
- `work/T-2077-comments-phone-components-rest.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 922 lines are removed.

---

## Report (written by the worker when done)

### What I did

Cut comments only in all 155 files listed under Allowed files (auth, approvals, channel info, connections, contacts, directory, group info, group flow, integrations, machines, nav, profile, routines, settings, stickers, ui, update). Deleted task IDs and history, narration that restated the code, duplicated JSDoc parameter text, stale references, banners and commented-out text; shortened multi-line WHY blocks and removed the blank line that a removed block left doubled. Kept only security/permission/money/privacy notes, protocol and data invariants, platform/library workarounds, units and limits, and tool directives (`effect-plain:`, `eslint-disable`, JSDoc that carries a why). No code, string, import, type or real formatting change was made.

I verified "comments only" mechanically: a temporary script (outside the repo) removed every comment-only and blank line from both `main` and the working tree for all changed source files and compared the result. Output: `code identical`.

### Checks run

- `pnpm gate` (repo root), second run after the fixes below:
  - `PASS  install (frozen)  (2.1s)`
  - `PASS  format  (3.6s)`
  - `PASS  lint  (2.4s)`
  - `PASS  typecheck  (5.0s)`
  - `PASS  effect  (6.5s)`
  - `PASS  tests @zilar/mobile  (7.5s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- The first gate run failed on `format`: one shortened JSDoc had left a stray `*/` in `integrations/card-save.ts`, and several files had a doubled blank line left by removed blocks. I removed the stray line and ran `pnpm exec prettier --write` on the changed files only (it changed blank lines only; the code-identity check still said `code identical`). The final gate run above is green.
- I ran no test file on its own; the only tests run are the `tests @zilar/mobile` step inside `pnpm gate`.
- `git diff main...HEAD --shortstat -- apps/mobile/src` (code diff, after the final comment edit): `155 files changed, 359 insertions(+), 1563 deletions(-)`. Target was 922 removed lines. `main` moved while I worked (the lead merged another task), so the number against the current `main` is the one above.

### Kept comments longer than 3 lines

All are why-comments (reason in a few words):

- `apps/mobile/src/auth/guard.ts:6-9` — offline status never signs out
- `apps/mobile/src/auth/session-storage.ts:7-11` — profile beside token for offline start
- `apps/mobile/src/auth/session-store.ts:84-88` — backoff limits, only 401 signs out
- `apps/mobile/src/components/approvals/always-allowed-row.tsx:63-66` — app has no Alert, Modals instead
- `apps/mobile/src/components/approvals/approval-row.tsx:74-77` — kit IconButton is dark-only
- `apps/mobile/src/components/approvals/rows.ts:66-70` — one AI failure must not blank others
- `apps/mobile/src/components/approvals/rows.ts:99-104` — 404/409 decision semantics, fixed text
- `apps/mobile/src/components/approvals/rows.ts:132-135` — second-tap guard
- `apps/mobile/src/components/approvals/rows.ts:144-147` — 404 means already gone
- `apps/mobile/src/components/client-version-banner.tsx:7-11` — bar pushes content, never blocks
- `apps/mobile/src/components/connections/connection-card.tsx:10-13` — server stores validated https URL
- `apps/mobile/src/components/connections/use-key-check.ts:46-51` — key only travels in checkKey, abandon rule
- `apps/mobile/src/components/contacts/add-contact.ts:10-13` — UI-free so tests skip react-native
- `apps/mobile/src/components/contacts/add-contact.ts:69-73` — refresh must stay in the same chain
- `apps/mobile/src/components/contacts/add-contact.ts:109-113` — loaded chat or matching JID only
- `apps/mobile/src/components/contacts/blocks.ts:5-9` — fixed sentences, never server text
- `apps/mobile/src/components/contacts/contact-presence.ts:5-9` — presence source of truth
- `apps/mobile/src/components/contacts/contact-presence.ts:31-34` — case-insensitive sort rule
- `apps/mobile/src/components/contacts/contacts.ts:4-7` — fixed sentences, never server text
- `apps/mobile/src/components/contacts/profile-card.tsx:3-7` — reset confirm on relation change
- `apps/mobile/src/components/contacts/requests.ts:4-7` — UI-free so tests skip react-native
- `apps/mobile/src/components/directory/explore-helpers.ts:3-7` — no raw server text, outage wording
- `apps/mobile/src/components/directory/handle-helpers.ts:4-9` — pure for Node tests, 404 neutrality
- `apps/mobile/src/components/directory/handle-helpers.ts:37-42` — land on join id, never stale list
- `apps/mobile/src/components/group-info/allowed-page.tsx:22-26` — one request feeds count and page
- `apps/mobile/src/components/group-info/group-info-pages.tsx:23-27` — media/pins scroll to the message
- `apps/mobile/src/components/group-info/use-group-picture.ts:39-43` — onChanged repaints header via list
- `apps/mobile/src/components/integrations/card-save.ts:13-18` — write-only key, saved needs reload
- `apps/mobile/src/components/integrations/card-save.ts:32-36` — write-only key, default model
- `apps/mobile/src/components/integrations/card-save.ts:73-77` — dialog closes only after reload proves remove
- `apps/mobile/src/components/integrations/errors.ts:3-7` — fixed sentences, never raw
- `apps/mobile/src/components/integrations/use-card-actions.ts:23-28` — secret clears on save success even if reload fails
- `apps/mobile/src/components/integrations/use-card-actions.ts:88-92` — remove dialog waits for reload
- `apps/mobile/src/components/machines/add-machine-sheet.tsx:16-20` — runner unpublished, parent mints code
- `apps/mobile/src/components/machines/machine-change.ts:11-15` — server source of truth, restore on failure
- `apps/mobile/src/components/machines/machine-row.tsx:11-14` — null list groups nothing
- `apps/mobile/src/components/machines/mutations.ts:19-22` — fixed sentences, never raw
- `apps/mobile/src/components/nav/floating-tab-bar.tsx:16-20` — scroll clearance and inset units
- `apps/mobile/src/components/nav/floating-tab-bar.tsx:46-50` — gradient key workaround
- `apps/mobile/src/components/nav/floating-tab-bar.tsx:99-103` — TabList of headless Tabs, hide on keyboard
- `apps/mobile/src/components/profile/profile-block.tsx:19-23` — stale confirm reset rule
- `apps/mobile/src/components/profile/profile-person.ts:3-7` — widened contract to read bio
- `apps/mobile/src/components/profile/profile-view.tsx:39-43` — hook-free for Vitest
- `apps/mobile/src/components/profile/use-profile-dm.ts:11-14` — Effect adapter keeps the error class
- `apps/mobile/src/components/settings/avatar-native.ts:9-12` — native seams for tests
- `apps/mobile/src/components/settings/avatar-native.ts:30-34` — server PNG/WebP vs phone JPEG crop
- `apps/mobile/src/components/settings/avatar-native.ts:124-128` — early returns vs rejections
- `apps/mobile/src/components/settings/avatar-native.ts:264-269` — error mapping priority
- `apps/mobile/src/components/settings/folders.ts:10-14` — pure for tests
- `apps/mobile/src/components/settings/folders.ts:68-71` — chat lists omitted on purpose
- `apps/mobile/src/components/settings/hub.ts:8-11` — pure for tests
- `apps/mobile/src/components/settings/hub.ts:39-43` — hidden rows vs shared registry
- `apps/mobile/src/components/settings/profile-logic.ts:1-5` — pure logic for tests
- `apps/mobile/src/components/settings/profile-logic.ts:117-122` — bearer same-origin only
- `apps/mobile/src/components/settings/screen-shell.tsx:15-19` — spinner stop rules
- `apps/mobile/src/components/settings/use-focus-list.ts:19-23` — failed refresh keeps rows
- `apps/mobile/src/components/settings/use-handle-check.ts:22-26` — own handle skips the check
- `apps/mobile/src/components/settings/use-profile-api.ts:17-20` — Metro folds the literal condition
- `apps/mobile/src/components/settings/use-profile-api.ts:28-31` — native uploader unusable in mock
- `apps/mobile/src/components/settings/use-profile-settings.ts:28-31` — fixed failure sentence
- `apps/mobile/src/components/settings/use-profile-settings.ts:95-98` — focus return keeps unsaved edits
- `apps/mobile/src/components/settings/use-profile-settings.ts:177-181` — save order, bio carries the name
- `apps/mobile/src/components/stickers/order.ts:1-4` — pure for tests
- `apps/mobile/src/components/stickers/pack-editor.ts:4-7` — dependency-free for tests
- `apps/mobile/src/components/stickers/pack-editor.ts:51-54` — pack-full is a row error
- `apps/mobile/src/components/stickers/pack-editor.ts:73-76` — row codes are not form errors
- `apps/mobile/src/components/stickers/pack-editor.ts:93-96` — gone/not-own fixed sentences
- `apps/mobile/src/components/stickers/pack-editor.ts:188-191` — delete result drives the modal
- `apps/mobile/src/components/stickers/pack-editor.ts:207-210` — edit/retry order
- `apps/mobile/src/components/stickers/pack-editor.ts:242-246` — save order, only pack/patch is a form error
- `apps/mobile/src/components/stickers/pack-grid.tsx:15-19` — zero dimensions mark a moving file
- `apps/mobile/src/components/stickers/require-stickers-auth.tsx:7-10` — mock mode needs no auth
- `apps/mobile/src/components/stickers/sticker-native.ts:13-16` — native seams for tests
- `apps/mobile/src/components/stickers/sticker-native.ts:132-135` — video wins over bytes, still fallback
- `apps/mobile/src/components/stickers/sticker-native.ts:148-152` — raw caps 4 MiB / 512 KiB
- `apps/mobile/src/components/stickers/sticker-native.ts:269-273` — preparer fit/quality/PNG steps
- `apps/mobile/src/components/stickers/telegram-import.ts:3-6` — pure mapping and copy
- `apps/mobile/src/components/stickers/use-stickers-api.ts:12-16` — native upload vs mock backend
- `apps/mobile/src/components/stickers/use-stickers-api.ts:30-33` — Metro folds the literal condition
- `apps/mobile/src/components/ui/action-sheet.tsx:15-19` — present follow-up only after dismissal
- `apps/mobile/src/components/ui/action-sheet.tsx:28-32` — platform sheet, dismiss semantics, grabber
- `apps/mobile/src/components/ui/bottom-sheet.tsx:22-25` — dismissible false during actions
- `apps/mobile/src/components/ui/bottom-sheet.tsx:40-46` — auto detent vs scrollable, grabber
- `apps/mobile/src/components/ui/segmented-control.tsx:26-30` — key re-raises the selected style
- `apps/mobile/src/components/ui/step-track.tsx:22-26` — key re-raises the segment
- `apps/mobile/src/components/ui/switch.tsx:15-18` — grey track/light thumb contrast
- `apps/mobile/src/components/ui/use-key-press.ts:4-8` — NativeWind drops function `style`

### Notes for the lead

- Changed files: 155 source files (all in Allowed files) plus this task file. `ui/use-key-press.ts` was the only allowed file whose comment was already a single real why; it is shortened to two content lines instead of left untouched.
- No tests were added; the task says none, and no behaviour changed.
- The kept long blocks are mostly the protocol/platform invariants the spec asks to keep (sheet dismissal races, mock-mode Metro folding, the PNG/WebP re-encode, write-only integration keys, offline session rules). The longest remaining block is 6 lines (`apps/mobile/src/components/ui/bottom-sheet.tsx:40-46`).


## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +359 -1563 net -1204; non-comment changed lines: 0. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
