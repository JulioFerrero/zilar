---
id: T-2157
title: "One name per type: drop 21 one-line type aliases that only rename a row, contract or shared type (server, phone, web) and the dead protocol Money type; no behaviour change"
status: merged
milestone: M5
branch: task/T-2157-type-aliases
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2157: One name per type

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: a codebase people and AIs can read. Each alias below gives a second name to a type that already has one: a database row in `apps/server/src/db/rows.ts`, a contract type, or a shared type. So a search for one name misses half the uses. The lead listed them at `85129ae55`. Store files and widely used app names (`Topic`, `Me`, `Invite`, `XmppToken`) are left out on purpose.

| File:line | Alias |
| --- | --- |
| `apps/server/src/actions/gateway.ts:211` | `export type DeniedReason = PolicyDenialReason;` |
| `apps/server/src/agents/tool-loop.ts:121` | `export type ChatCompletionResult = ModelCallResult;` |
| `apps/server/src/backgrounds/service.ts:24` | `export type BackgroundRow = ChatBackgroundRow;` |
| `apps/server/src/connections/service.ts:10` | `export type ConnectionRow = ProviderConnectionRow;` |
| `apps/server/src/gifs/api.ts:98` | `export type GifsApiDependencies = GifsRoutesDependencies;` |
| `apps/server/src/machines/api.ts:83` | `export type MachinesLogger = Logger;` |
| `apps/server/src/message-blocks/respond.ts:124` | `export type RespondInput = BlocksRespondPayload;` |
| `apps/server/src/pins/service.ts:24` | `export type PinRow = PinnedMessageRow;` |
| `apps/server/src/pins/service.ts:26` | `export type PinView = Pin;` |
| `apps/server/src/pins/service.ts:30` | `export type CreatePinBody = CreatePinPayload;` |
| `apps/server/src/push/store.ts:11` | `export type PushDeviceRow = PushSubscriptionRow;` |
| `apps/server/src/tools/queries.ts:81` | `export type ToolRow = AiToolRow;` |
| `apps/server/src/tools/queries.ts:82` | `export type VersionRow = AiToolVersionRow;` |
| `apps/server/src/tools/queries.ts:83` | `export type RunRow = AiToolRunRow;` |
| `apps/server/src/tools/service.ts:106` | `export type PublicToolRun = AiToolRunRow;` |
| `apps/mobile/src/app/settings/sticker-pack.tsx:249` | `export type StickerPackScreenDeps = PackEditorDeps;` |
| `apps/mobile/src/components/ais/errors.ts:4` | `export type AisErrorInfo = AiErrorInfo;` |
| `apps/mobile/src/components/chat/message-menu-host.tsx:17` | `export type MessageMenuTarget = BubbleActionsTarget;` |
| `apps/mobile/src/lib/push/native.ts:43` | `export type StoredPushRegistration = Registration;` |
| `apps/mobile/src/lib/stickers-api.ts:12` | `export type TelegramImportResult = SharedTelegramImportResult;` |
| `apps/web/src/lib/media-retry.ts:6` | `export type MediaRetry = MediaRetryResult;` |

Also: `packages/protocol/src/common.ts:95` `export type Money = typeof MoneySchema.Type;` has had no user since `formatMoney` was deleted (T-2152). Delete the type, and keep `MoneySchema`, which `approval.ts` uses.

### Steps
For each alias:
1. Run `git grep -nw <Alias> -- apps packages` to find every use.
2. Replace each use with the defining name, the right-hand side. When that name is not imported yet, import it from where it is defined (`../db/rows`, `@zilar/api-contract`, `@zilar/client-core` and so on). Drop an import that is no longer needed.
3. Delete the alias line.
4. **Name clashes.** If the defining name would clash with a local name in some file, keep the alias in that file and say so in the Report.

### Rules
- Types only: no runtime code changes.
- Do not touch `apps/*/src/store/**`, `apps/*/src/auth/**` or `apps/server/src/auth/**`.
- **Tests.** Change only type names and imports; no new tests.

### Allowed files
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/app/settings/sticker-pack.tsx`
- `apps/mobile/src/components/ais/errors.ts`
- `apps/mobile/src/components/chat/message-menu-host.tsx`
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`
- `apps/mobile/src/lib/push/native.ts`
- `apps/mobile/src/lib/stickers-api.ts`
- `apps/server/src/actions/gateway.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/agents/tool-exec.ts`
- `apps/server/src/agents/tool-loop.ts`
- `apps/server/src/backgrounds/service.ts`
- `apps/server/src/connections/service.ts`
- `apps/server/src/gifs/api.ts`
- `apps/server/src/machines/api.ts`
- `apps/server/src/message-blocks/respond.ts`
- `apps/server/src/pins/service.ts`
- `apps/server/src/push/delivery.test.ts`
- `apps/server/src/push/delivery.ts`
- `apps/server/src/push/store.ts`
- `apps/server/src/routines/execute.ts`
- `apps/server/src/tools/hosts.ts`
- `apps/server/src/tools/mutations.ts`
- `apps/server/src/tools/queries.ts`
- `apps/server/src/tools/routes.ts`
- `apps/server/src/tools/runner.ts`
- `apps/server/src/tools/service.ts`
- `apps/web/src/lib/media-retry.ts`
- `packages/protocol/src/common.ts`
- `work/T-2157-type-aliases.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every row is removed or kept with a reason.
- The Report gives the net from `git diff main --numstat -- apps packages`.

---

## Report (written by the worker when done)

### What I did

Removed all 21 aliases in the spec table plus the dead `Money` type, replacing every use with the defining name. No alias was kept: no defining name clashed with a local name in the files that use it (the `ConnectionRow`, `ToolRow`, `RunRow` and `PinRow` names elsewhere are unrelated local components or import aliases and were left alone).

- Server: `DeniedReason` → `PolicyDenialReason`, `ChatCompletionResult` → `ModelCallResult`, `BackgroundRow` → `ChatBackgroundRow`, `ConnectionRow` → `ProviderConnectionRow`, `GifsApiDependencies` → `GifsRoutesDependencies`, `MachinesLogger` → `Logger`, `RespondInput` → `BlocksRespondPayload`, `PinRow`/`PinView`/`CreatePinBody` → `PinnedMessageRow`/`Pin`/`CreatePinPayload`, `PushDeviceRow` → `PushSubscriptionRow`, `ToolRow`/`VersionRow`/`RunRow`/`PublicToolRun` → `AiToolRow`/`AiToolVersionRow`/`AiToolRunRow`.
- Mobile: `StickerPackScreenDeps` → `PackEditorDeps`, `AisErrorInfo` → `AiErrorInfo`, `MessageMenuTarget` → `BubbleActionsTarget`, `StoredPushRegistration` → `Registration`, `TelegramImportResult` → client-core's `TelegramImportResult` (the local re-export is gone; the import sheet now imports it from `@zilar/client-core`).
- Web: `MediaRetry` → `MediaRetryResult`.
- Protocol: deleted `Money`; `MoneySchema` is untouched.

Imports moved to the defining modules (`../db/rows` for row types, `../ai/model-client` for `ModelCallResult`, `@zilar/chat-core` for `AiErrorInfo`, `@zilar/client-core` for `TelegramImportResult`). `apps/server/src/tools/service.ts` also used the removed `ToolRow` in `deleteTool`, so that use was changed to `AiToolRow`. No runtime code or behaviour changed.

Files changed: 28 under `apps`/`packages`, plus this task file.

### Checks run

- `pnpm install`: completed (17.7s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/delivery.test.ts`: 1 file, 11 tests passed.
- `pnpm gate`: passed after fixing the first runs' formatting, one unused import and two leftover self-alias lines. Summary:

```
gate: 29 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.3s)
PASS  lint  (0.5s)
PASS  typecheck  (3.7s)
PASS  effect  (1.0s)
PASS  build @zilar/server  (0.3s)
PASS  tests @zilar/mobile  (2.3s)
PASS  tests @zilar/protocol  (0.9s)
PASS  tests @zilar/server  (25.8s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

- Net from `git diff main --numstat -- apps packages`: 28 files changed, 106 insertions(+), 163 deletions(-), net -57 lines.

### Notes for the lead

No deviations from the spec. No tests were added: this is a type-only change; the one touched test file was only renamed through. `apps/server/src/push/store.ts` grows by four lines because `PushSubscriptionRow` is longer and Prettier wraps more calls; the gate lists it as a soft-size warning only.

## Review (written by Claude)

Approved; the pre-review was clean (0 findings). All 21 type aliases are removed, and every use now carries the defining name: the `db/rows.ts` row name, the contract name or the shared type. Examples: `PinRow` → `PinnedMessageRow`, `ToolRow` → `AiToolRow`, `MessageMenuTarget` → `BubbleActionsTarget`. The dead protocol `Money` type is gone too, and `MoneySchema` stays.

Net −57, types only, no runtime line changed. The gate typechecked every package.
