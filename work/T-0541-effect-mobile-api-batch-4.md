---
id: T-0541
title: "Effect lane E, batch 4: mobile directory-api, chat-folders-api, profile-api and approvals-api onto Effect Schema + the T-0506 request pipeline, using the shared lenient error envelope (T-0538); same exports, same errors, tests unchanged"
status: todo
milestone: M5
branch: task/T-0541-effect-mobile-api-batch-4
model: auto
effort: low
depends_on: [T-0538]
estimate: 1 day
---

# T-0541: mobile API clients batch 4 on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, mobile included. The recipe is `apps/mobile/src/lib/pins-api.ts` (T-0506) and `docs/EFFECT_GUIDE.md`, "Moving a mobile API client onto Effect". **T-0538 added `apps/mobile/src/lib/api-error-body.ts`**, the shared lenient error envelope: use it, and do not write a local `ErrorBodySchema`.

### Verified facts (do not re-derive)
These files validate by hand today. Their exports **all stay the same**:
- **`apps/mobile/src/lib/directory-api.ts`** (321 lines): `DirectoryKind`, `DirectoryEntry`, `DirectoryPage`, `SearchDirectoryInput`, `PublicJoinResult`, `GroupVisibility`, `GroupVisibilityState`, `SetGroupVisibilityInput`, `HandleCheckReason`, `HandleCheck`, `DirectoryApi`, `DirectoryApiError`, `buildVisibilityBody` (line 221; a request builder that stays as it is) and `createDirectoryApi`.
- **`apps/mobile/src/lib/chat-folders-api.ts`** (278 lines): `CreateChatFolderInput`, `PatchChatFolderInput`, `ChatFoldersApi`, `ChatFoldersApiError`, **`parseChatFolder(value): ChatFolder | null`** (line 94) and `createChatFoldersApi`.
- **`apps/mobile/src/lib/profile-api.ts`** (286 lines): `HandleCheckReason`, `HandleCheck`, `MyProfile`, `ProfileApi`, `ProfileApiError`, **`parseApiErrorBody(body)`** (line 138; exported, so keep its signature and its result, now backed by the shared envelope), `avatarPutPath`, `checkHandlePath`, `avatarFileName` and `createProfileApi`.
- **`apps/mobile/src/lib/approvals-api.ts`** (324 lines): `ApprovalStatus`, `ApprovalDecision`, `ApprovalWorstCase`, `PublicApproval`, `ApprovalsApi`, `ApprovalRuleScope`, `ApprovalRule`, `ApprovalsApiError`, `buildDecisionBody` (line 194; stays) and `createApprovalsApi`.
- **Tests that cover them (all unchanged):**
  - `apps/mobile/src/lib/{directory-api,chat-folders-api,profile-api,approvals-api,approval-state}.test.ts`;
  - `apps/mobile/src/components/approvals/{approvals.test.ts,rows.test.tsx}`;
  - `apps/mobile/src/components/chat/{new-group-sheet.test.tsx,visibility-sheet.test.ts}`;
  - `apps/mobile/src/components/directory/{explore-helpers,handle-route}.test.ts`;
  - `apps/mobile/src/components/profile/profile-view.test.tsx`;
  - `apps/mobile/src/components/settings/{avatar-native,profile-logic}.test.ts`;
  - `apps/mobile/src/mock/{approvals,profile}.test.ts`;
  - `apps/mobile/src/store/real-store.folders.test.ts`.

### What to build
1. **Convert the four files with the T-0506 recipe** and the shared envelope:
   - the same exported names, types and signatures;
   - the same tolerance: what the hand validator skipped, defaulted or rejected, the schema skips, defaults or rejects the same way;
   - the same error class, status, code and message for every failure, including a network throw and a non-JSON body.
   
   `parseChatFolder` becomes a thin wrapper.
2. **Avatar uploads in `profile-api.ts`:** keep the request body, headers and paths exactly as they are. Only the response decode changes.
3. **Tests:** every existing test passes **unchanged**. You may add one new test file per client.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the mobile API section), `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/api-error-body.ts`, then the four files and their tests.

### Allowed files
- `apps/mobile/src/lib/directory-api.ts`, `apps/mobile/src/lib/chat-folders-api.ts`, `apps/mobile/src/lib/profile-api.ts`, `apps/mobile/src/lib/approvals-api.ts`;
- the new, optional test files: `apps/mobile/src/lib/directory-api.effect.test.ts`, `apps/mobile/src/lib/chat-folders-api.effect.test.ts`, `apps/mobile/src/lib/profile-api.effect.test.ts` and `apps/mobile/src/lib/approvals-api.effect.test.ts`;
- `work/T-0541-effect-mobile-api-batch-4.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot directory chat-folders profile approval new-group-sheet visibility-sheet explore-helpers handle-route avatar-native real-store.folders
pnpm gate
```

### Acceptance
- The four clients decode with Effect Schema and the shared envelope, and run as Effect pipelines, with the same exports and errors.
- Every existing test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
