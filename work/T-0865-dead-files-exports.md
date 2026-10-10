---
id: T-0865
title: "Delete the confirmed dead files and the 41 unreferenced declarations (knip, hand-verified)"
status: merged
milestone: M5
branch: task/T-0865-dead-files-exports
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0865: Delete the confirmed dead files and the 41 unreferenced declarations (knip, hand-verified)

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Findings G-F1 and G-F2 in `docs/audit/simplify-2026-10-09/G-deadcode.md` (read both sections for the exact lists).
- **Confirmed dead files:**
  - `apps/mobile/src/components/chat/use-invites-api.ts` and `apps/mobile/src/mock/invites.ts`;
  - `apps/server/src/auth/session.ts`;
  - `apps/mobile/src/lib/protocol.ts`, which only its own test uses.
- **Declarations:** 41 declarations are referenced nowhere, about 202 lines.
- **Out of scope here:** dropping `export` on the 756 file-local exports is a later sweep, because it touches too many files at once.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
For each item, re-verify with grep (including tests, dynamic imports, Expo Router file routes, package.json scripts and workers) before deleting, and skip anything that is not truly dead. Delete the dead file's own test with it. Do not touch `apps/web/src/store/**`, `apps/mobile/src/store/**`, `apps/web/src/mock/**`, `apps/mobile/src/mock/**` (except `invites.ts`) or any `*/api.ts` in the server; other tasks are editing those. Skip items there and list them.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/mobile/src/components/chat/use-invites-api.ts`, `apps/mobile/src/mock/invites.ts`, `apps/server/src/auth/session.ts`, `apps/mobile/src/lib/protocol.ts`, `apps/mobile/src/lib/protocol.test.ts`, `apps/web/src/**`, `apps/mobile/src/**`, `apps/server/src/**`, `packages/**/src/**`, `work/T-0865-dead-files-exports.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.

---

## Report (written by the worker when done)

**Result:** 5 files deleted (86 lines); 58 dead declarations deleted (33 type aliases, 25 values); 2 candidates skipped. 46 code files changed (plus this task file), 361 lines deleted, 4 added, net 357 lines removed. Measured with `git diff --cached --shortstat`.

**How "dead" was proven.** The audit's `dead.json` is not in this worktree, so I rebuilt the list. A script (kept in the scratchpad, not the repo) counted identifier occurrences across every tracked ts/tsx/js/mjs/cjs/json/md file outside `work/` and `docs/`. It listed every `export` declaration in `apps/{web,mobile,server}/src` and `packages/*/src` whose name occurs only once (its own declaration). Before deleting, I grepped each name with `git grep` to confirm no relative import, dynamic import or comment-only reference. Rescan after the edits: only the 2 skipped items remain. The list has 59 candidates. The audit said 41; the difference is mostly type aliases (the audit probably counted values only), so the audit number could not be reproduced exactly.

**Files deleted (line counts from `wc -l`):**
- `apps/mobile/src/components/chat/use-invites-api.ts` (37 lines): `git grep` finds only its own `import` of `@/mock/invites` and its `export`; `invite-sheet.tsx` takes the api as a prop.
- `apps/mobile/src/mock/invites.ts` (20 lines): imported only by `use-invites-api.ts`.
- `apps/server/src/auth/session.ts` (17 lines): `requireSession` / `requireSessionEffect` appear only in comments (`effect/http-core.ts:36`, `files/api.ts:12`, `gifs/api.ts:10`, `media/api.ts:12`, `push/api.ts:10`). Mobile's `@/auth/session` is a different file, not touched.
- `apps/mobile/src/lib/protocol.ts` (3 lines) and `apps/mobile/src/lib/protocol.test.ts` (9 lines): the only importer of `./protocol` was its own test.

**Declarations deleted (grep proof: the name occurs once in the tree):**
- Values (25): `GroupAvatar` (topic-row.tsx; its `Avatar` import also removed), `resetConnectionsMock`, `resetMachinesMock`, `STICKER_MAX_PER_PACK`, `TEXT_SHADOW_LIGHT`, `TEXT_SHADOW_DARK` (its `TextStyle` import removed), `EMOJI_RECENTS_KEY`, `setEmojiRecentsBackend`, `MODEL_TEXT_WRAPPER_CLOSE` (plus its comment), `statusFor`, `SqlLive` (its `Config` import removed; the `transformJson` comment kept), `findHandle`, `handleUserIdFor`, `displayNameFor`, `isHandleChangeTooSoon` (handles/store.ts, 58 lines in total), `INVITE_LINK_TOKEN_HEX_LENGTH`, `MEDIA_WINDOW_MONTHS`, `UserAgentSchema` (with its comment), `SEARCH_WINDOW_MONTHS`, `testXmppConfig` (test-support.ts), `canSeeTopicById`, `listTopicApprovalRules` and `currentSubscription` (web), with the non-exported `currentSubscriptionEffect` only it used, `DOCTOR_MODEL` (devtools doctor.ts, with its comment), `badgeText` (devtools watch-format.ts).
- Types (33): `SheetPreview`, `EmojiSheetTabBodyProps`, `ProfileCardAction`, `RequestsState`, `ExploreStatus` (mobile; `SheetPreview`'s comment removed too), `UpdatePersonaArgs`, `RequestActionArgs` (server agents/tools.ts), `AuditRecorderDeps`, `PushConfigInput`, `XmppEnv`, `MachineErrorInfo`, `GroupRoleMember`, `TopicApprovalRule` (cascade after `listTopicApprovalRules` went), `PendingApprovalCount`, protocol `IsoDateTime`, `Currency`, `ArtifactKind`, `ArtifactRef`, `Handoff`, `PollOption`, `Poll`, `PollVote`, `CostTokens`, `TaskState`, `Decision`, `BoardArtifact`, `BoardUpdate`, `VoiceTranscript`, `WakeReason`; `RunnerToServerType`, `ServerToRunnerType` (runner-tunnel), `RadiusKey`, `DepthKey` (ui-tokens).

**Skipped:**
- `apps/mobile/src/store/real-store.ts:109` `isUpdateStanza`: it is in `apps/mobile/src/store/**`, on the do-not-touch list. Still unreferenced; for the store owner.
- `packages/runner-tunnel/src/protocol.ts:16` `FRAME_RESET = 2`: a wire frame kind shared with the runner; it stays as part of the protocol table even though no code uses it.
- Nothing in `*/api.ts` on the server was touched; nothing in `apps/*/src/store/**`, `apps/*/src/mock/**` except `invites.ts`, or `apps/web/src/store/**` was touched.

**Other edits:** `apps/mobile/src/components/chat/new-chat-button.tsx` comment that named the deleted `useInvitesApi` hook was reworded (2 lines). Unused imports left behind by the deletions were removed (`Avatar` in topic-row.tsx, `PickedFile` in attach-sheet.tsx, `TextStyle` in depth.ts, `Config` in effect/sql.ts). Prettier and oxlint ran on all changed files.

**Checks (wave mode, one run each):**
- `pnpm install`: finished.
- `pnpm --filter @zilar/web typecheck`: exit 0.
- `pnpm --filter @zilar/mobile typecheck`: exit 0.
- `pnpm --filter @zilar/server typecheck`: exit 0.
- `pnpm exec oxlint` on every changed file (41 modified; deleted files excluded): no output, clean.
- Tests: not run. The spec's Checks list has no test command, and wave mode forbids the full suite. The "run the tests 3 times" line was therefore not done.
- Not type-checked: `packages/protocol`, `packages/runner-tunnel`, `packages/ui-tokens`, `packages/devtools` (not in the Checks). The full-tree grep found no reference to any removed type or value there, but that is not a typecheck.

**Unsure:** the grep scan finds only static references. A name that is built at runtime (for example a computed property or a `require` of a generated path) would not show up, though the typechecks cover the static paths in web, mobile and server.

## Review (written by Claude)

**Lead, 2026-10-10: approved after fix round 1.**
- **What changed:** 5 dead files and 58 unreferenced declarations are gone, net −357 lines.
- **Fix round:** this branch merges T-0848 (it carries T-0848's commits) to resolve the `use-invites-api.ts` conflict. The file stays deleted, because nothing imports it.
- **Checks:** the combined check is clean, including all typechecks and the full suites.
