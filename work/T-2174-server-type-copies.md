---
id: T-2174
title: "One name per shape (server): types and interfaces declared twice with identical fields get one declaration; no behaviour change"
status: merged
milestone: M5
branch: task/T-2174-server-type-copies
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2174: One declaration per type shape (server)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and a codebase people and AIs can search. The lead scanned every `interface` and `type X = {…}` at `74a5ec178`. Each row below is a group whose fields are identical once sorted, though the names may differ. Line numbers are where each declaration starts.

| # | Declarations |
| --- | --- |
| 1 | `apps/server/src/agents/delegation/service.ts:56` `DelegationView`<br>`apps/server/src/agents/delegation/service.ts:218` `DelegationRow` |
| 2 | `apps/server/src/chat-prefs/service.ts:183` `BackgroundFieldsInput`<br>`apps/server/src/groups/schemas.ts:152` `BackgroundFieldsInput` |
| 3 | `apps/server/src/chat-prefs/service.ts:176` `BackgroundFields`<br>`apps/server/src/groups/schemas.ts:37` `GroupBackground` |
| 4 | `apps/server/src/agents/tools/definitions.ts:122` `ChatToolDefinition`<br>`apps/server/src/ai/model-client.ts:22` `ModelToolDefinition` |
| 5 | `apps/server/src/blocks/service.ts:26` `BlockedUserView`<br>`apps/server/src/contacts/service.ts:142` `ContactListRow` |
| 6 | `apps/server/src/groups/schemas.ts:117` `AddGroupAiInput`<br>`apps/server/src/groups/schemas.ts:125` `RemoveGroupAiInput` |
| 7 | `apps/server/src/agents/memory/indexer.ts:34` `IndexMemoryResult`<br>`apps/server/src/media/indexer.ts:137` `IndexChatResult` |
| 8 | `apps/server/src/contacts/service.ts:209` `PendingRosterRow`<br>`apps/server/src/search/service.ts:55` `ContactArchiveRow` |
| 9 | `apps/server/src/machines/hub.ts:18` `HubLogger`<br>`apps/server/src/routines/scheduler.ts:18` `RoutineLogger` |
| 10 | `apps/server/src/push/archive-scan.ts:32` `NewestScan`<br>`apps/server/src/push/delivery.ts:112` `ScanResult` |
| 11 | `apps/server/src/roles/schemas.ts:22` `RolesServiceDeps`<br>`apps/server/src/topics/schemas.ts:35` `TopicServiceDeps` |

### Steps
For each row:
1. Read every declaration and its uses.
2. **Same thing:** when the declarations describe the same thing (the same row, input, deps or logger), keep one:
   - keep it in the module that owns that thing, or the one the other file already imports from;
   - delete the others and point every use at the kept name;
   - when one is the exact shape of another module's type, use `typeof`/`Pick`/the other type instead of repeating the fields.
3. **Same fields, different meaning:** skip the row and say why in the Report. For example, an add input and a remove input that only happen to match, or two results of different jobs. Clarity beats one line.

### Rules
- Types only: no runtime code changes.
- Keep every "why" comment, once.
- No new tests.
- Do not touch `apps/server/src/auth/**`.

### Allowed files
- `apps/server/src/agents/delegation/service.ts`
- `apps/server/src/agents/memory/indexer.ts`
- `apps/server/src/agents/tools/definitions.ts`
- `apps/server/src/ai/model-client.ts`
- `apps/server/src/blocks/service.ts`
- `apps/server/src/chat-prefs/service.ts`
- `apps/server/src/contacts/service.ts`
- `apps/server/src/groups/schemas.ts`
- `apps/server/src/machines/hub.ts`
- `apps/server/src/media/indexer.ts`
- `apps/server/src/push/archive-scan.ts`
- `apps/server/src/push/delivery.ts`
- `apps/server/src/roles/schemas.ts`
- `apps/server/src/routines/scheduler.ts`
- `apps/server/src/search/service.ts`
- `apps/server/src/topics/schemas.ts`
- Test files next to those files (import path only).
- Any `apps/server/src/**` file that imports a merged or renamed type, for its import line and type names only (lead fix round: no re-export shims).
- `work/T-2174-server-type-copies.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat -- apps packages`.
- The Report lists each row: merged (which name, where) or skipped (why).

---

## Report (written by the worker when done)

### What I did

Merged 7 of the 11 rows; skipped 4 with reasons below. Types only: no runtime code changed, no new tests, no comments citing task IDs.

| # | Result |
| --- | --- |
| 1 | Merged: kept `DelegationView` in `apps/server/src/agents/delegation/service.ts`; deleted `DelegationRow` and the SQL row cast now uses `DelegationView`. The `timestamptz`/`Date` comment moved onto `updatedAt`. |
| 2 | Merged: kept `BackgroundFieldsInput` in `apps/server/src/groups/schemas.ts` (now exported, with the `undefined`/`null` comment); `chat-prefs/service.ts` imports it. |
| 3 | Merged: kept `GroupBackground` in `apps/server/src/groups/schemas.ts`; deleted `BackgroundFields` and pointed every use in `chat-prefs/service.ts` at `GroupBackground` (`ChatPrefView`, the resolver and the three queries). |
| 4 | Merged: kept one declaration named `ChatToolDefinition`, in `apps/server/src/ai/model-client.ts` (renamed from `ModelToolDefinition`); every importer, including `agents/tools/definitions.ts`, imports it from there. No re-export. |
| 5 | Skipped: `BlockedUserView` is the block-list API view, `ContactListRow` is the join that builds a `Contact`. Same fields today, different lists and different display rules (unnamed fallback, avatar join ordering); one name would mislead. |
| 6 | Skipped: `AddGroupAiInput` and `RemoveGroupAiInput` are inputs of opposite operations that only match today. |
| 7 | Skipped: `IndexMemoryResult` and `IndexChatResult` are results of different indexers (agent memory vs chat media) that only match today. |
| 8 | Skipped: `PendingRosterRow` feeds roster sync, `ContactArchiveRow` feeds search archive permissions. Same contact columns, different jobs; naming one for the other would mislead. |
| 9 | Merged: kept `RoutineLogger` in `apps/server/src/routines/scheduler.ts`; deleted `HubLogger` and `machines/hub.ts` imports `RoutineLogger`. `leader/start.ts` already imports it from there, so no file outside Allowed changed. |
| 10 | Merged: kept `ScanResult` in `apps/server/src/push/archive-scan.ts` (renamed from `NewestScan`); `delivery.ts` and `delivery.test.ts` import it from `./archive-scan`. No re-export. |
| 11 | Merged: kept `TopicServiceDeps` in `apps/server/src/topics/schemas.ts`; `roles/schemas.ts` no longer declares or re-exports it. `roles/service.ts` and `app/routes-messaging.ts` import and use `TopicServiceDeps`. |

Product net from `git diff main --numstat -- apps packages`: **47 insertions, 102 deletions, net -55 lines** across 20 files.

### Checks run

```text
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (0.8s)
PASS  typecheck  (3.0s)
PASS  effect  (0.6s)
PASS  build @zilar/server  (0.5s)
PASS  tests @zilar/server  (38.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
WARN  size: apps/server/src/ai/model-client.ts: 448 lines (main 448); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
WARN  size: apps/server/src/app/routes-messaging.ts: 609 lines (main 615); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
WARN  size: apps/server/src/roles/service.ts: 601 lines (main 601); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

I did not run single test files separately; the gate ran the full `@zilar/server` suite. During the fix round the only gate failure was `format` on `app/routes-messaging.ts` after the import change; `prettier --write` fixed it and the run above passed. No re-export shims remain.

### Notes for the lead

- Row 3 makes `chat-prefs/service.ts` extend `GroupBackground` for chat prefs, because `GroupBackground` is already exported and imported by `chats/api.ts` (outside Allowed), so it had to be the kept name. The shape is right; the name says "group" while chat prefs also use it.
- Row 9 has the same naming trade-off in reverse: `machines/hub.ts` now takes a `RoutineLogger`, because `leader/start.ts` imports that name from `routines/scheduler.ts`. A neutral name in `logger.ts` would need that file allowed.
- Rows 5-8 are the four "same fields, different meaning/job" cases from the spec's own skip guidance; no lines were saved there, by design.
- Fix round: dropped the `RolesServiceDeps`, `ScanResult` and `ChatToolDefinition` re-export shims; every importer now imports the kept name from the declaring module. That accounts for the extra 11 files and the net moving from -45 to -55.
- No security-relevant change: type declarations and imports only, no runtime paths, queries, permissions or logging touched.

## Review (written by Claude)

Approved; the pre-review was clean after one lead fix round. Net −55 across 20 files, types only.

**Merged (7 of 11 groups):**
- `DelegationView`;
- `BackgroundFieldsInput` and `GroupBackground` (groups/schemas);
- `ChatToolDefinition` (ai/model-client);
- `RoutineLogger`, `ScanResult` and `TopicServiceDeps`.

**Skipped, rightly:** four look-alikes with different meanings (block list vs contact list row, add vs remove AI input, two indexer results, roster vs archive rows).

**Fix round:** removed the `RolesServiceDeps` alias and the `ScanResult`/`ChatToolDefinition` re-exports. Every importer now uses the one name.
