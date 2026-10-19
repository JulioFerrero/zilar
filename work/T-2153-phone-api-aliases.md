---
id: T-2153
title: "Phone: delete nine API modules that only rename the shared client (audit, integrations, connections, invites, AI memory, tools, AIs, directory, approvals) — screens use the shared API and the contract's own type names; no behaviour change"
status: merged
milestone: M5
branch: task/T-2153-phone-api-aliases
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2153: One name per thing: phone screens use the shared API directly

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and a codebase people and AIs can read. Since T-2134, phone screens call `useApi(make)` (`apps/mobile/src/lib/use-mockable-api.ts`). It takes any module-level `make(call, transport)`, and the shared `make<Area>Api(call)` modules in `@zilar/client-core` fit as they are.

The nine modules below add no logic. Each holds only some of:
- type re-exports, some renamed (`AiMemoryView as AiMemory`);
- `ReturnType`/`Pick` aliases;
- an interface plus an adapter that hands back the shared methods under other names (`getMemory: api.getAiMemory`).

So one thing has two names. AGENTS.md's rule is "no barrels in apps: import from the module that defines the name". The lead read all nine at `a11878682`. No store file imports any of them.

| Module (`apps/mobile/src/lib/`) | What it holds today |
| --- | --- |
| `audit-api.ts` | type re-exports only |
| `integrations-api.ts` | type re-exports and `IntegrationsApi = ReturnType<typeof makeIntegrationsApi>` |
| `connections-api.ts` | `ProviderConnection = Connection`, re-exports, a `ConnectionsApi` interface |
| `invites-api.ts` | `Invite = AuthInvite`, `InvitesApi` and `makeInvitesApi` picking `createInvite` from `makeChatsApi` |
| `ai-memory-api.ts` | `AiMemoryApi`, `makeAiMemoryApi` renaming `getAiMemory`/`forgetAiMemoryFact`/`clearAiMemory` from `makeChatExtrasApi` |
| `tools-api.ts` | re-exports, three derived types (`RoutinePausedReason`, `RoutineLastStatus`, `RoutineStatus`), four `Pick` aliases of `makeToolsApi` |
| `ais-api.ts` | re-exports and an `AisApi` interface |
| `directory-api.ts` | re-exports, `DirectoryApi`, `makeDirectoryApi` whose only change is `setGroupVisibility` returning `void` |
| `approvals-api.ts` | re-exports, `ApprovalRuleScope`, `ApprovalsApi = ReturnType<typeof makeApprovalsApi>` |

### Steps
1. **For each module,** find its importers with `git grep -n "lib/<module>'" -- apps/mobile`. Each importer then:
   - imports types from where they are defined (`@zilar/client-core`, `@zilar/api-contract` or `@zilar/chat-core`), under their real names. A renamed alias becomes the real name at every use: `AiMemory` → `AiMemoryView`, `ProviderConnection` → `Connection`, `Invite` → `AuthInvite`.
   - calls `useApi(make<Shared>Api)` with the shared `make` function, and the shared method names: `getAiMemory`, `forgetAiMemoryFact`, `clearAiMemory`, `createInvite`.
   - uses `ReturnType<typeof make<Shared>Api>` where a prop or parameter needs the API's type.
2. **Derived types** (`RoutinePausedReason`, `RoutineLastStatus`, `RoutineStatus`, `ApprovalRuleScope`):
   - used in one file: declare it there;
   - used in several: write the expression at each use, for example `NonNullable<Routine['pausedReason']>`.
3. **Comments.** Carry each "why" comment to where the request is sent:
   - `connections-api.ts`: the key is write-only and the request body must never be logged;
   - `integrations-api.ts`: owner-only, and secrets travel only in the body;
   - `directory-api.ts`: public groups only, and the rate limit.

   Drop the narration ("Errors are the shared `ApiError`…").
4. **Delete** the nine modules.
5. **`directory-api.ts`'s `void` wrapper:** callers that awaited `setGroupVisibility` keep working with the shared method (it resolves a value nobody reads). Check each caller with `git grep -n setGroupVisibility -- apps/mobile`.
6. **Stop and keep a module** if any of these holds, and say why in the Report:
   - something other than its own adapter implements its interface (a fake, a mock or a test);
   - a store file starts importing it;
   - removing it would make an importer longer than the module saved.

### Rules
- No behaviour change: the same requests, the same mock transport (`useApi` already picks it) and the same screens.
- Do not touch `apps/mobile/src/store/**` or `apps/mobile/src/auth/**`.
- Do not touch these modules, which hold real logic or are used by the store:
  - `machines-api.ts`, `search-api.ts`, `blocks-api.ts`;
  - `contacts-api.ts`, `topics-api.ts`, `groups-api.ts`;
  - `profile-api.ts`, `stickers-api.ts`, `gifs-api.ts`;
  - `chat-api.ts`, `auth-api.ts`, `invite-links-api.ts`;
  - `pins-api.ts`, `media-api.ts`, `chat-prefs-api.ts`, `roles-api.ts`, `chat-folders-api.ts`.
- **Tests.** Update imports in the listed tests only; no new tests.
- Product lines go down by at least 100 (`git diff main --numstat -- apps/mobile`).

### Allowed files
- `apps/mobile/src/lib/audit-api.ts`
- `apps/mobile/src/lib/integrations-api.ts`
- `apps/mobile/src/lib/connections-api.ts`
- `apps/mobile/src/lib/invites-api.ts`
- `apps/mobile/src/lib/ai-memory-api.ts`
- `apps/mobile/src/lib/tools-api.ts`
- `apps/mobile/src/lib/ais-api.ts`
- `apps/mobile/src/lib/directory-api.ts`
- `apps/mobile/src/lib/approvals-api.ts`
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/app/ais/[id].tsx`
- `apps/mobile/src/app/at/[handle].tsx`
- `apps/mobile/src/app/explore.tsx`
- `apps/mobile/src/app/group/new.tsx`
- `apps/mobile/src/app/settings/approvals.tsx`
- `apps/mobile/src/app/settings/connections.tsx`
- `apps/mobile/src/app/settings/integrations.tsx`
- `apps/mobile/src/app/settings/routines.tsx`
- `apps/mobile/src/components/ais/ai-activity.tsx`
- `apps/mobile/src/components/ais/ai-memory-section.tsx`
- `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`
- `apps/mobile/src/components/ais/routines-section.tsx`
- `apps/mobile/src/components/ais/tool-detail-body.tsx`
- `apps/mobile/src/components/ais/tool-detail-loader.tsx`
- `apps/mobile/src/components/ais/tools-section.tsx`
- `apps/mobile/src/components/ais/use-routine-actions.ts`
- `apps/mobile/src/components/approvals/always-allowed-row.tsx`
- `apps/mobile/src/components/approvals/rows.test.ts`
- `apps/mobile/src/components/approvals/rows.ts`
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/chat/payload-card.tsx`
- `apps/mobile/src/components/chat/topic-info-host.tsx`
- `apps/mobile/src/components/chat/use-chat-screen.ts`
- `apps/mobile/src/components/chat/use-group-visibility.ts`
- `apps/mobile/src/components/chat/visibility-fields.tsx`
- `apps/mobile/src/components/chat/visibility-sheet.tsx`
- `apps/mobile/src/components/connections/connection-sheet.tsx`
- `apps/mobile/src/components/connections/use-key-check.test.ts`
- `apps/mobile/src/components/directory/explore-helpers.ts`
- `apps/mobile/src/components/directory/handle-helpers.ts`
- `apps/mobile/src/components/group-info/allowed-page.tsx`
- `apps/mobile/src/components/group-info/tools-page.tsx`
- `apps/mobile/src/components/integrations/card-save.ts`
- `apps/mobile/src/components/machines/approved-machines.tsx`
- `apps/mobile/src/components/machines/machine-row.tsx`
- `work/T-2153-phone-api-aliases.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down by at least 100.
- The Report lists each module: deleted, or kept and why.
- **Lead check** (phone emulator smoke):
  - the AIs tab and an AI's edit screen, including its memory, tools and routines;
  - New AI;
  - Settings → Connections → Add key;
  - Settings → Integrations (save);
  - Settings → Approvals and Routines;
  - Explore and a public group's visibility sheet;
  - New chat → Invite;
  - a tool detail.

---

## Report (written by the worker when done)

### What I did

Deleted seven of the nine modules and moved every importer to the shared API and its real type names:

- `audit-api.ts` — deleted. `ai-activity.tsx` uses `AuditApi` from `@zilar/client-core` and `PublicAuditEntry` from `@zilar/api-contract`.
- `integrations-api.ts` — deleted. `integrations.tsx` and `card-save.ts` use `makeIntegrationsApi`/`IntegrationsApi` from `@zilar/client-core` and the four status types from `@zilar/api-contract`.
- `connections-api.ts` — deleted. `ProviderConnection` became `Connection` (from `@zilar/client-core`) in `connections.tsx` and `connection-sheet.tsx`.
- `invites-api.ts` — deleted. `new-chat-button.tsx` builds `makeChatsApi` over `apiCall(realApiTransport)`; the sheet prop is `ReturnType<typeof makeChatsApi>` and still calls `createInvite`. The “invite box talks to the real session API” behaviour is unchanged.
- `ai-memory-api.ts` — deleted. `AiMemory` became `AiMemoryView` (from `@zilar/api-contract`), `AiMemoryApi` became `ReturnType<typeof makeChatExtrasApi>`, and calls use the shared `getAiMemory`, `forgetAiMemoryFact`, `clearAiMemory`. `[id].tsx` and `use-chat-screen.ts` now call `useApi(makeChatExtrasApi)`.
- `ais-api.ts` — deleted. `PublicAi`, `Connection`, `UpdateAiInput` come from `@zilar/client-core`; `AisApi` became `ReturnType<typeof makeAisApi>`.
- `directory-api.ts` — deleted. Every screen/hook imports `makeDirectoryApi` and the types from `@zilar/client-core`/`@zilar/api-contract`. The `void` wrapper is gone; `use-group-visibility.ts` is the only `setGroupVisibility` caller and ignores the now-returned group detail.
- `tools-api.ts` — **kept**: `apps/mobile/src/lib/routines-format.ts:8` imports `Routine`/`ToolListItem` from it, and that file is outside the Allowed files.
- `approvals-api.ts` — **kept**: `apps/mobile/src/lib/approval-state.ts:3` imports `ApprovalDecision`/`ApprovalsApi`/`PublicApproval` from it, and that file is outside the Allowed files.

Those two `lib/*-api.ts` relative imports were not in the spec’s importer grep (which searched only `lib/<module>'`), and both files are outside Allowed files, so deleting the modules would have required edits outside scope. All Allowed importers of those two modules still moved to the shared API and to `ReturnType<typeof makeToolsApi>` / `ReturnType<typeof makeApprovalsApi>`.

No store or auth file was touched. No new tests; only the two existing tests’ imports changed (`use-key-check.test.ts`, `rows.test.ts`).

### Checks run

- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/connections/use-key-check.test.ts src/components/approvals/rows.test.ts` — 2 files passed, 5 tests passed.
- `git diff main --numstat -- apps/mobile` — 123 added, 289 deleted, net **-166** product lines.
- `pnpm gate` (repo root):
  ```
  gate: 44 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.1s)
  PASS  lint  (1.8s)
  PASS  typecheck  (5.0s)
  PASS  effect  (2.7s)
  SKIP build @zilar/server (no server, package or manifest change)
  PASS  tests @zilar/mobile  (3.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```
  The size warnings are the pre-existing files over the soft 400-line limit; none is over 800.

### Notes for the lead

- Two modules remain because of relative imports from `apps/mobile/src/lib/routines-format.ts` and `apps/mobile/src/lib/approval-state.ts`, which are outside the Allowed files. If those two files are added to a follow-up task, `tools-api.ts` and `approvals-api.ts` can then be deleted with no other change.
- The spec’s importer grep only looked for `lib/<module>'`; a `git grep "from '\(\.\./\)*<module>'"`-style search is needed to catch lib-internal relative imports.
- Step 3 (“carry each why comment to where the request is sent”): the shared modules already carry the public-groups-only / rate-limit comment (`packages/client-core/src/directory-api.ts`), the write-only secrets comment (`settings-api.ts`) and the write-only key comment (`api-contract/src/connections.ts`, `chat-core/src/connection-check.ts`). The call sites kept their own “never log the key” comments. The exact “30 per 10 minutes” figure from `directory-api.ts` is not in the shared module; adding it would require editing `packages/client-core`, which is outside Allowed files.
- Behaviour preserved: same requests, same methods, same mock/real transport choices; `createInvite` still uses the real session transport by design.

## Review (written by Claude)

Approved; the pre-review was clean (1 nit, 1 follow-up). Net −166. Seven of nine alias modules are deleted (audit, integrations, connections, invites, AI memory, AIs, directory). Screens now call `useApi(make<Area>Api)` with the shared method names, and use the contract's own type names (`Connection`, `AuthInvite`, `AiMemoryView`).

**Kept:** `tools-api` and `approvals-api`, because an importer is outside scope. They go in the next clean-up.

**Comments:**
- The key write-only / never-log rule and the integrations secrets rule moved to the call sites.
- The "30 per 10 minutes" figure and the "stop answers the fresh AI, so no second GET" comment go in the next clean-up.

**Phone emulator:**
- The smoke passed: `/ais`, AI edit, Connections, Integrations, Approvals, Routines, Explore, group info.
- Rechecked by hand: Edit Dev-1 with its connections, Approvals with Approve/Deny, Routines, Explore with Join.
- An Android "isn't responding" dialog showed on cold start. It came from machine load (Spotlight `mds_stores` at about 200% CPU, load average 16–25) and did not recur after a clean restart. Logcat shows no ANR.
