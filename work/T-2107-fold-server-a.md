---
id: T-2107
title: "Fold 56 small single-use files into the one file that imports each (server, part 1): the code moves into its importer, duplicate imports merge, the small file goes — no behaviour change"
status: merged
milestone: M5
branch: task/T-2107-fold-server-a
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2107: Fold single-use files (server, part 1)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down. A file over 400 lines is fine when it saves lines; never split only for the number, and only a file over 800 lines must split.

The 10-10 split rule left many small files with exactly one importer. Each one repeats an import block, an export line and the importer's import line.

### Facts (the lead's import graph, 2026-10-18 at `e42276bc7`)
Each row below is `small file (lines) → its only production importer (lines)`. The lead resolved every relative and `@/` import, including dynamic `import()`. The 56 files total 3742 lines, 239 of them import lines.

- `apps/server/src/agents/tools/blocks-tool.ts` (15) → `apps/server/src/agents/tools/definitions.ts` (224)
- `apps/server/src/agents/tools/media-tool.ts` (25) → `apps/server/src/agents/tools/definitions.ts` (224)
- `apps/server/src/agents/reply-mention.ts` (25) → `apps/server/src/agents/group-turn.ts` (311)
- `apps/server/src/agents/gateway/pending.ts` (33) → `apps/server/src/agents/gateway/contracts.ts` (272)
- `apps/server/src/agents/tools/reply-lines.ts` (33) → `apps/server/src/agents/gateway/tool-exec.ts` (310)
- `apps/server/src/agents/gateway/typed-mention.ts` (34) → `apps/server/src/agents/gateway/addressing.ts` (140)
- `apps/server/src/agents/gateway/card-rekey.ts` (45) → `apps/server/src/agents/gateway/group-ingest.ts` (323)
- `apps/server/src/agents/gateway/turn-defect.ts` (57) → `apps/server/src/agents/gateway/dm-turn.ts` (328)
- `apps/server/src/agents/failure-class.ts` (59) → `apps/server/src/agents/tool-exec.ts` (260)
- `apps/server/src/agents/group-turn-deps.ts` (60) → `apps/server/src/agents/group-turn.ts` (311)
- `apps/server/src/agents/handoff.ts` (61) → `apps/server/src/agents/group-turn.ts` (311)
- `apps/server/src/agents/memory/compactor.ts` (72) → `apps/server/src/agents/gateway/memory.ts` (170)
- `apps/server/src/agents/tools/desk-definitions.ts` (72) → `apps/server/src/agents/tools/definitions.ts` (224)
- `apps/server/src/agents/memory/compaction.ts` (74) → `apps/server/src/agents/memory/compactor.ts` (72)
- `apps/server/src/routines/message-store.ts` (77) → `apps/server/src/agents/gateway/routine-send.ts` (161)
- `apps/server/src/agents/log/read.ts` (81) → `apps/server/src/agents/log/api.ts` (88)
- `apps/server/src/agents/gateway/room-limits.ts` (82) → `apps/server/src/agents/gateway/group-turn.ts` (343)
- `apps/server/src/agents/gateway/approval-follow-up.ts` (86) → `apps/server/src/agents/gateway.ts` (343)
- `apps/server/src/agents/context-edits.ts` (88) → `apps/server/src/agents/context.ts` (264)
- `apps/server/src/agents/gateway/request-action.ts` (97) → `apps/server/src/agents/gateway/tool-exec.ts` (310)
- `apps/server/src/agents/gateway/group-turn-access.ts` (99) → `apps/server/src/agents/gateway/group-turn-body.ts` (380)
- `apps/server/src/topics/general-ais.ts` (30) → `apps/server/src/topics/api.ts` (370)
- `apps/server/src/topics/types.ts` (86) → `apps/server/src/topics/access.ts` (259)
- `apps/server/src/topics/room-sync.ts` (93) → `apps/server/src/topics/rooms.ts` (25)
- `apps/server/src/topics/ai-access.ts` (97) → `apps/server/src/topics/access.ts` (259)
- `apps/server/src/topics/preview.ts` (114) → `apps/server/src/topics/api.ts` (370)
- `apps/server/src/push/failure-reason.ts` (31) → `apps/server/src/push/api-test.ts` (139)
- `apps/server/src/push/subscriptions.ts` (35) → `apps/server/src/push/store-save.ts` (185)
- `apps/server/src/push/preview-delivered.ts` (55) → `apps/server/src/push/api-handlers.ts` (293)
- `apps/server/src/push/notification.ts` (98) → `apps/server/src/push/component.ts` (186)
- `apps/server/src/tools/routine-list-lines.ts` (46) → `apps/server/src/tools/tool-adapters.ts` (361)
- `apps/server/src/tools/tool-views.ts` (54) → `apps/server/src/tools/queries.ts` (334)
- `apps/server/src/tools/deletes.ts` (60) → `apps/server/src/tools/service.ts` (116)
- `apps/server/src/routines/prompt-routines.ts` (101) → `apps/server/src/tools/routine-adapters.ts` (354)
- `apps/server/src/app/routes-health.ts` (7) → `apps/server/src/app.ts` (61)
- `apps/server/src/app/routes-media.ts` (59) → `apps/server/src/app.ts` (61)
- `apps/server/src/app/routes-ai.ts` (108) → `apps/server/src/app.ts` (61)
- `apps/server/src/chats/ai-entries.ts` (24) → `apps/server/src/chats/list-handler.ts` (237)
- `apps/server/src/chats/unread-skip.ts` (47) → `apps/server/src/chats/unread.ts` (254)
- `apps/server/src/chats/mark-handlers.ts` (85) → `apps/server/src/chats/api.ts` (92)
- `apps/server/src/sandbox/run-tool-schemas.ts` (60) → `apps/server/src/sandbox/run-tool.ts` (341)
- `apps/server/src/sandbox/types.ts` (72) → `apps/server/src/sandbox/run-tool.ts` (341)
- `apps/server/src/sandbox/tool-prelude.ts` (93) → `apps/server/src/sandbox/tool-worker.ts` (285)
- `apps/server/src/roles/sync.ts` (48) → `apps/server/src/roles/service.ts` (369)
- `apps/server/src/roles/private-topic-guard.ts` (49) → `apps/server/src/roles/service.ts` (369)
- `apps/server/src/config/mail.ts` (69) → `apps/server/src/config/load.ts` (169)
- `apps/server/src/config/schema-helpers.ts` (100) → `apps/server/src/config/server-schema.ts` (136)
- `apps/server/src/media/items.ts` (78) → `apps/server/src/media/api.ts` (267)
- `apps/server/src/media/rows.ts` (105) → `apps/server/src/media/indexer.ts` (331)
- `apps/server/src/ai/model-errors.ts` (112) → `apps/server/src/ai/model-client.ts` (238)
- `apps/server/src/ai/model-prompt.ts` (114) → `apps/server/src/ai/model-client.ts` (238)
- `apps/server/src/voice/routes.ts` (13) → `apps/server/src/voice/api.ts` (116)
- `apps/server/src/integrations/settings.ts` (64) → `apps/server/src/integrations/routes.ts` (171)
- `apps/server/src/gifs/token.ts` (68) → `apps/server/src/gifs/api.ts` (342)
- `apps/server/src/auth/me-view.ts` (85) → `apps/server/src/auth/api.ts` (286)
- `apps/server/src/search/archive-query.ts` (107) → `apps/server/src/search/routes.ts` (296)

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
- `apps/server/src/agents/context-edits.ts`
- `apps/server/src/agents/context.ts`
- `apps/server/src/agents/failure-class.ts`
- `apps/server/src/agents/gateway.ts`
- `apps/server/src/agents/gateway/addressing.ts`
- `apps/server/src/agents/gateway/approval-follow-up.ts`
- `apps/server/src/agents/gateway/card-rekey.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/group-ingest.ts`
- `apps/server/src/agents/gateway/group-turn-access.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/agents/gateway/memory.ts`
- `apps/server/src/agents/gateway/pending.ts`
- `apps/server/src/agents/gateway/request-action.ts`
- `apps/server/src/agents/gateway/room-limits.ts`
- `apps/server/src/agents/gateway/routine-send.ts`
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/agents/gateway/turn-defect.ts`
- `apps/server/src/agents/gateway/typed-mention.ts`
- `apps/server/src/agents/group-turn-deps.ts`
- `apps/server/src/agents/group-turn.ts`
- `apps/server/src/agents/handoff.ts`
- `apps/server/src/agents/log/api.ts`
- `apps/server/src/agents/log/read.ts`
- `apps/server/src/agents/memory/compaction.ts`
- `apps/server/src/agents/memory/compactor.ts`
- `apps/server/src/agents/reply-mention.ts`
- `apps/server/src/agents/tool-exec.ts`
- `apps/server/src/agents/tools/blocks-tool.ts`
- `apps/server/src/agents/tools/definitions.ts`
- `apps/server/src/agents/tools/desk-definitions.ts`
- `apps/server/src/agents/tools/media-tool.ts`
- `apps/server/src/agents/tools/reply-lines.ts`
- `apps/server/src/ai/model-client.ts`
- `apps/server/src/ai/model-errors.ts`
- `apps/server/src/ai/model-prompt.ts`
- `apps/server/src/app.ts`
- `apps/server/src/app/routes-ai.ts`
- `apps/server/src/app/routes-health.ts`
- `apps/server/src/app/routes-media.ts`
- `apps/server/src/auth/api.ts`
- `apps/server/src/auth/me-view.ts`
- `apps/server/src/chats/ai-entries.ts`
- `apps/server/src/chats/api.ts`
- `apps/server/src/chats/list-handler.ts`
- `apps/server/src/chats/mark-handlers.ts`
- `apps/server/src/chats/unread-skip.ts`
- `apps/server/src/chats/unread.ts`
- `apps/server/src/config/load.ts`
- `apps/server/src/config/mail.ts`
- `apps/server/src/config/schema-helpers.ts`
- `apps/server/src/config/server-schema.ts`
- `apps/server/src/gifs/api.ts`
- `apps/server/src/gifs/token.ts`
- `apps/server/src/integrations/routes.ts`
- `apps/server/src/integrations/settings.ts`
- `apps/server/src/media/api.ts`
- `apps/server/src/media/indexer.ts`
- `apps/server/src/media/items.ts`
- `apps/server/src/media/rows.ts`
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/push/api-test.ts`
- `apps/server/src/push/component.ts`
- `apps/server/src/push/failure-reason.ts`
- `apps/server/src/push/notification.ts`
- `apps/server/src/push/preview-delivered.ts`
- `apps/server/src/push/store-save.ts`
- `apps/server/src/push/subscriptions.ts`
- `apps/server/src/roles/private-topic-guard.ts`
- `apps/server/src/roles/service.ts`
- `apps/server/src/roles/sync.ts`
- `apps/server/src/routines/message-store.ts`
- `apps/server/src/routines/prompt-routines.ts`
- `apps/server/src/sandbox/run-tool-schemas.ts`
- `apps/server/src/sandbox/run-tool.ts`
- `apps/server/src/sandbox/tool-prelude.ts`
- `apps/server/src/sandbox/tool-worker.ts`
- `apps/server/src/sandbox/types.ts`
- `apps/server/src/search/archive-query.ts`
- `apps/server/src/search/routes.ts`
- `apps/server/src/tools/deletes.ts`
- `apps/server/src/tools/queries.ts`
- `apps/server/src/tools/routine-adapters.ts`
- `apps/server/src/tools/routine-list-lines.ts`
- `apps/server/src/tools/service.ts`
- `apps/server/src/tools/tool-adapters.ts`
- `apps/server/src/tools/tool-views.ts`
- `apps/server/src/topics/access.ts`
- `apps/server/src/topics/ai-access.ts`
- `apps/server/src/topics/api.ts`
- `apps/server/src/topics/general-ais.ts`
- `apps/server/src/topics/preview.ts`
- `apps/server/src/topics/room-sync.ts`
- `apps/server/src/topics/rooms.ts`
- `apps/server/src/topics/types.ts`
- `apps/server/src/voice/api.ts`
- `apps/server/src/voice/routes.ts`
- `apps/server/src/agents/context-edits.test.ts`
- `apps/server/src/agents/gateway-group.test.ts`
- `apps/server/src/agents/gateway/approval-follow-up.test.ts`
- `apps/server/src/agents/gateway/group-turn-access.test.ts`
- `apps/server/src/agents/gateway/typed-mention.test.ts`
- `apps/server/src/agents/group-turn-card.test.ts`
- `apps/server/src/agents/handoff.test.ts`
- `apps/server/src/agents/log/log.test.ts`
- `apps/server/src/agents/reply-mention.test.ts`
- `apps/server/src/agents/tools/desk-definitions.test.ts`
- `apps/server/src/agents/tools/tool-params.test.ts`
- `apps/server/src/ai/model-client.test.ts`
- `apps/server/src/chats/unread.test.ts`
- `apps/server/src/message-blocks/guide.test.ts`
- `apps/server/src/message-blocks/respond.test.ts`
- `apps/server/src/routines/alert-link-create.test.ts`
- `apps/server/src/routines/blocks-post.test.ts`
- `apps/server/src/routines/message-store.test.ts`
- `apps/server/src/routines/mine.test.ts`
- `apps/server/src/routines/prompt-routines.test.ts`
- `apps/server/src/routines/topic-routines.test.ts`
- `apps/server/src/sandbox/run-tool.test.ts`
- `apps/server/src/topics/preview.test.ts`
- `work/T-2107-fold-server-a.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 119 lower.

---

## Report (written by the worker when done)

### What I did

Folded all 56 rows in the task, so all 56 single-use files are gone. Each small
file's body moved into its importer, the imports of the small module were removed,
and the imports of both files were merged per module (type-only specifiers kept
type-only). Tests and fixtures that imported a folded file now import the same
names from the importer; 23 test files were re-pointed.

Rows folded through a chain still end in one file: `memory/compaction.ts` and
`memory/compactor.ts` both ended up in `agents/gateway/memory.ts`, the only
importer of `compactor.ts`. `topics/types.ts` and `topics/ai-access.ts` both ended
up in `topics/access.ts`.

No row was skipped: no importer crossed 800 lines (the largest is
`topics/api.ts` at 507), no small file was loaded lazily, no small file is named
by a config or entry point, and no fold created an import cycle (all folded
imports were removed, so several cycles went away).

Numbers: 56 files deleted, 3,742 lines removed with them; product (non-test)
lines +3,597 −3,906 = **309 lower**. Test files +26 −26.

### Checks run

```text
pnpm gate
gate: 123 changed file(s) against main
PASS  install (frozen)  (2.2s)
PASS  format  (2.9s)
PASS  lint  (2.4s)
PASS  typecheck  (8.8s)
PASS  effect  (13.0s)
PASS  build @zilar/server  (2.7s)
PASS  tests @zilar/server  (240.2s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

I did not run any test file on its own; the final gate ran the nearest tests of
`@zilar/server` (240.2s) and they passed. Earlier gate runs failed and were fixed:
format (a mangled re-export in `sandbox/run-tool.ts`), lint (unused names in
`memory.ts` and `store-save.ts`, a duplicate `LiveSession`), and typecheck
(cross-directory relative paths, a duplicate `escapeRegExp`, a value/type import
mismatch for `Tool`, and the `ChatListEntry` self-import).

### Notes for the lead

- Cross-directory folds needed their relative imports re-based to the importer's
  directory: `tools/reply-lines.ts` → `gateway/tool-exec.ts`, `memory/compactor.ts`
  and `memory/compaction.ts` → `gateway/memory.ts`, `routines/message-store.ts` →
  `gateway/routine-send.ts`, `gateway/approval-follow-up.ts` → `gateway.ts`,
  `routines/prompt-routines.ts` → `tools/routine-adapters.ts`, and
  `app/routes-{ai,media,health}.ts` → `app.ts`.
- Two names stay exported although nothing imports them now: `compactMemory`
  (`gateway/memory.ts`) and `NativePushToken` (`push/store-save.ts`). Both were
  exported before; without `export` lint reports them as unused declarations.
  Every other folded name that no other file imports lost its `export`.
- `topics/access.ts` was rebuilt by hand after an intermediate fold replaced its
  body; I checked every HEAD declaration of the importer and of both folded files
  is present in the final file.


## Review (written by Claude)

Approved; the pre-review was clean (3 nits, 2 follow-ups: stale path comments in `auth/export.ts:233` and `agents/gateway/approval-on-decided.ts:2`, outside scope). Net −309; 56 single-use server files folded into their only importer.
- **Lead check** (`tmp/cc/dangling.py`): no file in `apps/`, `packages/` or `scripts/` still references any of the 56 deleted paths. That includes cross-package imports like the runner's, which broke T-2108's first round. The gate ran the server tests and they passed.
