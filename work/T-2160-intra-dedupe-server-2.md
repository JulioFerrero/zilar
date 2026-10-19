---
id: T-2160
title: "Clean-up (server, wave 2): repeated blocks inside one file become one helper or one loop; no behaviour change"
status: merged
milestone: M5
branch: task/T-2160-intra-dedupe-server-2
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2160: One copy of each block repeated inside a file (server, wave 2)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead scanned each file at `9766414d5` for runs of 6 or more normalised lines (comments, blanks, imports and lone braces ignored) that appear twice or more in the same file. The ranges below are where the copies sit; the groups are separated by `;`.

| File (lines) | Repeated ranges |
| --- | --- |
| `apps/server/src/groups/api.ts` (563) | 161-168, 176-183 ; 204-211, 219-226, 234-241, 249-255 ; 417-423, 541-547 |
| `apps/server/src/chats/unread.ts` (416) | 320-329, 374-383 ; 332-338, 385-391 ; 353-358, 403-408 |
| `apps/server/src/chat-folders/service.ts` (343) | 118-124, 270-276, 311-317 ; 151-156, 218-223 ; 272-277, 313-318 |
| `apps/server/src/tools/routes.ts` (519) | 237-244, 333-340 ; 395-402, 440-447 |
| `apps/server/src/tools/routine-adapters.ts` (429) | 303-309, 339-345 ; 355-372, 396-413 |
| `apps/server/src/search/routes.ts` (406) | 70-82, 100-112 |
| `apps/server/src/stickers/storage.ts` (363) | 130-139, 168-177 |
| `apps/server/src/groups/queries.ts` (348) | 149-155, 327-333 ; 26-33, 147-154, 325-332 |
| `apps/server/src/routines/support.ts` (338) | 155-164, 193-202 ; 239-244, 278-283 |
| `apps/server/src/tools/mutations.ts` (311) | 112-123, 152-163 |
| `apps/server/src/handles/store.ts` (265) | 53-63, 92-102 |
| `apps/server/src/machines/machines.ts` (184) | 84-89, 151-156 ; 99-107, 168-176 |
| `apps/server/src/roles/service.ts` (602) | 172-177, 363-368 ; 493-498, 547-552 ; 99-107, 299-307 |
| `apps/server/src/setup/api.ts` (372) | 254-273, 306-325 |
| `apps/server/src/machines/api.ts` (362) | 159-164, 181-186, 201-206, 253-258 ; 160-166, 182-188 |
| `apps/server/src/chat-prefs/service.ts` (315) | 96-104, 269-277 |
| `apps/server/src/integrations/api.ts` (259) | 58-64, 89-95 ; 66-74, 107-115 |

### Steps
For each group, read every copy:
1. **Same code:** keep one copy, as a local helper, a shared row-to-view mapper, a loop over a small table, or a shared JSX piece in the same file. Make the other places use it.
2. **Same shape, different data:** pass the difference as a parameter only when the result is shorter. Otherwise skip the group.
3. **A call site, not a copy:** skip the group when the repeat is only a call site or a destructure.
4. **Keep the sum smaller:** a helper must save more lines than it adds. If it doesn't, revert it and say so in the Report.

### Rules
- No behaviour change: the same SQL, the same values and order, the same log texts, the same markup, labels and styles.
- Keep every "why" comment, once.
- No new tests. Run the nearest existing tests with `--reporter=dot`.
- Do not touch `apps/server/src/auth/**` or `apps/server/src/agents/**`.

### Allowed files
- `apps/server/src/groups/api.ts`
- `apps/server/src/chats/unread.ts`
- `apps/server/src/chat-folders/service.ts`
- `apps/server/src/tools/routes.ts`
- `apps/server/src/tools/routine-adapters.ts`
- `apps/server/src/search/routes.ts`
- `apps/server/src/stickers/storage.ts`
- `apps/server/src/groups/queries.ts`
- `apps/server/src/routines/support.ts`
- `apps/server/src/tools/mutations.ts`
- `apps/server/src/handles/store.ts`
- `apps/server/src/machines/machines.ts`
- `apps/server/src/roles/service.ts`
- `apps/server/src/setup/api.ts`
- `apps/server/src/machines/api.ts`
- `apps/server/src/chat-prefs/service.ts`
- `apps/server/src/integrations/api.ts`
- `work/T-2160-intra-dedupe-server-2.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat`.
- The Report lists each group: merged (lines saved) or skipped (why).

---

## Report (written by the worker when done)

### What I did

Merged the repeated blocks that got shorter, and skipped the rest. Product net:
**−79 lines** (`git diff main --numstat`: 272 additions, 351 deletions over 6 files).
Per file: `chat-folders/service.ts` −26, `chats/unread.ts` −15, `groups/queries.ts` −10,
`machines/api.ts` −7, `routines/support.ts` −18, `tools/routes.ts` −3.

| File / group | Result |
| --- | --- |
| `groups/api.ts` 161-168, 176-183 | Skipped: the two handlers call different services with different payload fields; a wrapper would restate them. |
| `groups/api.ts` 204-211, 219-226, 234-241, 249-255 | Skipped: four different services and payload keys; a factory needs the request shape and adds lines. |
| `groups/api.ts` 417-423, 541-547 | Skipped: extracting the audit skeleton with seven parameters saved about four lines, below the bar. |
| `chats/unread.ts` 320-329, 374-383 and 332-338, 385-391 | Merged into `buildScopeParams` (parameter list plus the per-chat loop). |
| `chats/unread.ts` 353-358, 403-408 | Merged into `ARCHIVE_LATERAL`; the extra `AND timestamp > scope.mark` stays inline. |
| `chat-folders/service.ts` 118-124, 270-276, 311-317 | Merged into `folderTransaction` (runSql, transaction and advisory lock). |
| `chat-folders/service.ts` 151-156, 218-223 | Merged into `folderTransaction`. |
| `chat-folders/service.ts` 272-277, 313-318 | Merged into `folderTransaction`. |
| `tools/routes.ts` 237-244, 333-340 | Merged into `recordToolAudit`; the `tool.deleted` block at 277-284 uses it too. |
| `tools/routes.ts` 395-402, 440-447 | Merged: `toRevertWire` spreads `toVersionListWire`. |
| `tools/routine-adapters.ts` 303-309, 339-345 | Skipped: trailing create-call arguments (userId, alertCard, audit spread); no helper shorter than the copies. |
| `tools/routine-adapters.ts` 355-372, 396-413 | Tried a shared `routineTargetAdapter` factory; it grew the file by 4 lines, so reverted. |
| `search/routes.ts` 70-82, 100-112 | Tried `buildPaging`/`buildScope`; it grew the file by 5 lines, so reverted. |
| `stickers/storage.ts` 130-139, 168-177 | Tried a `loadPack` helper; it grew the file by 2 lines, so reverted. |
| `groups/queries.ts` 149-155, 327-333 | Merged: `listMembersForViewer` calls the existing `requireGroup`. |
| `groups/queries.ts` 26-33, 147-154, 325-332 | Merged into `loadGroupRow`, used by `getGroupDetail` and `requireGroup`. |
| `routines/support.ts` 155-164, 193-202 | Merged into `findRoutineRow`. |
| `routines/support.ts` 239-244, 278-283 | Merged into `recordRoutineAudit`; pause, resume and delete all use it. |
| `tools/mutations.ts` 112-123, 152-163 | Skipped: `appendVersion` call sites with local values; a wrapper is not shorter. |
| `handles/store.ts` 53-63, 92-102 | Tried a `checkHandle` helper; it added 7 lines, so reverted. |
| `machines/machines.ts` 84-89, 151-156 | Tried a `firstMachineRow` helper; it added 5 lines, so reverted. |
| `machines/machines.ts` 99-107, 168-176 | Reverted with the wrapper above. |
| `roles/service.ts` 172-177, 363-368 | Skipped: transaction wrapper; callback typing and scaffolding offset the saving. |
| `roles/service.ts` 493-498, 547-552 | Tried `loadGroupRoles`; break-even, so reverted with the next group. |
| `roles/service.ts` 99-107, 299-307 | Tried `syncTopicQuietly`; the combined change added 2 lines, so reverted. |
| `setup/api.ts` 254-273, 306-325 | Skipped: the outer wrapper is 13 lines but the callbacks differ and the scaffolding offsets it. |
| `machines/api.ts` 159-164, 181-186, 201-206, 253-258 | Merged into `requireOwnedMachine` (write limit, owned lookup, 404). |
| `machines/api.ts` 160-166, 182-188 | Covered by `requireOwnedMachine`; the status checks stay route-specific. |
| `chat-prefs/service.ts` 96-104, 269-277 | Tried `deleteIfPresent`; it added 9 lines, so reverted. |
| `integrations/api.ts` 58-64, 89-95 | Skipped: an owner-guard helper needs the request/response types and saves no lines. |
| `integrations/api.ts` 66-74, 107-115 | Tried `rateLimitResponse`; it added 4 lines, so reverted. |

### Checks run

- `pnpm install` — done at the start.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/unread.test.ts src/groups/ownership.test.ts src/roles/roles.test.ts src/tools/routine-schedule-prompt.test.ts src/search/routes.test.ts src/routines/topic-routines.test.ts src/chat-prefs/unread-mark.test.ts src/stickers/pack-link.test.ts` — 8 files, 59 tests passed.
- `pnpm gate` (final) —

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.1s)
PASS  lint  (0.6s)
PASS  typecheck  (0.7s)
PASS  effect  (0.4s)
PASS  build @zilar/server  (0.5s)
PASS  tests @zilar/server  (17.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
WARN  size: apps/server/src/tools/routes.ts: 515 lines (main 518); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Notes for the lead

- No behaviour change: same SQL text and parameter order, same values, log texts, markup and audit fields. The existing unread tests pass.
- Several attempted merges were reverted because the helper made the file longer: `routineTargetAdapter`, `buildPaging`/`buildScope`, `loadPack`, `checkHandle`, `firstMachineRow`, `loadGroupRoles`/`syncTopicQuietly`, `deleteIfPresent`, `rateLimitResponse`.
- No new tests or dependencies. `apps/server/src/tools/routes.ts` stays over the 400-line soft limit (515, down from 518).

## Review (written by Claude)

Approved; the pre-review was clean (1 nit: the Report's add/delete counts are off by one; the net is right). Net −79 across six server files: chat-folders/service.ts chats/unread.ts groups/queries.ts machines/api.ts routines/support.ts tools/routes.ts . The other rows were skipped as call sites or as not shorter. No comment was lost. The gate ran the server tests, and the lead runs the route probe after the push.
