---
id: T-0541
title: "Effect lane E, batch 4: mobile directory-api, chat-folders-api, profile-api and approvals-api onto Effect Schema + the T-0506 request pipeline, using the shared lenient error envelope (T-0538); same exports, same errors, tests unchanged"
status: merged
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

Converted all four mobile API clients to the T-0506 Effect recipe (`pins-api.ts`)
with the shared lenient error envelope from T-0538 (`errorFieldsOf`, no local
`ErrorBodySchema`). Same exports, types, signatures, request bodies, headers,
paths, error classes/statuses/codes/messages. No existing test touched; no new
test files added (existing coverage already pins every tolerance case).

What changed per file:
- `apps/mobile/src/lib/directory-api.ts`: hand guards replaced with Effect
  Schema (`struct` from `@zilar/protocol`). `description` stays required
  nullable, `avatarUrl` optional string, `next` required nullable.
  `parseGroupVisibility` decodes `{visibility?, handle?}` and defaults absent
  to `private`/`null`; any other visibility value or non-string handle still
  fails the row. `buildVisibilityBody` untouched. Request/errors run as an
  Effect pipeline (`DirectoryNetworkError`/`DirectoryRequestError`/
  `DirectoryUnauthorized`/`DirectoryInvalidResponse`) mapped back to the same
  `DirectoryApiError`s at the `Effect.runPromise` edge.
- `apps/mobile/src/lib/chat-folders-api.ts`: `ChatFolderSchema` with
  `Schema.Literals(FOLDER_ICONS)`, `Schema.Finite` for `position` (rejects
  NaN/Infinity like the old `Number.isFinite` guard), strict arrays/booleans.
  `parseChatFolder` is a thin wrapper over the schema. List still drops
  malformed rows; create/patch/order still throw `invalid_response` on a bad
  row; delete still requires `deleted: true`. Request keeps the
  `{method, body}` shape, `Content-Type` capitalisation, and no `body` key on
  bodyless calls.
- `apps/mobile/src/lib/profile-api.ts`: schemas for handle-check, claimed
  handle, `MyProfile` (absent handle reads as `null`, absent `avatarUrl`
  stays absent), and avatar URL. `parseApiErrorBody` keeps its signature and
  results, now backed by `errorFieldsOf` for code/message plus a schema decode
  for `nextChangeAt` with the same parseable-date check.
  `avatarPutPath`/`checkHandlePath`/`avatarFileName` untouched. Avatar upload
  keeps both paths byte-identical (fetch PUT with `blob.type`; native
  `uploader(url, mimeType)` whose rejection still propagates raw); only the
  response decode changed. `removeAvatar` still accepts any 2xx body.
- `apps/mobile/src/lib/approvals-api.ts`: strict status/currency/amount
  schemas; `groupId`/`details`/`decidedAt`/`note`/`topicId`/`topicName` use
  the lenient nullable-string pattern (absent or non-string reads as `null`,
  never fails the row). `worstCase` stays required-nullable (missing fails,
  like the old `!== null` re-check). List endpoints decode a bare array and
  fail the whole list on one bad row; revoke still treats any 2xx as revoked.
  `buildDecisionBody` untouched.

Commands and real results:
- `pnpm install`: ok (1173 packages, one pre-existing unmet-peer warning for
  `@types/react-dom` in `apps/mobile`).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  src/lib/directory-api.test.ts src/lib/chat-folders-api.test.ts`: 19 passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  src/lib/profile-api.test.ts src/lib/approvals-api.test.ts`: 50 passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot directory
  chat-folders profile approval new-group-sheet visibility-sheet
  explore-helpers handle-route avatar-native real-store.folders`
  (the task Checks line): 228 passed, 0 failed.
- `pnpm gate` (first run): FAIL on `format` only (my 3 rewritten files needed
  prettier); fixed with `prettier --write` on those Allowed files. Second run:
  `PASS install / format / lint / typecheck / tests @zilar/mobile`,
  `scope: every changed file is inside the Allowed files`, `GATE PASS`.

Security checklist: no secrets/tokens in logs or errors (typed errors carry
only status/code/message plus the pre-existing `nextChangeAt` date); no DB
writes (mobile clients only); no new routes; error mapping keeps 401/404/409
shapes identical. No deviations from the spec; no open questions.

## Review (written by Claude)

## Review (written by Claude)

Approved (lead, 2026-10-08). The directory, chat-folders, profile and approvals mobile clients are on Effect Schema plus the T-0506 pipeline and the shared envelope, with the same exports and tolerances. phone:smoke on the galena AVD, with ZILAR_ROUTES covering /explore, /settings/folders, /settings/approvals, /settings/profile and /profile: all passed. The lead read each screenshot; every screen loads live data. Pre-review clean.
