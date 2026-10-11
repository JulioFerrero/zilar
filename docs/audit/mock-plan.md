# Mock mode plan: one shared fake backend for both apps

> **Status (lead, 2026-10-11): this plan is carried out, and the rest of this file is historical.**
> - **Done:** both apps run their real stores and API factories on `@zilar/mock-backend`. Web's `dispatch` is backend-only (T-1074). The mobile hooks pass `mockFetch` (T-1060 to T-1085). Every old mock file listed in §1 is deleted.
> - **Stale:** most of the `file:line` citations below point to files that no longer exist.
> - **Current state:** what is left, and the blank-image plan, are in [`mock-sweep-status.md`](mock-sweep-status.md) (T-1082). Its §5 lists the lines here that are out of date.

Audit for T-0935. Read-only: no code or test was changed. Every claim below is
backed by a `path:line` I opened and checked. "Web" means `apps/web`, "mobile"
means `apps/mobile`, "the contract" means `packages/api-contract`.

Conventions:

- All paths are relative to the repo root.
- "The core" means `packages/client-core/src/store` (the shared store core the
  real stores already run on, exported at `packages/client-core/src/store/index.ts:1`).
- "The real store" means `apps/web/src/store/realStore.ts` (524 lines) and
  `apps/mobile/src/store/real-store.ts` (768 lines); both are adapters over the
  core, selected by `apps/web/src/store/ChatStoreProvider.tsx:22` and
  `apps/mobile/src/store/chat-store-provider.tsx:67`.
- Line counts are from `wc -l` on the files as they are on this branch.

The problem in one line: mock mode today is a second, hand-written store per app
plus a second copy of the fake data, so it drifts from the real store and from
the other app.

## 1. Inventory

### 1.1 The switches

Web:

- `apps/web/src/mock/gate.ts:15` `resolveMockMode` and `:34` `isMockMode`
  decide mock mode (`VITE_MOCK=1`, `MODE=test`, or `?mock=1` in a dev build;
  `:43` `isMockApiEnabled` excludes the unit-test run).
- `apps/web/src/mock/load.ts:8` `loadMockRequest` is the only production path
  to the mock HTTP layer; it imports `mock/api.ts` behind an inline build
  condition so a production bundle drops it.
- `apps/web/src/lib/api.ts:138` `request()` takes the mock branch at `:144`
  (`isMockApiEnabled()` → `loadMockRequest()`), and the contract path goes the
  same way through `apps/web/src/lib/effect/api-client.ts:27` (`webFetch`).
  Three raw-body uploads call `mockRequest` directly: sticker upload
  (`apps/web/src/lib/api.ts:1242`), avatar upload (`:1698`) and background
  upload (`:1751`).
- `apps/web/src/auth/AuthProvider.tsx:112-119` swaps in `MockAuthProvider`,
  which reports an authenticated `you@zilar.test` session with no server.
- `apps/web/src/store/ChatStoreProvider.tsx:22` picks `createChatStore()` (the
  mock store, re-exported from `apps/web/src/store/store.ts:40`) or
  `createRealChatStore()`.
- In a production build without `VITE_MOCK`, `vite.config.ts` aliases
  `@/store/mockStore` to `apps/web/src/mock/storeStub.ts:7`.

Mobile:

- `apps/mobile/src/mock/gate.ts:7` `mockParamAllowed` and `:19` `ENV_MOCK`
  (`EXPO_PUBLIC_ZILAR_MOCK`); `apps/mobile/src/store/chat-store.ts:1583`
  `isMockMode` (`NODE_ENV=test`, `EXPO_PUBLIC_ZILAR_MOCK=1`, or `?mock=1`).
- `apps/mobile/src/store/chat-store-provider.tsx:43` `createMockStore` requires
  the mock store module behind an inline build condition; `:67` picks it over
  `createRealChatStore` in the provider.
- Per-screen hooks pick a mock API object instead of the real one: `:38-44` of
  `apps/mobile/src/components/ais/use-ais-api.ts` is the pattern;
  `apps/mobile/src/app/(tabs)/index.tsx:94` (search) and
  `apps/mobile/src/app/chat/[id].tsx:213-232` (stickers, attachments, GIFs)
  import mock data directly.
- Scenario env vars: `EXPO_PUBLIC_ZILAR_MOCK_SCENARIO`
  (`apps/mobile/src/mock/gate.ts:20`), `EXPO_PUBLIC_ZILAR_MOCK_DRAFT`
  (`apps/mobile/src/mock/drafts.ts:57`), `EXPO_PUBLIC_ZILAR_MOCK_LOAD`
  (`apps/mobile/src/mock/load.ts:19`).

Mobile has no `MockAuthProvider` twin; the mock store's `start()` is a no-op
(`apps/mobile/src/store/chat-store.ts` `start: () => {}`, `:1094-1095` of the
web twin is the same shape), so mock mode today needs no session. The real
store does need one (§5, risk R3).

### 1.2 Web mock files

| File | Lines | What it fakes | Anchors |
| --- | ---: | --- | --- |
| `mock/api.ts` | 4,297 | The whole HTTP surface: a `(path, init) => Response` switch | in-memory `MockState` `:44`; `seedState` `:1028`; `resetMockApi` `:1285`; `setMockDelay` `:40`; `mockRequest` `:2179`; tools/routines routes `toolRoutes` `:633`; message search index `searchMessages` `:4152` |
| `mock/chats.ts` | 156 | Chat rows (`ChatSummary`) | `mockChats` `:6` (12 chats) |
| `mock/topics.ts` | 240 | Dev-team topics (7) + per-topic threads/members/AIs | `TOPIC_SEEDS` `:33`; `mockTopicChats` `:175`; `mockTopicMembersById` `:226`; `mockTopicAisById` `:236` |
| `mock/groups.ts` | 131 | Group details (members, roles, AIs) + owned AIs | `mockGroupDetails` `:38`; `mockOwnedAis` `:126` |
| `mock/members.ts` | 26 | Mention pickers derived from group details | `mockGroupMembers` `:14` |
| `mock/messages.ts` | 1,148 | Message history, ~10 threads | `mockMessages` `:1114`; `mockLastMessage` `:1141` |
| `mock/helpers.ts` | 223 | Voice/waveform, image SVGs, approval & progress cards, sticker art, GIF items | `voice` `:29`; `approvalCard` `:75`; `mockDemoStickerPacks` `:110`; `mockGifItems` `:203` |
| `mock/ids.ts` | 30 | People, me, AI JIDs, room JIDs | `PEOPLE` `:8`; `ME` `:19`; `AI_JIDS` `:21`; `ROOMS` `:27` |
| `mock/index.ts` | 12 | Barrel | `:1` |
| `mock/load.ts` | 14 | Build-conditioned import of the mock HTTP layer | `:8` |
| `mock/gate.ts` | 45 | Mock-mode decision | `:15`, `:34`, `:43` |
| `mock/storeStub.ts` | 9 | Empty stand-in for the mock store in production | `:7` |
| `store/mockStore.ts` | 1,294 | The whole fake store: messages, send/edit/react/delete, pins, topics, prefs, folders, media, typing simulation | `createChatStore` `:434`; `mockMediaPage` `:252`; `scheduleTypingSimulation` `:322`; topic rows `:339-432` |

Web routes inside `mock/api.ts` (dispatch in `mockRequest`, `:2179`):
`me`/handle `:2196`; `users/by-handle` `:2232`; `contact-requests` `:2248`;
`blocks` `:2280`; `handles/check` `:2308`; `chats` `:2317`; `sticker-packs` and
`sticker-panel`/`sticker-favorites` `:2326-2464`; `gifs/search|trending` `:2483`;
`chat-prefs`/`chat-background` `:2502-2512`; `backgrounds` `:2685`;
`chat-folders` `:2736-2836`; `push` `:2838-2914`; `pins` `:2916-2985`;
`ai-memory` `:2987`; `contacts` `:3017`; `ais` `:3021`; `search` `:3054`;
`groups/invite-links` `:3067`; `join` `:3154`; `directory` `:3228`;
`groups/by-handle` `:3311`; `groups/join` `:3336`; `groups` (POST/PATCH)
`:3354-3506`; `groups/members` `:3507`; `groups/topics` `:3613`;
`groups/roles` `:3678`; `topics` `:3766`; `audit` `:3920`;
`groups/approval-rules` and `approval-rules` `:3947-3970`; `connections` `:3971`;
`machines` `:3994`; `approvals` `:4063`; `voice/transcription`/`transcript`
`:4127-4141`.

Two gaps in the web mock: `/media` (the gallery, contract
`packages/api-contract/src/media.ts:57`) is not in `mockRequest`; the mock store
serves it locally instead (`mockStore.ts:252`). `/settings/integrations`
(`packages/api-contract/src/integrations.ts:92`) is not handled at all on web.

### 1.3 Mobile mock files

`apps/mobile/src/mock/` (26 files, 3,227 lines):

| File | Lines | What it fakes | Anchors |
| --- | ---: | --- | --- |
| `index.ts` | 30 | Assembles the chat list from seeds, topics and channels | `mockChats` `:15` |
| `chats.ts` | 113 | 10 chat seeds | `chatSeeds` `:7` |
| `messages.ts` | 258 | Message history | `mockMessagesByChat` `:82` |
| `topics.ts` | 374 | Dev-team topics, group detail, roles | `mockTopicChats` `:186`; `mockDevteamGroupDetail` `:234`; `mockGroupRoles` `:307` |
| `channel.ts` | 200 | Two demo channels | `mockChannelChats` `:94`; `mockChannelDetail` `:139` |
| `ais.ts` | 251 | AIs + connections API | `mockAis` `:45`; `createMockAisApi` `:162` |
| `approvals.ts` | 129 | Approvals API | `createMockApprovalsApi` `:86` |
| `audit.ts` | 83 | 25 audit entries | `createMockAuditApi` `:62` |
| `tools.ts` | 369 | Tools/routines API | `createMockToolsApi` `:202` |
| `ai-memory.ts` | 38 | AI memory API | `createMockAiMemoryApi` `:25` |
| `directory.ts` | 116 | Public directory API | `createMockDirectoryApi` `:60` |
| `profile.ts` | 198 | Profile/handle/avatar API | `createMockProfileApi` `:125` |
| `search.ts` | 152 | Message search API | `createMockSearchApi` `:143` |
| `stickers.ts` | 51 | Two demo packs | `mockDemoStickerPacks` `:46` |
| `gifs.ts` | 43 | Six demo GIFs | `mockDemoGifs` `:34` |
| `pins.ts` | 86 | Pins store | `mockListPins` `:43` |
| `chat-prefs.ts` | 66 | Chat prefs store | `mockListChatPrefs` `:21` |
| `invite-links.ts` | 198 | Invite-link store (create/list/revoke/preview/join) | `createMockInviteLinksStore` `:117` |
| `contacts.ts` | 8 | Three contacts | `mockContacts` `:4` |
| `attachments.ts` | 39 | Two demo attachments | `mockDemoAttachments` `:11` |
| `voice.ts` | 23 | One demo voice clip | `mockDemoVoice` `:9` |
| `drafts.ts` | 62 | Draft-stream screenshot scenario | `readMockDraftPhase` `:57` |
| `load.ts` | 26 | Load screenshot scenario | `readMockLoadScenario` `:19` |
| `gate.ts` | 26 | Mock-mode gate | `:7`, `:19` |
| `time.ts` | 14 | Date helpers | `at` `:4` |
| `dev-kit-screen.tsx` | 274 | Hidden component catalog (not mock data) | `:1` |

Outside `src/mock/` (not counted in the task's 12,447, but they are the same
kind of code):

| File | Lines | Anchors |
| --- | ---: | --- |
| `components/stickers/stickers-mock.ts` | 314 | `createMockStickersApi` `:123` |
| `components/contacts/contacts-mock.ts` | 337 | `createMockContactsApi` `:120` |
| `components/integrations/integrations-mock.ts` | 178 | `createMockIntegrationsApi` `:125` |
| `components/machines/machines-mock.ts` | 172 | `createMockMachinesApi` `:99` |
| `components/connections/connections-mock.ts` | 130 | `createMockConnectionsApi` `:87` |
| `test/native-mocks.ts` | 18 | test-only |

The mobile fake store itself: `store/chat-store.ts` (1,595 lines),
`createInitialState` `:152`, `createChatStore` `:358`, `isMockMode` `:1583`,
media locally at `mockMediaItems` `:290`. It reimplements the `ChatStoreState`
of `store/types.ts` instead of using the real store.

Real total: 12,447 (the task's number) + 1,131 (the five component mocks) + 18 =
13,596 lines of mock code.

### 1.4 Where web and mobile duplicate each other

Every fake domain has two hand-written copies, with different id schemes (web
`u-you`/`c-ana`/`ai-dev-1@zilar.test` from `mock/ids.ts:8-30`; mobile
`me`/`ana`/`dev-ai` from `apps/mobile/src/lib/types.ts:2`):

| Domain | Web | Mobile |
| --- | --- | --- |
| Chat list | `mock/chats.ts:6` | `mock/chats.ts:7` + `mock/index.ts:15` |
| Messages | `mock/messages.ts:1114` | `mock/messages.ts:82` |
| Topics | `mock/topics.ts:33` (7 seeds) | `mock/topics.ts:35` (same 7, per its header `:5-9`) |
| Group detail / roles | `mock/groups.ts:38` | `mock/topics.ts:234`, `:307` |
| Channel | `mock/chats.ts:22` + `mock/groups.ts:108` | `mock/channel.ts:94` |
| AIs / connections | `mock/api.ts:825` (`seedAi`) + `mock/groups.ts:126` | `mock/ais.ts:45` |
| Approvals | `mock/helpers.ts:75` + `mock/api.ts:4063` | `mock/approvals.ts` |
| Audit | `mock/api.ts` `audit` state + `:3920` | `mock/audit.ts` |
| Tools / routines | `mock/api.ts` `seedTools:418`, `seedRoutines:486`, `toolRoutes:633` | `mock/tools.ts` |
| Stickers | `mock/helpers.ts:110` | `mock/stickers.ts:46` |
| GIFs | `mock/helpers.ts:203` | `mock/gifs.ts:34` |
| Voice | `mock/helpers.ts:29` | `mock/voice.ts:9` |
| Pins | `mock/api.ts` `seedPins:987` | `mock/pins.ts` |
| Chat prefs | `mock/api.ts:2502` | `mock/chat-prefs.ts` |
| Directory | `mock/api.ts:3228` | `mock/directory.ts` |
| Search | `mock/api.ts:4152` | `mock/search.ts` |
| Invite links | `mock/api.ts:3067` | `mock/invite-links.ts` |
| Profile / handles | `mock/api.ts:2196`, `:2308` | `mock/profile.ts` |

So the duplication is both the data (two seeds per domain) and the behaviour
(two fake stores, plus the web HTTP switch and the mobile API objects).

## 2. The design

### 2.1 Shape

Mock mode should run **each app's real store**, unchanged, against **one fake
backend** in a new shared package. Nothing in mock mode touches the network.

- The real stores already take injectable ports:
  `apps/web/src/store/effects/ports.ts:180` `RealStoreDeps`
  (`api`, `createXmpp`, `voice`, `attachments`, `openDrafts`, `storage`, …) and
  `apps/mobile/src/store/effects/ports.ts:26` `RealStoreDeps` (`api`,
  `topicsApi`, `pinsApi`, `groupsApi`, `createXmpp`, …).
- The apps' API functions already take a fetch seam: web's `webFetch` in
  `apps/web/src/lib/effect/api-client.ts:19` already returns `mockRequest` in
  mock mode, and every mobile API factory takes `fetchImpl`
  (`apps/mobile/src/lib/chat-api.ts:364`, `apps/mobile/src/lib/topics-api.ts:196`,
  `apps/mobile/src/lib/ais-api.ts:114`).
- So the fake backend needs exactly two entry points: a `Response`-returning
  HTTP handler and an `XmppCore` factory. Web injects them through
  `loadMockRequest`/`createXmpp`; mobile injects them through `fetchImpl` and
  `createXmpp`.

### 2.2 The package

Name: **`@zilar/mock-backend`** at `packages/mock-backend/`. It is a `private`
workspace package like the others (`packages/xmpp-core/package.json:1`), with
one barrel export, and it depends only on `@zilar/api-contract`,
`@zilar/chat-core`, `@zilar/protocol` and `@zilar/xmpp-core` — **no react and no
effect at runtime**, so Metro can resolve it from the mobile app without the
`clientCoreDir` rewrite (`apps/mobile/metro.config.js:55-69`).

Folders:

```text
packages/mock-backend/src/
  data/        one seed, split one file per domain
               people.ts chats.ts messages.ts topics.ts groups.ts
               ais.ts approvals.ts audit.ts tools.ts stickers.ts gifs.ts
               pins.ts prefs.ts folders.ts directory.ts profile.ts
               invite-links.ts index.ts
  state.ts     createMockData(seed): in-memory tables + domain mutators
  http.ts      createMockHttp(data): (path, init) => Promise<Response>
  http/        one route file per contract group (chats.ts, topics.ts, …)
  xmpp.ts      createMockXmppCore(data, options): XmppCore
  index.ts     barrel
```

Public API (a design sketch; a worker checks the Effect/React APIs it uses):

```ts
export interface MockSeed { /* people, chats, messages, topics, groups, ais, ... */ }
export function createSeed(now?: () => Date): MockSeed;

export interface MockBackendOptions {
  seed?: MockSeed;
  delayMs?: number;              // default 150, like web's DEFAULT_DELAY_MS
  now?: () => Date;
}
export interface MockBackend {
  readonly http: (path: string, init?: RequestInit) => Promise<Response>;
  readonly xmpp: (options: XmppCoreOptions) => XmppCore;
  readonly data: MockData;       // read-only view, for tests
  reset(): void;
  setDelay(ms: number): void;
}
export function createMockBackend(options?: MockBackendOptions): MockBackend;
export function createMockXmppCore(data: MockData, options: XmppCoreOptions): XmppCore;
export { defaultSeed } from './data';
```

App-side (small, stays in each app):

- Web: `apps/web/src/mock/backend.ts` holds one `createMockBackend()` singleton;
  `apps/web/src/mock/load.ts` returns `backend.http`;
  `apps/web/src/mock/gate.ts` and `storeStub.ts` are unchanged.
- Mobile: `apps/mobile/src/mock/backend.ts` holds the singleton;
  every `use-*-api.ts` passes `backend.http` as `fetchImpl`; the provider passes
  `backend.xmpp` as `createXmpp`.

### 2.3 The fake HTTP layer: HttpApi handler or a plain `request()` switch?

**Recommendation: keep a plain `(path, init) => Response` switch** (the shape of
`mockRequest` today, `apps/web/src/mock/api.ts:2179`), but drive it from the
shared `MockData` instead of a module-level `state`, and split it by contract
group under `http/`.

Why not an in-memory `HttpApiBuilder` handler over the contract's groups:

- The contract is `HttpApi.make('zilar').add(AiMemoryGroup, …, TopicsGroup)`
  (`packages/api-contract/src/api.ts:37`; 144 endpoints over 30 groups). The
  server implements each group with `HttpApiBuilder.group` over **server-only**
  services and the database (e.g. `apps/server/src/pins/api.ts:71`,
  `apps/server/src/auth/api.ts:131`), so those handlers cannot be reused
  in-memory without reimplementing the same per-endpoint logic the switch would.
- Both clients already validate the decoded body: web's `decodeResponse`
  (`apps/web/src/lib/api.ts:77`) and the mobile contract client
  (`apps/mobile/src/lib/effect/api-client.ts:19`), so the contract's decode-side
  safety is not lost by a plain switch.
- A switch is what mobile needs anyway: mobile never goes through web's
  `mockRequest`; it injects `fetchImpl`, and its hand-written mock objects
  (`apps/mobile/src/mock/ais.ts:162`) become thin wrappers over `backend.http`
  or `backend.data`.
- The switch must keep today's raw-body handling for binary uploads
  (`apps/web/src/mock/api.ts` `createMockStickerPack:1666`,
  `uploadMockSticker:1750`, avatar/background uploads in
  `apps/web/src/lib/api.ts:1242`, `:1698`, `:1751`); an `HttpApiBuilder` handler
  would only make that harder.

A later, optional task could wrap `backend.http` in an `HttpApiBuilder` layer to
type-check response bodies against `ZilarApi`, but it buys little now.

### 2.4 The fake XMPP core

Build on `createFakeXmppCore` (`packages/xmpp-core/src/testing.ts:32`), which
already records calls, injects failures (`:24`) and exposes `emit` (`:19`).
Override the methods it stubs, keeping its `on` hub and `calls`/`failures`
(`:32-35`):

- `connect` → status `online`, emit `status`; `me()` → `you@zilar.test`.
- `joinRoom`/`leaveRoom`/`occupants` → track rooms and occupants, emit
  `occupants`.
- `sendMessage` → append to the room/DM thread in `MockData`, then emit a
  reflected `message` (`outgoing: true`) and, for a room, an incoming echo from
  a seeded member after a short delay — this is what makes demo chats come
  alive.
- `loadHistory` → serve the seed's MAM pages with RSM
  (`HistoryPage.first`, `packages/xmpp-core/src/types.ts:152`), so scroll-back
  and `openAtMessage` work.
- `sendReactions`/`sendCorrection`/`sendRetraction` → mutate the ledger and emit
  the matching `message` updates (the core already models these,
  `packages/xmpp-core/src/types.ts:40-84`).
- `sendTyping`/`markDisplayed` → emit `typing`/`displayed`.
- `requestUploadSlot` → a `data:` URL pair, so attachment and voice sends
  finish without a server.

The signature to satisfy is `XmppCore` (`packages/xmpp-core/src/types.ts:248`),
the same one `createXmppCore` returns (`packages/xmpp-core/src/index.ts:61`).

### 2.5 One seed data set

One seed, keyed by bare JIDs (the API's own keying), not by the two client id
schemes. XMPP ids follow `apps/web/src/mock/ids.ts:21-30`
(`dev-1@ai.zilar.test`, `dev-team@rooms.zilar.test`). The seed produces the
**API response shapes** (a `ChatEntry` list, `ChatEntry → topic rows`), so each
app's own row mapper rebuilds its client rows: web and mobile both use the core
`summariesFor` (`packages/client-core/src/store/chat-rows.ts:161`; mobile's
wrapper is `apps/mobile/src/store/real-store.ts:97`). This is what removes the duplicated
`ChatSummary` seeds (`apps/web/src/mock/chats.ts:6`,
`apps/mobile/src/mock/chats.ts:7`).

The seed keeps today's content: Ana/Luis/Marta/Marco/Sofía, the Dev team with
its 7 topics and Dev-1/QA-1, the Acme channel, dev-ai/marketing-ai, the two
sticker packs and six GIFs, the same pins/prefs, one pending approval.

### 2.6 How each app ends up running its real store

Web:

- `apps/web/src/store/ChatStoreProvider.tsx:22` drops the mock store branch and
  always calls `createRealChatStore()`.
- `apps/web/src/store/effects/ports.ts:356` injects
  `createXmpp: (options) => mockBackend.xmpp(options)` when `isMockMode()`
  (import behind the same build condition as `load.ts`).
- `apps/web/src/lib/effect/api-client.ts:27` and
  `apps/web/src/lib/api.ts:144` already route HTTP to the backend.
- `MockAuthProvider` (`apps/web/src/auth/AuthProvider.tsx:112`) stays, so the
  real store's `auth.status === 'authenticated'` gate
  (`ChatStoreProvider.tsx:27`) passes with no session.

Mobile:

- `apps/mobile/src/store/chat-store-provider.tsx:67` always calls
  `createRealChatStore({ api: createChatApi(mockToken, backend.http, API_URL), topicsApi: createTopicsApi(mockToken, backend.http, API_URL), …, createXmpp: backend.xmpp, uploader, statSize, voice })`.
- The real store's start gate `status === 'authenticated'`
  (`chat-store-provider.tsx:71`) is false without a session. In mock mode the
  provider must start the store anyway and pass a fake token provider
  (`() => Promise.resolve('mock-token')`) because `createApiClient` fails
  `unauthorized` before sending when the token is `undefined`
  (`apps/mobile/src/lib/effect/api-client.ts:25-31`).
- The per-screen hooks (`use-ais-api.ts:38`, `(tabs)/index.tsx:94`,
  `chat/[id].tsx:213`) swap `createMockXxxApi(scenario)` for the real factory
  with `backend.http`.

## 3. What it must cover

Every screen Julio uses to see a new feature, and the backend domain that
serves it. (Screen paths are web routes and mobile `app/` routes.)

| Area | What a demo must show | Backend domain |
| --- | --- | --- |
| Chats | DM + group list, unread, last message, open, scroll-back | `data/chats`, `data/messages`, XMPP MAM |
| Sending | text, edit, react, delete, forward, retry, typing, read | XMPP send/echo + ledger |
| Topics | 7 dev-team topics, create/patch/archive/leave, owner, private | `data/topics` + group actions |
| Groups | detail, members, roles, AIs, invite links, join by link, channels | `data/groups`, `http/groups`, `http/roles`, `http/invite-links` |
| AIs | list, create, edit, model/limits, group panel, AI memory, audit | `data/ais`, `http/ais`, `http/ai-memory`, `http/audit` |
| Approvals | pending card, approve/deny/always, rules list | `data/approvals`, `http/approvals` |
| Tools/routines | tool list/detail/versions/run/revert, routines | `data/tools`, `http/tools` |
| Stickers/GIFs | panel, favorites, discover, send | `data/stickers`, `data/gifs` |
| Voice | record/send, waveform, transcript | `data/voice`, `http/voice` |
| Attachments/media | send image/file, gallery tabs, uploads, backgrounds, avatars | `data/messages`, `http/media`, `http/backgrounds` |
| Search | message search with cursor, in-chat narrowing | `http/search` |
| Pins | pin/unpin panel | `data/pins`, `http/pins` |
| Settings | profile, handles, prefs, folders, blocks, contact requests | `data/profile`, `http/prefs`, `http/folders`, `http/blocks` |
| Directory | explore, search, by-handle, join | `data/directory`, `http/directory` |
| Push/devices | device list + previews setting (UI only) | `http/push` |
| Machines/connections | runner list + connection tests (UI only) | `data/machines`, `http/connections` |

**Not worth faking:**

- The setup wizard (`apps/server/src/setup`) and login/OTP: web already fakes
  the session (`AuthProvider.tsx:112`); mobile should get a `MockAuthProvider`
  twin rather than a fake auth server.
- Third-party proxy calls: the GIF media proxy
  (`/gifs/media/:token`, `packages/api-contract/src/gifs.ts:52`) and real
  transcription — the web mock already returns a fixed sentence
  (`mock/api.ts:4127-4141`).
- Real push delivery/FCM and real S3 uploads — use `data:` URLs.
- XMPP TLS, stream management, keepalive, reconnection: the fake core must be
  always-online; connection-quality flows are tested in `xmpp-core`, not in mock
  mode.
- Rate limits, quota arithmetic and permission enforcement beyond what a demo
  shows (the fake has one owner user, like today's
  `apps/web/src/mock/api.ts:103-105`).
- `integrations`: the screen is settings-only (`use-integrations-api.ts`);
  fake the status/list state, not a real Telegram/email round-trip. The web
  mock has no `/settings/integrations` route today (§1.2), so this is new.

## 4. Task split

Migration mechanism that keeps every task green and bounded: during the
migration each app's mock HTTP layer is a **dispatcher** that tries the shared
backend first and falls back to the old route/file for a domain. The split
therefore separates **building** the shared backend and **switching** each app
to it (A–H) from a **deletion sweep** (I–R2): once a domain is switched, the
superseded mock code is dead and is removed in its own small task instead of
one giant diff at the end.

**Budget.** Today's mock code is 13,596 lines (§1.2, §1.3). ≈490 of them stay:
`apps/web/src/mock/{gate,load,storeStub}.ts` (68),
`apps/mobile/src/mock/{gate,load,drafts,time}.ts` (128),
`apps/mobile/src/mock/dev-kit-screen.tsx` (274) and
`apps/mobile/test/native-mocks.ts` (18). So the split **removes ≈13,100 lines**
and **writes ≈5,250** (backend ≈4,100 + adapters/switch ≈900 + demo docs ≈250):
**≈18,350 changed lines** (`git diff --stat` added+removed). The **net removal
is ≈7,900** (13,100 − 5,250), ending at **≈5,750 lines** (kept 488 + written
5,250); counting both sides is why the changed-line total is larger than the net
figure. The `Est.` column is changed lines (`Add` + `Del`); the earlier
estimates were sized on *new* lines only, which undercounted the deletions.

| # | Task | Add | Del | Est. | Depends on |
| --- | --- | ---: | ---: | ---: | --- |
| A | Scaffold `@zilar/mock-backend`; `state.ts`; seed `people/chats/messages`; `http/chats` + `http/me` + `http/contacts`; `createMockBackend` | 650 | 0 | 650 | — |
| B | Backend messages/search: `http/{messages,search}.ts`, `data/messages.ts` | 550 | 0 | 550 | A |
| C | Backend prefs/folders/pins/media/backgrounds: `http/{prefs,folders,pins,media,backgrounds}.ts`, data | 550 | 0 | 550 | A |
| D | Backend groups/topics/roles/channels/invite-links/directory: `http/{groups,topics,roles,channels,invite-links,directory}.ts`, data | 700 | 0 | 700 | A, B |
| E | Backend AIs/connections/machines/AI-memory/approvals/audit/tools: `http/{ais,connections,machines,ai-memory,approvals,audit,tools}.ts`, data | 700 | 0 | 700 | A |
| F | Backend stickers/GIFs/voice/profile: `http/{stickers,gifs,voice,profile}.ts`, data | 500 | 0 | 500 | A |
| F2 | Fake XMPP core `xmpp.ts` (send/echo, rooms, MAM, typing, reads) | 450 | 0 | 450 | A, B |
| G | Web cutover: run the real store (`ChatStoreProvider.tsx:22`, `store/effects/ports.ts:180-368`, `mock/{backend,load}.ts`) | 400 | 0 | 400 | A–F |
| H | Mobile cutover: run the real store (`chat-store-provider.tsx:43-79`, `store/effects/ports.ts:26-155`, `mock/backend.ts`, `use-*-api.ts` adapters) | 500 | 0 | 500 | A–F |
| S | Demo checklist + docs (`?mock=1` web, emulator scenarios) | 250 | 0 | 250 | G, H |

Per task, the files and anchors are:

- **A**: new `packages/mock-backend/{package.json,tsconfig.json,src/{index,state,http,data/*}.ts}`;
  seed `src/data/{people,chats,messages}.ts`; add the workspace dep to
  `apps/web/package.json:18-23` and `apps/mobile/package.json:21-26`. Delete
  nothing. Check: `pnpm --filter @zilar/mock-backend test` (one seed test) + the
  app still runs old mock mode.
- **B/C/D/E/F**: one route file per contract group under
  `packages/mock-backend/src/http/`, each with its `src/data/*` seed file. They
  add code only: the G/H dispatcher already serves them, and the old files stay
  until the I–R2 sweep.
- **F2**: `src/xmpp.ts`, built on `createFakeXmppCore`
  (`packages/xmpp-core/src/testing.ts:32`) and typechecked against `XmppCore`
  (`packages/xmpp-core/src/types.ts:248`); exposes `backend.xmpp`.
- **G**: `apps/web/src/store/ChatStoreProvider.tsx:22`,
  `apps/web/src/store/effects/ports.ts:180-368`,
  `apps/web/src/mock/{backend,load}.ts`; keep `mock/gate.ts`,
  `mock/storeStub.ts`.
- **H**: `apps/mobile/src/store/chat-store-provider.tsx:43-79`,
  `apps/mobile/src/store/effects/ports.ts:26-155`,
  `apps/mobile/src/mock/backend.ts`; every `use-*-api.ts:38` passes
  `backend.http` as `fetchImpl`; keep `mock/{gate,load}.ts`.
- **S**: this file's checklist section plus a short `docs/audit/mock-demo.md`
  with the screen list from §3.

The deletion sweep runs one file (or one contiguous `api.ts` range) per task,
using the anchors §1.2/§1.3 already cite:

| # | Deletes | Anchors | Del | Est. | Depends on |
| --- | --- | --- | ---: | ---: | --- |
| I | web `mock/api.ts` B/E-domain routes | `:2317-2325`, `:2326-2501`, `:2502-2512`, `:2685-2735`, `:2736-2836`, `:2916-2985`, `:3054`, `:4127-4141` | 434 | 434 | G |
| J | web `mock/api.ts` groups/topics/roles range | `:3067-3919` | 853 | 853 | G |
| K | web `mock/api.ts` D/E-domain routes | `:2987-3053`, `:3920-4126`, `:633-824` | 462 | 462 | G |
| L1 | web `mock/api.ts` state/seed machinery, part 1 | `MockState :44`, `seedState :1028`, `resetMockApi :1285` | 850 | 850 | G |
| L2 | web `mock/api.ts` state/seed machinery, part 2 | `setMockDelay :40`, `mockRequest :2179` | 850 | 850 | G |
| L3 | web `mock/api.ts` state/seed machinery, part 3 | `searchMessages :4152` | 848 | 848 | G |
| M | web seed files `mock/{chats,topics,groups,members,helpers,ids,index}.ts` | `chats.ts:6`, `topics.ts:33`, `groups.ts:38`, `members.ts:14`, `helpers.ts:29`, `ids.ts:8`, `index.ts:1` | 818 | 818 | G |
| N | web `mock/messages.ts` | `:1114` | 1,148 | 1,148 | G, B |
| O | web `store/mockStore.ts` | `createChatStore :434` | 1,294 | 1,294 | G |
| P1 | mobile `mock/{messages,topics}.ts` | `messages.ts:82`, `topics.ts:186` | 632 | 632 | H |
| P2 | mobile `mock/{tools,ais,ai-memory,approvals}.ts` | `tools.ts:202`, `ais.ts:45`, `ai-memory.ts:25`, `approvals.ts:86` | 787 | 787 | H |
| P3 | mobile `mock/{audit,directory,invite-links,profile,search}.ts` | `audit.ts:62`, `directory.ts:60`, `invite-links.ts:117`, `profile.ts:125`, `search.ts:143` | 747 | 747 | H |
| P4 | mobile `mock/{stickers,gifs,pins,chat-prefs,contacts,attachments,voice,channel,index,chats}.ts` | `stickers.ts:46`, `gifs.ts:34`, `pins.ts:43`, `chat-prefs.ts:21`, `contacts.ts:4`, `attachments.ts:11`, `voice.ts:9`, `channel.ts:94`, `index.ts:15`, `chats.ts:7` | 659 | 659 | H |
| Q | mobile `store/chat-store.ts` | `createChatStore :358`, `isMockMode :1583` | 1,595 | 1,595 | H |
| R1 | `components/{stickers,contacts}/*-mock.ts` | `stickers-mock.ts:123`, `contacts-mock.ts:120` | 651 | 651 | H |
| R2 | `components/{integrations,machines,connections}/*-mock.ts` | `integrations-mock.ts:125`, `machines-mock.ts:99`, `connections-mock.ts:87` | 480 | 480 | H |

Check for every task: `pnpm gate`. The deletion tasks additionally re-run the
app in mock mode (`?mock=1` on web, the emulator on mobile); O, Q, R1 and R2
also run `pnpm --filter @zilar/web test` / `pnpm --filter @zilar/mobile test`
on the store and component tests that used the deleted files
(`realStore.*.test.tsx`, `apps/mobile/src/store/*.test.*`) — see risk R1.

**Why four deletion tasks stay over ~800 changed lines.** J (853), N (1,148),
O (1,294) and Q (1,595) each remove **one monolithic file or range** in a single
diff; a file cannot be half-deleted without leaving a broken, dead module in the
tree between commits. They are pure removals of code no other task keeps, so
they are low-risk despite the size. Every other task is ≈800 changed lines or
less.

**Target total line count.** Today 13,596. After the split: the shared backend
≈4,100 lines (seed ≈1,200, state ≈1,000, http routes ≈1,500, xmpp ≈400) +
per-app adapters ≈900 + demo docs ≈250, on top of the ≈488 kept lines. **Target
≈5,750 lines (demo docs included)**, down from 13,596 — a net removal of ≈7,900,
and ≈18,350 changed lines across the split.

## 5. Risks and open questions

- **R1 — deleted code is live.** Web `mockStore.ts` and mobile `chat-store.ts`
  are used by tests (`NODE_ENV=test` selects the mobile mock store,
  `chat-store.ts:1587`) and by component tests. Cutting over must move those
  tests to the real store + backend, or they lose their data. Budget time in the
  O, Q, R1 and R2 deletions.
- **R2 — two id schemes.** The seed must key on JIDs (§2.5); deep links that
  worked against `c-ana`/`dev-team` in mock mode change. Decide whether old mock
  deep links must keep working (mobile keeps `dev-team` for General,
  `mock/index.ts:11-12`).
- **R3 — mobile has no mock session.** The real store starts only when
  `authenticated` and `createApiClient` fails before sending without a token
  (`apps/mobile/src/lib/effect/api-client.ts:25-31`). The plan adds a mock token
  and starts the store in mock mode; this is a small architecture choice I would
  like confirmed (§5, question Q1).
- **R4 — Metro/workspace.** `apps/mobile/metro.config.js:55-69` rewrites bare
  imports only inside `packages/client-core`. If `@zilar/mock-backend` ever
  imports react or effect, it needs the same rewrite; the package is kept
  react/effect-free to avoid it.
- **R5 — binary uploads and Blob bodies.** The web mock already receives `Blob`
  bodies (`apps/web/src/lib/api.ts:1248`, `:1704`, `:1757`); the backend's HTTP
  handler must accept both a string body (contract calls) and a `Blob`
  (uploads) exactly as `mockRequest` does today.
- **R6 — bundle size.** Both apps rely on inline build conditions to keep mock
  code out of production (`apps/web/src/mock/load.ts:9`,
  `apps/mobile/src/store/chat-store-provider.tsx:47`). The new package must keep
  the same literal-condition pattern or a production build grows by ~4,200
  lines.
- **R7 — scenario coverage.** Screenshot scenarios
  (`EXPO_PUBLIC_ZILAR_MOCK_LOAD`, `…_DRAFT`, `…_SCENARIO`,
  `apps/mobile/src/mock/load.ts:19`, `mock/drafts.ts:57`, `gate.ts:20`) must
  survive as backend options, or the screenshot tests break.

### Open questions for Julio

- **Q1.** For mobile mock mode, is it acceptable that the mock backend provides
  a fake session token and the provider starts the real store even when nobody
  is logged in (so mock mode still works on a fresh emulator)? Or must mock mode
  require a real login?
- **Q2.** Must existing mock-mode deep links (`c-ana`, `dev-team`, `?mock=…`
  scenarios) keep working exactly, or may the ids change with the unified seed?
- **Q3.** Priority: is a first cut that covers chats/topics/groups/AIs/approvals
  enough to start, with stickers/voice/search/settings in a second wave? The
  split above does everything; this only affects ordering.

### Julio's answers (2026-10-10)

- **Q1: a fake session.** In mobile mock mode the backend hands out a fake session token, and the provider starts the real store with nobody logged in. Dev builds only, never production (risk R6's build conditions).
- **Q2: the ids may change.** One unified JID-keyed seed. The old mock deep links (`c-ana`, `dev-team`) and the `?mock=` scenarios are rebuilt on it, not kept as they are.
- **Q3: chats first.**
  - The first wave covers chats, messages, topics, groups, AIs and approvals: A, B, D, E, F2, then the cutovers G and H, with the dispatcher's fallback serving the rest from the old mock code.
  - The second wave covers C (prefs, folders, pins, media, backgrounds) and F (stickers, GIFs, voice, profile).
  - Then the deletion sweep.
