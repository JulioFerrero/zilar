---
id: T-2134
title: "Phone: one apiCall(transport) and one useApi(make) replace the per-area create…Api(getToken, fetch, url) wrappers and the ten 19-line use…Api hooks — same calls, same mock switch, fewer lines"
status: merged
milestone: M5
branch: task/T-2134-phone-use-api
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2134: One API transport helper and one API hook on the phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead read these at `e4a868766`.

**The wrappers.** Every phone API area repeats the same transport wrapper, e.g. `apps/mobile/src/lib/tools-api.ts:44-51`:
```ts
export function createToolsApi(getToken, fetchImpl = fetch, apiUrl = API_URL): AiToolsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return makeToolsApi((call) => runApi(call(client)));
}
```
23 files in `apps/mobile/src/lib/*-api.ts` have a `create…Api`.

**The hooks.** Ten hooks are each about 19 lines of the same thing, e.g. `apps/mobile/src/components/ais/use-tools-api.ts` (real: `createToolsApi(getSessionToken)`, mock: `createToolsApi(mockToken, mockFetch, API_URL)`, then `useMockableApi(real, mock)`). The ten:
- `use-ai-memory-api`, `use-ais-api`, `use-audit-api`, `use-tools-api` (in `components/ais/`)
- `use-approvals-api` (`components/chat/`)
- `use-connections-api`, `use-directory-api`, `use-machines-api`, `use-profile-api`, `use-stickers-api`

**The store.** The store builds nine wrappers the same way twice:
- real, in `apps/mobile/src/store/effects/ports.ts:268-276` and `apps/mobile/src/store/chat-store-provider.tsx:155-157`;
- mock, in `apps/mobile/src/store/chat-store-provider.tsx:137-145`.

### Steps
1. **One call per transport.** In `apps/mobile/src/lib/effect/api-client.ts`, add `apiCall(transport: ApiTransport)`. It returns the `call` function the shared `make…Api(call)` factories take: `(f) => runApi(f(client))`, with one `createApiClient(transport)` per transport. Export its type; reuse the call type client-core already declares if one fits (`ChatExtrasCall` in `packages/client-core/src/chat-extras-api.ts:43`).
2. **One hook.** In `apps/mobile/src/lib/use-mockable-api.ts`, add `useApi(make)`, where `make` is `(call, transport) => A` and is always a **module-level function**. Real mode uses `{ getToken: getSessionToken, fetchImpl: fetch, apiUrl: API_URL }`; mock mode uses `{ getToken: mockToken, fetchImpl: mockFetch, apiUrl: API_URL }`. It returns `{ api, mock }`.
   - Keep the literal build-time mock guard and the `require` exactly as `useMockableApi` has them (Metro folds the mock out of release builds).
   - Memoise on `[active, make]` only, so the same `api` object survives re-renders. A new object every render would re-run the screens' effects in a loop.
   - Keep `useMockableApi` while any caller still needs it (for example, `components/contacts/use-contacts-api.ts` stays as it is).
3. **Delete the pure wrappers.** A `create…Api` whose body is only `createApiClient` + `make…Api(...)` goes. Its callers use `make…Api(apiCall(transport))` or `useApi(make…Api)`.
   - Keep the type exports and aliases in those files (many screens import the types), and keep any extra call a file adds, such as `setAiMachine` in `lib/machines-api.ts:31-42`.
   - A wrapper with extras becomes one module-level `make` function, e.g. `makePhoneMachinesApi(call, transport)`, that `useApi` and the store can both take.
4. **Delete the ten hooks.** Each screen calls `useApi(make…Api)` (or the file's module-level `make` function) directly. If a hook does more than build the API (for example, `use-profile-api.ts` and `use-stickers-api.ts` are longer), keep only that extra part, or keep the hook and say why in the Report.
5. **The store.** Build one real `call` and one mock `call`, and pass them to each `make…Api`, instead of nine `create…Api(token, fetch, url)` lines per mode. The store's injected `deps.*Api` test seams stay.
6. **Tests.** No new tests. Adapt `apps/mobile/src/lib/media-api.test.ts` only where it called a deleted `create…Api`.

### Rules
- No behaviour change:
  - the same endpoints, token, timeout and mock switch;
  - every screen still gets a stable API object.
- Do not touch `apps/mobile/src/lib/contacts-api.ts`, `apps/mobile/src/components/contacts/use-contacts-api.ts` or `apps/mobile/src/lib/auth-api.ts`; other tasks own them.
- Product lines must go down by at least 250.

### Allowed files
- `apps/mobile/src/lib/effect/api-client.ts`
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/app/(tabs)/settings.tsx`
- `apps/mobile/src/app/ais/[id].tsx`
- `apps/mobile/src/app/at/[handle].tsx`
- `apps/mobile/src/app/explore.tsx`
- `apps/mobile/src/app/group/new.tsx`
- `apps/mobile/src/app/me.tsx`
- `apps/mobile/src/app/settings/approvals.tsx`
- `apps/mobile/src/app/settings/connections.tsx`
- `apps/mobile/src/app/settings/contacts.tsx`
- `apps/mobile/src/app/settings/integrations.tsx`
- `apps/mobile/src/app/settings/machines.tsx`
- `apps/mobile/src/app/settings/routines.tsx`
- `apps/mobile/src/app/stickers/[packId].tsx`
- `apps/mobile/src/app/welcome/handle.tsx`
- `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts`
- `apps/mobile/src/components/ais/require-ais-auth.tsx`
- `apps/mobile/src/components/ais/use-ai-memory-api.ts`
- `apps/mobile/src/components/ais/use-ais-api.ts`
- `apps/mobile/src/components/ais/use-audit-api.ts`
- `apps/mobile/src/components/ais/use-tools-api.ts`
- `apps/mobile/src/components/chat/ais-here-sheet.tsx`
- `apps/mobile/src/components/chat/approval-card.tsx`
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`
- `apps/mobile/src/components/chat/chat-search-results.tsx`
- `apps/mobile/src/components/chat/gif-panel.tsx`
- `apps/mobile/src/components/chat/link-preview-card.tsx`
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/components/chat/new-channel-sheet.tsx`
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/chat/progress-card.tsx`
- `apps/mobile/src/components/chat/sticker-panel.tsx`
- `apps/mobile/src/components/chat/use-approvals-api.ts`
- `apps/mobile/src/components/chat/use-chat-screen.ts`
- `apps/mobile/src/components/chat/use-group-visibility.ts`
- `apps/mobile/src/components/connections/use-connections-api.ts`
- `apps/mobile/src/components/connections/use-key-check.ts`
- `apps/mobile/src/components/directory/use-directory-api.ts`
- `apps/mobile/src/components/group-info/activity-page.tsx`
- `apps/mobile/src/components/group-info/allowed-page.tsx`
- `apps/mobile/src/components/group-info/tools-page.tsx`
- `apps/mobile/src/components/machines/use-machines-api.ts`
- `apps/mobile/src/components/machines/use-machines-list.ts`
- `apps/mobile/src/components/settings/use-profile-api.ts`
- `apps/mobile/src/components/settings/use-profile-settings.ts`
- `apps/mobile/src/components/stickers/require-stickers-auth.tsx`
- `apps/mobile/src/components/stickers/use-pack-editor.ts`
- `apps/mobile/src/components/stickers/use-stickers-api.ts`
- `apps/mobile/src/components/stickers/use-stickers-panel.ts`
- `apps/mobile/src/lib/ai-memory-api.ts`
- `apps/mobile/src/lib/ais-api.ts`
- `apps/mobile/src/lib/approvals-api.ts`
- `apps/mobile/src/lib/audit-api.ts`
- `apps/mobile/src/lib/chat-api.ts`
- `apps/mobile/src/lib/chat-folders-api.ts`
- `apps/mobile/src/lib/chat-prefs-api.ts`
- `apps/mobile/src/lib/connections-api.ts`
- `apps/mobile/src/lib/directory-api.ts`
- `apps/mobile/src/lib/gifs-api.ts`
- `apps/mobile/src/lib/groups-api.ts`
- `apps/mobile/src/lib/integrations-api.ts`
- `apps/mobile/src/lib/invite-links-api.ts`
- `apps/mobile/src/lib/invites-api.ts`
- `apps/mobile/src/lib/machines-api.ts`
- `apps/mobile/src/lib/media-api.test.ts`
- `apps/mobile/src/lib/media-api.ts`
- `apps/mobile/src/lib/pins-api.ts`
- `apps/mobile/src/lib/profile-api.ts`
- `apps/mobile/src/lib/roles-api.ts`
- `apps/mobile/src/lib/search-api.ts`
- `apps/mobile/src/lib/stickers-api.ts`
- `apps/mobile/src/lib/tools-api.ts`
- `apps/mobile/src/lib/topics-api.ts`
- `apps/mobile/src/lib/use-mockable-api.ts`
- `apps/mobile/src/store/chat-store-provider.tsx`
- `apps/mobile/src/store/effects/ports.ts`
- `work/T-2134-phone-use-api.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 250 lower.
- The Report lists each deleted wrapper and hook, and each kept one with the reason.
- **Lead check:** a phone smoke of:
  - the chat list;
  - a chat;
  - `/explore`;
  - `/settings/machines`;
  - `/settings/integrations`;
  - an AI page (tools, memory, activity);
  - `/settings/profile`;
  - the sticker and GIF panels.

---

## Report (written by the worker when done)

### What I did

Added `apiCall(transport)` and its exported `ApiCall` type to `apps/mobile/src/lib/effect/api-client.ts`: it creates one client per transport and returns `(call) => runApi(call(client))`. `ChatExtrasCall` adds an optional signal that `apiCall` does not implement, so I kept the exact one-argument call shape (the same shape `client-core` uses internally for its call types).

Added `useApi(make)` to `apps/mobile/src/lib/use-mockable-api.ts`, plus the shared `realApiTransport`. Real mode uses `getSessionToken`/`fetch`/`API_URL`; mock mode builds `mockToken`/`mockFetch`/`API_URL` inside the same literal build-time guard and `require` as `useMockableApi`. It memoises on `[active, make]` only, so the API object stays stable across re-renders. `useMockableApi` is unchanged and still used by `components/contacts/use-contacts-api.ts`.

Deleted wrappers (all 23 `create…Api` functions in `apps/mobile/src/lib/*-api.ts`):
`createAiMemoryApi`, `createAisApi`, `createApprovalsApi`, `createAuditApi`, `createChatApi`, `createChatFoldersApi`, `createChatPrefsApi`, `createConnectionsApi`, `createDirectoryApi`, `createGifsApi`, `createGroupsApi`, `createIntegrationsApi`, `createInviteLinksApi`, `createInvitesApi`, `createMachinesApi`, `createMediaApi`, `createPinsApi`, `createProfileApi`, `createRolesApi`, `createSearchApi`, `createStickersApi`, `createToolsApi`, `createTopicsApi`.

Wrappers with more than transport plumbing became module-level makes and keep their type aliases:
`makeAiMemoryApi`, `makeChatApi`, `makeChatFoldersApi`, `makeChatPrefsApi`, `makeDirectoryApi`, `makeGifsApi`, `makeGroupsApi`, `makeInviteLinksApi`, `makeInvitesApi`, `makeMachinesApi`, `makeProfileApi`, `makeRolesApi`, `makeSearchApi`, `makeStickersApi`. `makeMachinesApi` keeps `setAiMachine`; `makeProfileApi` keeps the avatar PUT; `makeStickersApi` keeps the binary upload; `makeGifsApi`/`makeSearchApi` keep their abortable calls. Pure wrappers now call the shared `client-core` `make…Api` directly with one call.

Deleted hooks (8): `use-ai-memory-api`, `use-ais-api`, `use-audit-api`, `use-tools-api`, `use-approvals-api`, `use-connections-api`, `use-directory-api`, `use-machines-api`. Every caller now calls `useApi(make…Api)` directly.

Kept hooks (2):
- `use-profile-api.ts`: it adds the mock avatar upload (the screens pass a native `expo-file-system` uploader that the mock backend cannot serve) and still needs the literal mock branch; it now builds through `makeProfileApi(apiCall(transport), transport)`.
- `use-stickers-api.ts`: it adds the mock sticker binary upload and returns `viewerId` from the mock backend; it now builds through `makeStickersApi(...)`.

The store (`chat-store-provider.tsx` and `effects/ports.ts`) builds one real `call` and one mock `call` and passes them to each `make…Api`; injected `deps.*Api` seams are unchanged. `link-preview-card`, `gif-panel`, `chat-composer-dock`, `chat-search-results`, `new-chat-button`, `sticker-panel` and `integrations.tsx` were adapted to the new helpers. `media-api.test.ts` now calls `makeChatExtrasApi(apiCall(...))`.

Product lines: `git diff --numstat -- 'apps/**'` gives 351 insertions, 660 deletions, net **-309**.

### Checks run

- `pnpm install --frozen-lockfile`: Done in 12.1s.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/media-api.test.ts`: 1 file passed, 1 test passed.
- `pnpm gate`: final run passed.

```
gate: 69 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (1.8s)
PASS  lint  (0.8s)
PASS  typecheck  (4.5s)
PASS  effect  (3.4s)
SKIP  build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/mobile  (7.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Notes for the lead

- Behaviour is unchanged: same endpoints, token provider, timeout (`createApiClient` is still the only transport), mock switch and per-transport client.
- The gate reports only the pre-existing soft size warnings (no new file over 800 lines); `app/(tabs)/ais.tsx` grew by one line (401 vs 401 base +1) from the added import, not from new logic.
- Phone smoke still needed for the list in Acceptance: chat list, a chat, `/explore`, `/settings/machines`, `/settings/integrations`, an AI page, `/settings/profile`, and the sticker/GIF panels.

## Review (written by Claude)

Approved; the pre-review was clean (0 nits). Net −309 across 68 phone files:
- `apiCall(transport)` in `lib/effect/api-client.ts` and `useApi(make)` in `lib/use-mockable-api.ts` replace the per-area `create…Api(getToken, fetch, url)` wrappers and 8 of the 10 `use…Api` hooks;
- the store builds one real and one mock `call`.

**Lead read:** `useApi` memoises on `[active, make]`, and all 37 callers pass a module-level `make`, so each screen keeps one API object across renders. The Metro mock guard is unchanged.

**Phone emulator:**
- The smoke passed: `/`, `/chat/dev-team@rooms.zilar.test`, `/explore`, `/settings/machines`, `/settings/integrations`, `/ais/ai-dev-1`, `/settings/profile`, `/settings/approvals`, `/settings/routines`, `/ais`. Each screen shows its mock data.
- Pinning a message through the store updates the banner to "1 of 2 · 2 pins".
- The emoji panel's Stickers tab lists the packs, and the GIFs tab opens.

**Follow-up:** `useMockableApi` now has one user (`use-contacts-api.ts`). Moving it to `useApi` lets the old hook go.
