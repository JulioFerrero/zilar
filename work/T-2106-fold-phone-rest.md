---
id: T-2106
title: "Fold 86 small single-use files into the one file that imports each (phone, other folders): the code moves into its importer, duplicate imports merge, the small file goes — no behaviour change"
status: merged
milestone: M5
branch: task/T-2106-fold-phone-rest
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2106: Fold single-use files (phone, other folders)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down. A file over 400 lines is fine when it saves lines; never split only for the number, and only a file over 800 lines must split.

The 10-10 split rule left many small files with exactly one importer. Each one repeats an import block, an export line and the importer's import line.

### Facts (the lead's import graph, 2026-10-18 at `e42276bc7`)
Each row below is `small file (lines) → its only production importer (lines)`. The lead resolved every relative and `@/` import, including dynamic `import()`. The 86 files total 5191 lines, 423 of them import lines.

- `apps/mobile/src/components/ais/limits.ts` (8) → `apps/mobile/src/app/ais/[id].tsx` (368)
- `apps/mobile/src/components/contacts/use-people-prefix-search.ts` (12) → `apps/mobile/src/components/contacts/people-list-section.tsx` (49)
- `apps/mobile/src/components/contacts/profile-card.tsx` (13) → `apps/mobile/src/components/profile/profile-block.tsx` (100)
- `apps/mobile/src/lib/use-client-version.ts` (14) → `apps/mobile/src/components/client-version-banner.tsx` (30)
- `apps/mobile/src/components/integrations/use-integrations-api.ts` (19) → `apps/mobile/src/app/settings/integrations.tsx` (135)
- `apps/mobile/src/lib/use-contact-requests.ts` (20) → `apps/mobile/src/components/chat/request-rows.tsx` (252)
- `apps/mobile/src/components/stickers/order.ts` (20) → `apps/mobile/src/components/stickers/use-stickers-panel.ts` (309)
- `apps/mobile/src/lib/agent-tasks-api.ts` (23) → `apps/mobile/src/components/chat/steps-sheet.tsx` (232)
- `apps/mobile/src/components/contacts/contact-chip.tsx` (26) → `apps/mobile/src/components/group/new-group-members.tsx` (123)
- `apps/mobile/src/auth/errors.ts` (26) → `apps/mobile/src/auth/AuthFlow.tsx` (237)
- `apps/mobile/src/auth/InviteCodeField.tsx` (26) → `apps/mobile/src/auth/AuthFlow.tsx` (237)
- `apps/mobile/src/components/profile/profile-header.tsx` (26) → `apps/mobile/src/app/u/[handle].tsx` (308)
- `apps/mobile/src/components/channel-info/settings-page.tsx` (27) → `apps/mobile/src/components/chat/channel-screen.tsx` (303)
- `apps/mobile/src/store/effects/push-pair.ts` (28) → `apps/mobile/src/store/real-store.ts` (351)
- `apps/mobile/src/components/integrations/errors.ts` (30) → `apps/mobile/src/components/integrations/card-save.ts` (143)
- `apps/mobile/src/components/client-version-banner.tsx` (30) → `apps/mobile/src/app/_layout.tsx` (167)
- `apps/mobile/src/components/machines/machines-header.tsx` (30) → `apps/mobile/src/app/settings/machines.tsx` (195)
- `apps/mobile/src/components/connections/errors.ts` (30) → `apps/mobile/src/components/connections/use-connections.ts` (240)
- `apps/mobile/src/components/connections/connections-header.tsx` (30) → `apps/mobile/src/app/settings/connections.tsx` (241)
- `apps/mobile/src/store/send-types.ts` (32) → `apps/mobile/src/store/types.ts` (139)
- `apps/mobile/src/components/channel-info/content-page.tsx` (32) → `apps/mobile/src/components/channel-info/root-page.tsx` (187)
- `apps/mobile/src/components/ais/delete-confirm.tsx` (32) → `apps/mobile/src/app/(tabs)/ais.tsx` (310)
- `apps/mobile/src/components/settings/name-field.tsx` (33) → `apps/mobile/src/app/settings/profile.tsx` (114)
- `apps/mobile/src/store/effects/group-settings-actions.ts` (35) → `apps/mobile/src/store/effects/groups.ts` (280)
- `apps/mobile/src/lib/person-link.ts` (37) → `apps/mobile/src/components/chat/person-pressable.tsx` (49)
- `apps/mobile/src/components/machines/machine-card.tsx` (39) → `apps/mobile/src/components/machines/revoked-machines.tsx` (45)
- `apps/mobile/src/lib/theme.ts` (39) → `apps/mobile/src/app/_layout.tsx` (167)
- `apps/mobile/src/components/stickers/pack-visibility-field.tsx` (39) → `apps/mobile/src/app/settings/sticker-pack.tsx` (189)
- `apps/mobile/src/components/settings/bio-field.tsx` (41) → `apps/mobile/src/app/settings/profile.tsx` (114)
- `apps/mobile/src/lib/link-preview-image.ts` (41) → `apps/mobile/src/components/chat/link-preview-card.tsx` (146)
- `apps/mobile/src/components/contacts/use-people-search.ts` (42) → `apps/mobile/src/components/contacts/people-search-result.tsx` (102)
- `apps/mobile/src/components/profile/profile-info.tsx` (42) → `apps/mobile/src/app/u/[handle].tsx` (308)
- `apps/mobile/src/lib/whistle-last-note.ts` (44) → `apps/mobile/src/app/dev/whistle.tsx` (291)
- `apps/mobile/src/components/machines/revoked-machines.tsx` (45) → `apps/mobile/src/app/settings/machines.tsx` (195)
- `apps/mobile/src/components/ais/provider-picker.tsx` (46) → `apps/mobile/src/app/ais/[id].tsx` (368)
- `apps/mobile/src/store/effects/group-membership-actions.ts` (47) → `apps/mobile/src/store/effects/groups.ts` (280)
- `apps/mobile/src/components/profile/profile-media.tsx` (48) → `apps/mobile/src/app/u/[handle].tsx` (308)
- `apps/mobile/src/components/contacts/people-list-section.tsx` (49) → `apps/mobile/src/components/chat/chat-search-results.tsx` (163)
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx` (51) → `apps/mobile/src/components/ais/tools-section.tsx` (151)
- `apps/mobile/src/components/settings/handle-field.tsx` (52) → `apps/mobile/src/app/settings/profile.tsx` (114)
- `apps/mobile/src/store/list-views.ts` (53) → `apps/mobile/src/store/types.ts` (139)
- `apps/mobile/src/store/effects/session-check.ts` (57) → `apps/mobile/src/store/effects/ports.ts` (228)
- `apps/mobile/src/components/contacts/contacts.ts` (58) → `apps/mobile/src/app/settings/contacts.tsx` (170)
- `apps/mobile/src/lib/share-photo.ts` (59) → `apps/mobile/src/components/chat/image-viewer.tsx` (261)
- `apps/mobile/src/auth/otp.ts` (62) → `apps/mobile/src/auth/OtpInput.tsx` (85)
- `apps/mobile/src/components/ais/new-ai/setup-step.tsx` (63) → `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx` (137)
- `apps/mobile/src/components/stickers/telegram-import.ts` (64) → `apps/mobile/src/components/stickers/telegram-import-sheet.tsx` (253)
- `apps/mobile/src/components/settings/push-diagnostics.tsx` (65) → `apps/mobile/src/app/settings/notifications.tsx` (357)
- `apps/mobile/src/components/approvals/rules-section.tsx` (67) → `apps/mobile/src/app/settings/approvals.tsx` (114)
- `apps/mobile/src/components/connections/connection-card.tsx` (67) → `apps/mobile/src/app/settings/connections.tsx` (241)
- `apps/mobile/src/components/ais/ai-actions-sheet.tsx` (67) → `apps/mobile/src/app/(tabs)/ais.tsx` (310)
- `apps/mobile/src/components/ais/ai-memory-logic.ts` (69) → `apps/mobile/src/components/ais/ai-memory-section.tsx` (306)
- `apps/mobile/src/components/settings/use-handle-check.ts` (69) → `apps/mobile/src/components/settings/use-profile-settings.ts` (349)
- `apps/mobile/src/components/stickers/favorites-tab.tsx` (70) → `apps/mobile/src/app/settings/stickers.tsx` (312)
- `apps/mobile/src/lib/chat-list-cache.ts` (72) → `apps/mobile/src/store/effects/lifecycle.ts` (302)
- `apps/mobile/src/lib/attachment-uploader.ts` (73) → `apps/mobile/src/store/chat-store-provider.tsx` (170)
- `apps/mobile/src/components/settings/hub.ts` (73) → `apps/mobile/src/app/(tabs)/settings.tsx` (265)
- `apps/mobile/src/components/ais/use-computer-mode.ts` (73) → `apps/mobile/src/app/ais/[id].tsx` (368)
- `apps/mobile/src/components/approvals/pending-tab.tsx` (78) → `apps/mobile/src/app/settings/approvals.tsx` (114)
- `apps/mobile/src/components/machines/machine-sheet.tsx` (78) → `apps/mobile/src/components/machines/approved-machines.tsx` (126)
- `apps/mobile/src/auth/NameForm.tsx` (80) → `apps/mobile/src/app/welcome/name.tsx` (10)
- `apps/mobile/src/components/stickers/pack-actions.tsx` (83) → `apps/mobile/src/app/settings/sticker-pack.tsx` (189)
- `apps/mobile/src/lib/push/tap.ts` (84) → `apps/mobile/src/app/_layout.tsx` (167)
- `apps/mobile/src/auth/OtpInput.tsx` (85) → `apps/mobile/src/auth/AuthFlow.tsx` (237)
- `apps/mobile/src/components/ais/new-ai/model-step.tsx` (87) → `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx` (137)
- `apps/mobile/src/components/ais/machine-picker.tsx` (88) → `apps/mobile/src/app/ais/[id].tsx` (368)
- `apps/mobile/src/components/machines/pending-machines.tsx` (90) → `apps/mobile/src/app/settings/machines.tsx` (195)
- `apps/mobile/src/store/effects/history-ctx.ts` (90) → `apps/mobile/src/store/effects/history.ts` (247)
- `apps/mobile/src/components/group/new-group-name.tsx` (92) → `apps/mobile/src/app/group/new.tsx` (169)
- `apps/mobile/src/components/ais/tool-run-blocks.tsx` (92) → `apps/mobile/src/components/ais/tool-detail-body.tsx` (324)
- `apps/mobile/src/components/group-info/members-list.tsx` (93) → `apps/mobile/src/components/group-info/members-page.tsx` (315)
- `apps/mobile/src/components/profile/profile-actions.tsx` (94) → `apps/mobile/src/app/u/[handle].tsx` (308)
- `apps/mobile/src/lib/web-link.ts` (95) → `apps/mobile/src/app/+native-intent.tsx` (11)
- `apps/mobile/src/components/channel-info/more-menu.tsx` (99) → `apps/mobile/src/components/chat/channel-screen.tsx` (303)
- `apps/mobile/src/components/profile/profile-block.tsx` (100) → `apps/mobile/src/app/u/[handle].tsx` (308)
- `apps/mobile/src/components/contacts/people-search-result.tsx` (102) → `apps/mobile/src/components/chat/chat-search-results.tsx` (163)
- `apps/mobile/src/components/approvals/approval-row.tsx` (103) → `apps/mobile/src/components/approvals/pending-tab.tsx` (78)
- `apps/mobile/src/store/effects/ports-media.ts` (106) → `apps/mobile/src/store/effects/ports.ts` (228)
- `apps/mobile/src/components/stickers/pack-tile-sheet.tsx` (108) → `apps/mobile/src/app/settings/sticker-pack.tsx` (189)
- `apps/mobile/src/lib/gif-downloader.ts` (108) → `apps/mobile/src/components/chat/composer-media.ts` (275)
- `apps/mobile/src/components/profile/use-profile-dm.ts` (109) → `apps/mobile/src/app/u/[handle].tsx` (308)
- `apps/mobile/src/components/routines/routine-row.tsx` (110) → `apps/mobile/src/app/settings/routines.tsx` (239)
- `apps/mobile/src/components/ais/model-picker.tsx` (110) → `apps/mobile/src/app/ais/[id].tsx` (368)
- `apps/mobile/src/store/effects/user-state.ts` (111) → `apps/mobile/src/store/real-store.ts` (351)
- `apps/mobile/src/store/types-groups.ts` (112) → `apps/mobile/src/store/types.ts` (139)
- `apps/mobile/src/components/machines/add-machine-sheet.tsx` (119) → `apps/mobile/src/app/settings/machines.tsx` (195)

### Steps
1. **Fold each row.**
   - Move the small file's code into its importer, next to where it is used: above the component or function that uses it.
   - Merge the imports: one import per module, no duplicates.
   - Delete the importer's import of the small file, then delete the small file.
   - Keep `export` only on names something else still imports (a test or a fixture). Otherwise drop the keyword.
2. **Skip a row, and list it in the Report with the reason, when:**
   - the importer would go over 800 lines;
   - the importer loads the small file lazily (`lazy(() => import(…))`, `import(…)` or `require(…)`), since code splitting must stay;
   - the small file is named by a config, script or entry point (check with `git grep -n "<path without extension>"` across the repo);
   - folding would create an import cycle.
3. **Tests and fixtures** that import a folded file import the same names from the importer instead.
4. **Change no behaviour:** no logic, no wording, no styling. Formatting follows prettier.
5. **No new tests.** Report the line counts and the skipped rows.

### Allowed files
- `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/app/(tabs)/settings.tsx`
- `apps/mobile/src/app/+native-intent.tsx`
- `apps/mobile/src/app/ais/[id].tsx`
- `apps/mobile/src/app/dev/whistle.tsx`
- `apps/mobile/src/app/group/new.tsx`
- `apps/mobile/src/app/settings/approvals.tsx`
- `apps/mobile/src/app/settings/connections.tsx`
- `apps/mobile/src/app/settings/contacts.tsx`
- `apps/mobile/src/app/settings/integrations.tsx`
- `apps/mobile/src/app/settings/machines.tsx`
- `apps/mobile/src/app/settings/notifications.tsx`
- `apps/mobile/src/app/settings/profile.tsx`
- `apps/mobile/src/app/settings/routines.tsx`
- `apps/mobile/src/app/settings/sticker-pack.tsx`
- `apps/mobile/src/app/settings/stickers.tsx`
- `apps/mobile/src/app/u/[handle].tsx`
- `apps/mobile/src/app/welcome/name.tsx`
- `apps/mobile/src/auth/AuthFlow.tsx`
- `apps/mobile/src/auth/errors.ts`
- `apps/mobile/src/auth/InviteCodeField.tsx`
- `apps/mobile/src/auth/NameForm.tsx`
- `apps/mobile/src/auth/otp.ts`
- `apps/mobile/src/auth/OtpInput.tsx`
- `apps/mobile/src/components/ais/ai-actions-sheet.tsx`
- `apps/mobile/src/components/ais/ai-memory-logic.ts`
- `apps/mobile/src/components/ais/ai-memory-section.tsx`
- `apps/mobile/src/components/ais/delete-confirm.tsx`
- `apps/mobile/src/components/ais/limits.ts`
- `apps/mobile/src/components/ais/machine-picker.tsx`
- `apps/mobile/src/components/ais/model-picker.tsx`
- `apps/mobile/src/components/ais/new-ai/model-step.tsx`
- `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`
- `apps/mobile/src/components/ais/new-ai/setup-step.tsx`
- `apps/mobile/src/components/ais/provider-picker.tsx`
- `apps/mobile/src/components/ais/tool-detail-body.tsx`
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx`
- `apps/mobile/src/components/ais/tool-run-blocks.tsx`
- `apps/mobile/src/components/ais/tools-section.tsx`
- `apps/mobile/src/components/ais/use-computer-mode.ts`
- `apps/mobile/src/components/approvals/approval-row.tsx`
- `apps/mobile/src/components/approvals/pending-tab.tsx`
- `apps/mobile/src/components/approvals/rules-section.tsx`
- `apps/mobile/src/components/channel-info/content-page.tsx`
- `apps/mobile/src/components/channel-info/more-menu.tsx`
- `apps/mobile/src/components/channel-info/root-page.tsx`
- `apps/mobile/src/components/channel-info/settings-page.tsx`
- `apps/mobile/src/components/chat/channel-screen.tsx`
- `apps/mobile/src/components/chat/chat-search-results.tsx`
- `apps/mobile/src/components/chat/composer-media.ts`
- `apps/mobile/src/components/chat/image-viewer.tsx`
- `apps/mobile/src/components/chat/link-preview-card.tsx`
- `apps/mobile/src/components/chat/person-pressable.tsx`
- `apps/mobile/src/components/chat/request-rows.tsx`
- `apps/mobile/src/components/chat/steps-sheet.tsx`
- `apps/mobile/src/components/client-version-banner.tsx`
- `apps/mobile/src/components/connections/connection-card.tsx`
- `apps/mobile/src/components/connections/connections-header.tsx`
- `apps/mobile/src/components/connections/errors.ts`
- `apps/mobile/src/components/connections/use-connections.ts`
- `apps/mobile/src/components/contacts/contact-chip.tsx`
- `apps/mobile/src/components/contacts/contacts.ts`
- `apps/mobile/src/components/contacts/people-list-section.tsx`
- `apps/mobile/src/components/contacts/people-search-result.tsx`
- `apps/mobile/src/components/contacts/profile-card.tsx`
- `apps/mobile/src/components/contacts/use-people-prefix-search.ts`
- `apps/mobile/src/components/contacts/use-people-search.ts`
- `apps/mobile/src/components/group-info/members-list.tsx`
- `apps/mobile/src/components/group-info/members-page.tsx`
- `apps/mobile/src/components/group/new-group-members.tsx`
- `apps/mobile/src/components/group/new-group-name.tsx`
- `apps/mobile/src/components/integrations/card-save.ts`
- `apps/mobile/src/components/integrations/errors.ts`
- `apps/mobile/src/components/integrations/use-integrations-api.ts`
- `apps/mobile/src/components/machines/add-machine-sheet.tsx`
- `apps/mobile/src/components/machines/approved-machines.tsx`
- `apps/mobile/src/components/machines/machine-card.tsx`
- `apps/mobile/src/components/machines/machine-sheet.tsx`
- `apps/mobile/src/components/machines/machines-header.tsx`
- `apps/mobile/src/components/machines/pending-machines.tsx`
- `apps/mobile/src/components/machines/revoked-machines.tsx`
- `apps/mobile/src/components/profile/profile-actions.tsx`
- `apps/mobile/src/components/profile/profile-block.tsx`
- `apps/mobile/src/components/profile/profile-header.tsx`
- `apps/mobile/src/components/profile/profile-info.tsx`
- `apps/mobile/src/components/profile/profile-media.tsx`
- `apps/mobile/src/components/profile/use-profile-dm.ts`
- `apps/mobile/src/components/routines/routine-row.tsx`
- `apps/mobile/src/components/settings/bio-field.tsx`
- `apps/mobile/src/components/settings/handle-field.tsx`
- `apps/mobile/src/components/settings/hub.ts`
- `apps/mobile/src/components/settings/name-field.tsx`
- `apps/mobile/src/components/settings/push-diagnostics.tsx`
- `apps/mobile/src/components/settings/use-handle-check.ts`
- `apps/mobile/src/components/settings/use-profile-settings.ts`
- `apps/mobile/src/components/stickers/favorites-tab.tsx`
- `apps/mobile/src/components/stickers/order.ts`
- `apps/mobile/src/components/stickers/pack-actions.tsx`
- `apps/mobile/src/components/stickers/pack-tile-sheet.tsx`
- `apps/mobile/src/components/stickers/pack-visibility-field.tsx`
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`
- `apps/mobile/src/components/stickers/telegram-import.ts`
- `apps/mobile/src/components/stickers/use-stickers-panel.ts`
- `apps/mobile/src/lib/agent-tasks-api.ts`
- `apps/mobile/src/lib/attachment-uploader.ts`
- `apps/mobile/src/lib/chat-list-cache.ts`
- `apps/mobile/src/lib/gif-downloader.ts`
- `apps/mobile/src/lib/link-preview-image.ts`
- `apps/mobile/src/lib/person-link.ts`
- `apps/mobile/src/lib/push/tap.ts`
- `apps/mobile/src/lib/share-photo.ts`
- `apps/mobile/src/lib/theme.ts`
- `apps/mobile/src/lib/use-client-version.ts`
- `apps/mobile/src/lib/use-contact-requests.ts`
- `apps/mobile/src/lib/web-link.ts`
- `apps/mobile/src/lib/whistle-last-note.ts`
- `apps/mobile/src/store/chat-store-provider.tsx`
- `apps/mobile/src/store/effects/group-membership-actions.ts`
- `apps/mobile/src/store/effects/group-settings-actions.ts`
- `apps/mobile/src/store/effects/groups.ts`
- `apps/mobile/src/store/effects/history-ctx.ts`
- `apps/mobile/src/store/effects/history.ts`
- `apps/mobile/src/store/effects/lifecycle.ts`
- `apps/mobile/src/store/effects/ports-media.ts`
- `apps/mobile/src/store/effects/ports.ts`
- `apps/mobile/src/store/effects/push-pair.ts`
- `apps/mobile/src/store/effects/session-check.ts`
- `apps/mobile/src/store/effects/user-state.ts`
- `apps/mobile/src/store/list-views.ts`
- `apps/mobile/src/store/real-store.ts`
- `apps/mobile/src/store/send-types.ts`
- `apps/mobile/src/store/types-groups.ts`
- `apps/mobile/src/store/types.ts`
- `apps/mobile/src/auth/otp.test.ts`
- `apps/mobile/src/store/effects/session-check.test.ts`
- `apps/mobile/src/store/real-store.lifecycle.test.ts`
- `work/T-2106-fold-phone-rest.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 211 lower.

---

## Report (written by the worker when done)

### What I did
- Folded **85 of the 86 rows**. Each small file's declarations moved into its importer directly after the import block (above the code that uses it); the importer's import of the small file was removed, the small file's own imports were merged into the importer (one statement per module, duplicate names deduped, key/value type imports kept), and the small file was deleted.
- Rewrote relative imports of moved code to resolve from the importer's new location; where a chain had already moved the importer several directories away, the specifier was recomputed against the real target.
- Handled the one transitive row: `approvals/approval-row.tsx`'s importer `approvals/pending-tab.tsx` had already folded into `app/settings/approvals.tsx`, so the row folded into that file.
- Preserved every leading file comment and the `effect-plain:` marker from moved files (the markers stayed in the first lines of `store/effects/ports.ts` and `store/effects/lifecycle.ts`).
- Updated the tests that imported folded files: `auth/otp.test.ts` (unchanged, see skip), `store/effects/session-check.test.ts` → `./ports`, `store/real-store.lifecycle.test.ts` → `./effects/lifecycle`.
- Renamed two private helpers where the small file and the importer each declared the same name: `rawCall` → `computerRawCall` in `components/ais/use-computer-mode.ts`, `fromThrown` → `profileDmFromThrown` in `components/profile/use-profile-dm.ts`. Call sites updated; behaviour unchanged.
- Removed two dead exported wrappers from the folded `ai-memory-logic` code (`requestForgetFact`, `clearAiMemory`): nothing imported or called them, and dropping the `export` keyword left lint-visible unused locals.
- Left `export` only where another module still imports the name: the three `store/types.ts` barrel types/sets (`send-types`, `list-views`, `types-groups`), `checkSession`/`sessionGone` for the session-check test, and `readChatListCache` for the lifecycle test.

### Checks run
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/auth/otp.test.ts src/store/effects/session-check.test.ts src/store/real-store.lifecycle.test.ts` → 3 files passed, 28 tests passed.
- `pnpm gate` → exit 0:
  ```
  PASS  install (frozen)  (1.2s)
  PASS  format  (2.6s)
  PASS  lint  (2.9s)
  PASS  typecheck  (5.8s)
  PASS  effect  (1.5s)
  SKIP build @zilar/server (no server, package or manifest change)
  PASS  tests @zilar/mobile  (7.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
- Line counts: 85 small files deleted; `apps/mobile` diff is 4898 insertions / 5344 deletions → **net −446 product lines**. Largest touched file is `apps/mobile/src/app/u/[handle].tsx` at 692 lines (was 308); no file is over 800. The gate reports soft-limit warnings (>400 lines) on 11 touched files, as expected when folding single-use files.

### Notes for the lead
- **Skipped row:** `apps/mobile/src/auth/otp.ts` → `auth/OtpInput.tsx`. `auth/otp.test.ts` imports the module directly; after the planned fold the importer chain (`OtpInput` → `AuthFlow`) pulls `react-native`/`expo-router`, which Vitest cannot parse (`SyntaxError: Unexpected token 'typeof'`), so the fold would break the gate. The file stays and `OtpInput`/`AuthFlow` import from it as before.
- The two helper renames above are the only renames; they are local functions, so no behaviour or exported surface changed.
- Six importers now mix `@/` and relative imports because the moved code brought its relative paths along; all resolve correctly and typecheck passes. Happy to normalise them to `@/` in a follow-up if you prefer.

## Review (written by Claude)

Approved; the pre-review was clean (1 import-style nit). Net −446; 85 single-use files folded into their only importer across 19 screens, including `_layout.tsx` and `+native-intent.tsx`. The largest results are `u/[handle].tsx` (692) and `ais/[id].tsx` (663), both under 800.
- **Phone emulator smoke, 15 routes, all PASS:** `/`, `/ais`, `/settings`, `/ais/ai-dev-1`, and `/settings/` approvals, connections, contacts, machines, notifications, profile, routines and stickers; also `/u/marta`, `/group/new` and `/dev/whistle`.
- **Screenshots.** The lead looked at a contact sheet of all 15: every screen shows its content (lists, forms, the machine pairing code, the routines, the profile), and none is blank or errored. Every route opened through the `zilar://` deep link, so `+native-intent.tsx` works.
