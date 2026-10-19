---
id: T-2149
title: "Clean-up (phone): delete exported functions, constants and types that nothing in the repo uses — and whatever only they used; no behaviour change"
status: merged
milestone: M5
branch: task/T-2149-dead-exports-phone
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2149: Delete dead exports (phone)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and a codebase that people and AIs can read without tripping over leftovers. The lead scanned every `.ts`/`.tsx` file under `apps/` and `packages/` at `db209d184`, tests and mocks included. Each name below appears exactly once in the whole repo: the declaration itself. No code, test or mock uses it. Most are left over from tonight's folds and the earlier test cuts.

| File | Line | Name |
| --- | ---: | --- |
| `apps/mobile/src/components/ais/ai-activity.tsx` | 48 | `loadActivity` |
| `apps/mobile/src/components/ais/ai-activity.tsx` | 78 | `appendActivity` |
| `apps/mobile/src/components/ais/routines-section.tsx` | 51 | `loadAiRoutines` |
| `apps/mobile/src/components/ais/tools-section.tsx` | 83 | `loadAiTools` |
| `apps/mobile/src/components/ais/use-routine-actions.ts` | 64 | `applyRoutineAction` |
| `apps/mobile/src/components/chat/markdown-decision.ts` | 12 | `rendersMarkdown` |
| `apps/mobile/src/components/chat/search-jump.ts` | 43 | `openSearchHit` |
| `apps/mobile/src/components/chat/visibility-sheet.tsx` | 19 | `mayChangeVisibility` |
| `apps/mobile/src/components/chat/voice-player-host.ts` | 255 | `createVoicePlayerHostForTest` |
| `apps/mobile/src/components/chat/voice-player-registry.ts` | 174 | `resetVoicePlayerForTest` |
| `apps/mobile/src/components/contacts/add-contact.ts` | 20 | `addContactInitial` |
| `apps/mobile/src/components/contacts/add-contact.ts` | 24 | `addContactHandle` |
| `apps/mobile/src/components/settings/avatar-native.ts` | 288 | `stagedAvatarName` |
| `apps/mobile/src/lib/approvals-api.ts` | 10 | `ApprovalWorstCase` |
| `apps/mobile/src/lib/attachment-opener.ts` | 175 | `cacheDestinationFor` |
| `apps/mobile/src/lib/audit-api.ts` | 7 | `AuditResult` |
| `apps/mobile/src/lib/audit-api.ts` | 8 | `AuditCost` |
| `apps/mobile/src/lib/blocked-users.ts` | 64 | `blockedJidsSnapshot` |
| `apps/mobile/src/lib/channels.ts` | 54 | `channelAdminsOf` |
| `apps/mobile/src/lib/channels.ts` | 70 | `channelInfoSubtitle` |
| `apps/mobile/src/lib/composer-drafts.ts` | 77 | `loadScopedDrafts` |
| `apps/mobile/src/lib/stickers-storage.ts` | 31 | `setRecentsBackend` |
| `apps/mobile/src/lib/tools-api.ts` | 14 | `ToolLastRunStatus` |
| `apps/mobile/src/lib/tools-api.ts` | 15 | `ToolRunTrigger` |
| `apps/mobile/src/lib/tools-api.ts` | 16 | `ToolRunStatus` |
| `apps/mobile/src/lib/tools-api.ts` | 37 | `RoutineActionsApi` |
| `apps/mobile/src/lib/tools-api.ts` | 38 | `MyRoutinesApi` |
| `apps/mobile/src/lib/topics.ts` | 9 | `isTopicChat` |
| `apps/mobile/src/lib/topics.ts` | 13 | `isLegacyGroupChat` |
| `apps/mobile/src/lib/types.ts` | 2 | `CURRENT_USER_NAME` |
| `apps/mobile/src/lib/voice-failure.ts` | 8 | `voiceFailureReasonFor` |
| `apps/mobile/src/lib/voice-transcribe-flow.ts` | 158 | `transcribeCacheName` |
| `apps/mobile/src/lib/voice-transcripts.ts` | 165 | `deleteTranscript` |
| `apps/mobile/src/store/effects/runtime.ts` | 39 | `failAfter` |

### Steps
For each row:
1. **Confirm it is unused.** Run `git grep -nw <name>` over the whole repo, not just `apps/` and `packages/`, so scripts, `.js`/`.mjs`, JSON, `app.json` and native code count too. If anything other than the declaration names it, skip the row and say where it is used.
2. **Delete the declaration** and its doc comment.
3. **Delete what it alone used.** That is a private helper, a constant, a type or an import that has no other user in that file once the declaration is gone. Re-check each with `git grep -nw`.
4. **Delete an emptied file.** If a file is left with no exports and no side effects, delete it and the import lines that point at it.

### Rules
- No behaviour change. Only delete; never rewrite a line that stays.
- Keep every name that still has a user.
- No new tests. If a test imports a deleted name, the scan was wrong: skip that row.
- `apps/mobile/src/store/effects/runtime.ts`: delete only `failAfter` and what only it used; change nothing else in the store.

### Allowed files
- `apps/mobile/src/components/ais/ai-activity.tsx`
- `apps/mobile/src/components/ais/routines-section.tsx`
- `apps/mobile/src/components/ais/tools-section.tsx`
- `apps/mobile/src/components/ais/use-routine-actions.ts`
- `apps/mobile/src/components/chat/markdown-decision.ts`
- `apps/mobile/src/components/chat/search-jump.ts`
- `apps/mobile/src/components/chat/visibility-sheet.tsx`
- `apps/mobile/src/components/chat/voice-player-host.ts`
- `apps/mobile/src/components/chat/voice-player-registry.ts`
- `apps/mobile/src/components/contacts/add-contact.ts`
- `apps/mobile/src/components/settings/avatar-native.ts`
- `apps/mobile/src/lib/approvals-api.ts`
- `apps/mobile/src/lib/attachment-opener.ts`
- `apps/mobile/src/lib/audit-api.ts`
- `apps/mobile/src/lib/blocked-users.ts`
- `apps/mobile/src/lib/channels.ts`
- `apps/mobile/src/lib/composer-drafts.ts`
- `apps/mobile/src/lib/stickers-storage.ts`
- `apps/mobile/src/lib/tools-api.ts`
- `apps/mobile/src/lib/topics.ts`
- `apps/mobile/src/lib/types.ts`
- `apps/mobile/src/lib/voice-failure.ts`
- `apps/mobile/src/lib/voice-transcribe-flow.ts`
- `apps/mobile/src/lib/voice-transcripts.ts`
- `apps/mobile/src/store/effects/runtime.ts`
- `work/T-2149-dead-exports-phone.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every row is deleted, or skipped with the user's file:line.
- The Report gives the product-line net from `git diff main --numstat`.

---

## Report (written by the worker when done)

### What I did

- Deleted all 34 exported names from the table. No row was skipped: `git grep -nw` over the whole repo found each name only at its declaration in code; the only other hits were history in `docs/` and `work/`, not users.
- Deleted helpers that only the removed names used:
  - `destinationName` and `sanitizeId` (private, only `transcribeCacheName`).
  - The `runMobile` import (`loadAiTools` only) and `normalizeHandleInput` import (`addContactHandle` only).
  - `ToolListItem` and `ToolRun` from the `tools-api.ts` import (only the deleted aliases), and `PublicApproval` from the `approvals-api.ts` import (only `ApprovalWorstCase`).
- No file was left empty; all 25 source files already had other exports or side effects.
- Changed 25 source files plus this task file. Net product lines from `git diff main --numstat` (excluding `work/`): **3 added, 218 deleted, net -215**. Including this task file: 118 added, 218 deleted, net -100.

### Checks run

- `pnpm install --frozen-lockfile` — done in 23.4s.
- `pnpm gate` — `GATE PASS`:
  ```
  gate: 26 changed file(s) against main
  PASS  install (frozen)  (2.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.7s)
  PASS  effect  (2.0s)
  SKIP build @zilar/server (no server, package or manifest change)
  PASS  tests @zilar/mobile  (4.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
- I did not run any single test file separately; `pnpm gate` ran the mobile tests and they passed. A first gate run failed only on Prettier in `add-contact.ts` (the shortened import); I collapsed that import and reran the gate, which passed.

### Notes for the lead

- No skipped rows and no behaviour changes.
- `apps/mobile/src/components/chat/markdown-decision.ts` still has its file comment "The two Markdown wiring decisions…" above the surviving `plainPreviewBody`. I left it because the rules say never rewrite a line that stays; it can be reworded in a follow-up if you want.

## Review (written by Claude)

Approved; the pre-review was clean (1 nit). Net −215: all 34 dead exported names deleted from the phone, plus helpers and imports that only they used. In the store, only `failAfter` was removed. The only added lines are narrowed imports.

**Nit:** the header comment of `markdown-decision.ts` still says "two decisions" for its one survivor. That goes in the next clean-up.
