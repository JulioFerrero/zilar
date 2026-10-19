---
id: T-2131
title: "Share (web + phone): one integrations, voice transcription, audit, machines and message-block API in client-core (make…Api(call) over the contract client, contract types) used by both apps — each app keeps its module names, only the transport differs"
status: merged
milestone: M5
branch: task/T-2131-api-settings
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2131: One integrations, voice transcription, audit, machines and message-block API for web and phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count must really go down, and web and phone share code. Both apps call the same contract endpoints through hand-written wrappers (phone `lib/*-api.ts` still 2167 lines, web `lib/api/*` 999). Both apps already have the derived contract client: `ZilarClient` in `packages/api-contract/src/client.ts`.

### The pattern to copy (already merged)
- `packages/client-core/src/topics-api.ts` and `packages/client-core/src/groups-api.ts`: `makeTopicsApi(call)` and `makeGroupsApi(call)` take
  ```ts
  call: <A>(f: (client: ZilarClient) => Effect<A, …>) => Promise<A>
  ```
  and return the Promise functions, with normalisation living once.
- **Web** (`apps/web/src/lib/api/topics.ts`): `const api = makeTopicsApi(callApi)`, then it exports the same function names as before.
- **Phone** (`apps/mobile/src/lib/topics-api.ts`): `makeTopicsApi((call) => runApi(call(client)))` inside its `create…Api(getToken, fetch, url)`.

### Facts (read by the lead on 2026-10-19 at `4c75de378`)
- **Web:**
  - `apps/web/src/lib/api/settings.ts`: integrations `getIntegrationsStatus` `:19`, `saveTelegramBotToken` `:23`, `removeTelegramBotToken` `:29`, `saveEmailSettings` `:38`; voice transcription `:52-82`; audit `listAudit` `:101`. Setup (`:126` on) stays.
  - `apps/web/src/lib/api.ts`: machines `listMachines` `:56`, `createPairingCode` `:60`, `approveMachine` `:64`, `denyMachine` `:68`, `revokeMachine` `:72`, `renameMachine` `:76`, `deleteMachine` `:83`.
  - `apps/web/src/lib/api/blocks.ts`: `respondToBlock` `:12` and `myBlockPicks` `:24`.
- **Phone:** the same calls in `apps/mobile/src/lib/integrations-api.ts` (108 lines; its `createIntegrationsApi` is at `:60`), `machines-api.ts` (61; `createMachinesApi` `:31`), `audit-api.ts` (58; `createAuditApi` `:26`) and `blocks-api.ts` (35).
- **Phone importers** that must compile unchanged:
  - integrations: `app/settings/integrations.tsx`, `components/integrations/{email-card,telegram-card,voice-card}.tsx`, `components/integrations/use-card-actions.ts`;
  - machines: `app/ais/[id].tsx`, `app/settings/machines.tsx`, `components/ais/new-ai/use-new-ai-flow.ts`, `components/machines/{approved-machines,machine-row}.tsx`, `components/machines/{mutations,use-machines-api,use-machines-list}.ts`;
  - audit: `components/ais/ai-activity.tsx`, `components/ais/use-audit-api.ts`;
  - blocks: `components/chat/blocks/{block-card,poll-block}.tsx`.

### Steps
1. **The shared module.** Create `packages/client-core/src/settings-api.ts` exporting `make…Api(call)`. It holds every call both apps make, plus any call only one app makes in this area, using contract types from `@zilar/api-contract` (`ZilarClient` and the row types).
2. **The barrel.** Add ONE line `export * from './<file>';` to `packages/client-core/src/index.ts` **directly after** the line `export * from './chat-extras-api';`, not at the end. Other tasks append elsewhere, so this keeps merges clean.
3. **Web.** The web module builds the API with `callApi` and keeps exporting the **same names**, so its importers do not change. Types it exported become aliases of the contract types.
4. **Phone.** Its `create…Api(getToken, fetchImpl, apiUrl)` keeps its signature and returns the shared object. Phone-only parsing and type copies of contract rows go; keep the exported type names as aliases.
5. **Users.** Users of both modules must compile unchanged. If one cannot, report BLOCKED with its path; the lead adds it.
6. **Tests.** No new tests. Existing tests of these modules must pass; adapt them only where a deleted hand-written parser was what they tested.
7. **Size.** Report the line counts. Product lines must go down by at least 150.

### Allowed files
- `packages/client-core/src/settings-api.ts`
- `apps/web/src/lib/api/settings.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/api/blocks.ts`
- `apps/mobile/src/lib/integrations-api.ts`
- `apps/mobile/src/lib/machines-api.ts`
- `apps/mobile/src/lib/audit-api.ts`
- `apps/mobile/src/lib/blocks-api.ts`
- `packages/client-core/src/index.ts`
- `work/T-2131-api-settings.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 150 lower.
- **Lead check:** web mock: `/settings/integrations` shows the cards, `/settings/machines` lists dev-mac, an AI's activity log lists entries, and a poll in a chat takes a vote; phone emulator: `/settings/integrations`, `/settings/machines`, and a poll vote.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/settings-api.ts` with `makeIntegrationsApi(call)`, `makeMachinesApi(call)`, `makeAuditApi(call)` and `makeBlocksApi(call)`, using contract types and the derived `ZilarClient`. Normalisation lives there: trimmed secrets, the audit query/page shape, machine list spreading, and the `BlocksData` decode (`ApiError(200, 'invalid_response', …)`).
- Added the single barrel line `export * from './settings-api';` directly after `export * from './chat-extras-api';`.
- Web (`apps/web/src/lib/api/settings.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/api/blocks.ts`) now builds those APIs with `callApi` and exports the same names. Exported types are aliases/re-exports of the shared and contract types.
- Phone (`apps/mobile/src/lib/{integrations,machines,audit,blocks}-api.ts`) keeps each `create…Api(getToken, fetchImpl, apiUrl)` signature and returns the shared object. The phone-only raw requests for voice transcription are gone (those routes are in the contract), as are the hand-written block decoder and type copies. `setAiMachine` stays hand-written because its route is outside the contract by design.
- Files changed: `packages/client-core/src/settings-api.ts` (new), `packages/client-core/src/index.ts`, the three web files and the four phone files listed in Allowed files.

### Checks run

- `pnpm install` — completed in 24.6s.
- `pnpm gate` — GATE PASS. Summary:
  - `PASS install (frozen) (1.0s)`
  - `PASS format (1.1s)`
  - `PASS lint (0.7s)`
  - `PASS typecheck (2.3s)`
  - `PASS effect (0.5s)`
  - `PASS build @zilar/server (0.5s)`
  - `PASS tests @zilar/client-core (2.6s)`
  - `PASS tests @zilar/mobile (1.5s)`
  - `PASS tests @zilar/web (2.9s)`
  - `scope: every changed file is inside the Allowed files`
- Product line count: 337 deletions and 56 additions in the tracked allowed files, plus the new 121-line shared module, for a net **−160** lines.
- I ran no separate single-file tests: no test file targets these modules directly, and the gate ran the client-core, mobile and web suites.

### Notes for the lead

- Phone voice transcription now goes through the contract client instead of `rawRequest`; the contract already declares those routes and the request bodies are unchanged apart from `omitUndefined`.
- Removed the unused phone-only `buildSaveEmailBody` / `buildSaveVoiceBody` helpers; nothing imported them.
- Web still re-exports `IntegrationsStatus`, `PublicAuditEntry`, `AuditScope`, `ListAuditInput`, `ListAuditPage`, `SaveEmailSettingsInput` and `SaveVoiceTranscriptionInput`; phone keeps `IntegrationsStatus`, the integration row types, `AuditApi`, `AuditPage`, `AuditResult`, `AuditCost` and the save-input types.
- UI smoke checks (web cards, machines list, activity log, poll vote; phone settings and poll vote) were not run by me; they remain for the lead.


## Review (written by Claude)

Approved; the pre-review was clean (0 nits). Net −160: `packages/client-core/src/settings-api.ts` (121) replaces the hand-written integrations, voice transcription, audit, machines and message-block calls in the web's `lib/api/settings.ts`, `lib/api.ts` and `lib/api/blocks.ts` and in the phone's `integrations-api`, `machines-api`, `audit-api` and `blocks-api`.
- **Web mock** (`:5252`, no page errors):
  - `/settings/integrations` shows the Email card ("Connected");
  - `/settings/machines` lists office-linux (pending, with its code) and dev-mac;
  - Dev team → Group info → Activity lists "A request was approved" and "A request was denied".
- **Phone emulator:** the smoke passed (`/settings/integrations`, `/settings/machines`, `/ais/ai-dev-1`). Approving office-linux moves it from the pending card into the machine list.
