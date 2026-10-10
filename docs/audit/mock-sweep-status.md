# Mock sweep status (T-1059)

Read-only audit for T-1059, measured on `task/T-1059-audit-mock-sweep-status`
(2026-10-10). No code changed; the probe was a throwaway test file, since deleted.
Paths are relative to the repo root. "Backend" means `@zilar/mock-backend`
(`packages/mock-backend`).

Method for §1: a temporary vitest file called `createMockBackend({ delayMs: 0 })`
and `mockRequest(path, init, { delayMs: 0 })` for one request per route family
and printed `backend=<status|undefined>` vs `web=<status|mock_not_implemented>`.
A backend result other than `undefined` means the route matched (any status);
`undefined` means the shared backend has no route and web falls back.

## 1. Web fallback coverage

Web's dispatcher tries the shared backend first and falls back to the old
`mockRequest` for anything it does not answer: `apps/web/src/mock/backend.ts:19-25`.

Probe result, grouped. Line ranges are the `mockRequest` switch in
`apps/web/src/mock/api.ts` (the switch starts at `:2179`; the tools/routines
routes live in `toolRoutes` at `:633`).

### 1a. Backend covers it, so the old route is dead

| Family | api.ts range | Probe (backend / web) |
| --- | --- | --- |
| tools/routines (`/ais/:id/tools`, `/groups/:id/routines`, `/tools/:id[/versions|/runs|/run|/revert]`, `/routines/:id[/pause|/resume]`, `/topics/:id/tools`) | `633-822` | `200` / `200` |
| `GET/PATCH /me` | `2196-2204` | `200` / `200` |
| `GET /chats` | `2317-2319` | `200` / `200` |
| sticker-packs CRUD / upload / delete / discover | `2326-2361` | `200-400` / same |
| sticker-panel (reorder, add, remove) and `GET /stickers/:id/file` | `2367-2432` | `200-400` / same |
| sticker-favorites GET/PUT/DELETE | `2436-2464` | `200-404` / same |
| sticker-packs import/telegram | `2471-2478` | `400` / `400` |
| gifs search/trending | `2483-2498` | `200` / `200` |
| chat-prefs GET/PUT, chat-background GET/PUT | `2502-2629`, `2633-2678` | `200` / `200` |
| pins GET/POST/DELETE | `2916-2985` | `200-404` / same |
| ai-memory GET, facts DELETE, clear POST | `2987-3015` | `200-404` / same |
| contacts GET | `3017-3019` | `200` / `200` |
| ais list/create/get/patch/delete, stop/resume/machine, approval-rules | `3021-3052` | `200-404` / same |
| search GET | `3054-3056` | `200` / `200` |
| groups invite-links GET/POST/DELETE, join GET/POST | `3067-3145`, `3154-3219` | `200-404` / same |
| directory GET | `3228-3310` | `200` / `200` |
| groups by-handle / join | `3311-3353` | `200` / `200` |
| groups create / get / patch | `3354-3506` | `200-400` / same |
| groups members GET/POST/PUT role/DELETE | `3507-3612` | `200-404` / same |
| groups topics list/create | `3613-3673` | `200-400` / same |
| groups roles GET/POST/PATCH/DELETE/members | `3678-3764` | `204-400` / same |
| topics GET/PATCH, archive, members, ais, roles, tools | `3766-3919` | `200-400` / same |
| audit GET | `3920-3946` | `400` / `400` |
| groups approval-rules GET, approval-rules DELETE | `3947-3969` | `204` / `204` |
| connections GET/POST/test/DELETE | `3971-3992` | `200-404` / same |
| machines GET/pairing-codes/approve/deny/revoke/patch/delete | `3994-4056` | `200-404` / same |
| approvals GET/detail/decision | `4063-4122` | `200-400` / same |

`me` is only partly dead: `PUT /me/handle` (`api.ts:2208-2223`) still falls
back (backend has no `/me/handle`; `me/routes.ts:5-19` serves only `/me`).

### 1b. Backend lacks it, so it still falls back

| Family | api.ts range | Probe (backend / web) |
| --- | --- | --- |
| users/by-handle GET | `2232-2242` | `undefined` / `200` |
| contact-requests POST/GET/accept/decline/DELETE | `2248-2276` | `undefined` / `200-404` |
| blocks GET/PUT/DELETE | `2280-2303` | `undefined` / `200` |
| handles/check GET | `2308-2315` | `undefined` / `200` |
| backgrounds GET/POST/DELETE | `2685-2731` | `undefined` / `200-204` |
| chat-folders GET/POST/order/PATCH/DELETE | `2736-2834` | `undefined` / `200-400` |
| push config/subscriptions/settings/test | `2838-2914` | `undefined` / `200-400` |
| voice transcription GET, transcript POST | `4127-4141` | `undefined` / `200` |

These match the plan's later waves: `backgrounds`, `chat-folders` and `media`
are task **C2 / T-1045** (title "Mock backend C2: folders, backgrounds and media",
`work/T-1045-mock-backend-folders-media.md`, status `todo`); `voice` and the
`profile` handle/avatar routes are plan **F**, of which only F1 (stickers/GIFs,
`work/T-1046-mock-backend-stickers-gifs.md`, merged) was built. `/media`
(contract `packages/api-contract/src/media.ts:57`) was never in `mockRequest`;
it is served by the old web store, which task O already deleted.

### 1c. Only T-1045 covers it

`backgrounds` (`api.ts:2685-2731`) and `chat-folders` (`api.ts:2736-2834`):
no backend domain on this branch, and T-1045 (not yet merged) is the task that
adds them (`packages/mock-backend/src/domains/{chat-folders,backgrounds}` do not
exist today — `packages/mock-backend/src/domains/index.ts:6-31`).

## 2. Mobile mock switches

Twelve `use-*-api.ts` hooks still pick an old per-domain mock. Each imports
`ENV_MOCK`/`mockParamAllowed` from `@/mock/gate` and swaps the mock in when the
`?mock=`/env gate is on. A shared backend domain exists for all but
`integrations`; the adapter is the same shape everywhere: replace the mock
branch with the real factory, passing `mockFetch`
(`apps/mobile/src/mock/backend.ts:37`) as `fetchImpl` and `API_URL`
(`apps/mobile/src/lib/auth.ts:22`), like `chat-store-provider.tsx:79-88` already
does for the store.

| Hook | Old mock (factory) | Backend domain? | Real factory (`fetchImpl` arg) |
| --- | --- | --- | --- |
| `components/ais/use-ais-api.ts:33-38` | `@/mock/ais` (`mock/ais.ts:162`) | yes `ais` | `lib/ais-api.ts:114-116` |
| `components/ais/use-ai-memory-api.ts:57-59` | `@/mock/ai-memory` (`mock/ai-memory.ts:25`) | yes `ai-memory` | `lib/ai-memory-api.ts:38-40` |
| `components/ais/use-audit-api.ts:55-56` | `@/mock/audit` (`mock/audit.ts:62`) | yes `audit` | `lib/audit-api.ts:36-38` |
| `components/ais/use-tools-api.ts:56-57` | `@/mock/tools` (`mock/tools.ts:202`) | yes `tools` | `lib/tools-api.ts:158-160` |
| `components/chat/use-approvals-api.ts:58-60` | `@/mock/approvals` (`mock/approvals.ts:86`) | yes `approvals` + `approval-rules` | `lib/approvals-api.ts:118-120` |
| `components/contacts/use-contacts-api.ts:33-39` | `./contacts-mock` (`contacts-mock.ts:120`) | yes `contacts` | `lib/contacts-api.ts:123-125` |
| `components/directory/use-directory-api.ts:33-39` | `@/mock/directory` (`mock/directory.ts:60`) | yes `directory` + `public-groups` | `lib/directory-api.ts:179-181` |
| `components/machines/use-machines-api.ts:33-39` | `./machines-mock` (`machines-mock.ts:99`) | yes `machines` | `lib/machines-api.ts:48-50` |
| `components/connections/use-connections-api.ts:33-39` | `./connections-mock` (`connections-mock.ts:87`) | yes `connections` | `lib/connections-api.ts:61-63` |
| `components/settings/use-profile-api.ts:33-39` | `@/mock/profile` (`mock/profile.ts:125`) | partial: `me` only | `lib/profile-api.ts:231-233` |
| `components/stickers/use-stickers-api.ts:34-40` | `./stickers-mock` (`stickers-mock.ts:123`) | yes `stickers` | `lib/stickers-api.ts:206-208` |
| `components/integrations/use-integrations-api.ts:33-39` | `./integrations-mock` (`integrations-mock.ts:125`) | **no domain** | `lib/integrations-api.ts` |

Other places that pick a mock (not via a `use-*-api.ts`):

- `components/chat/chat-search-results.tsx:66-71` builds `createMockSearchApi()`
  (`mock/search.ts:143`) on `NODE_ENV==='test'` / `EXPO_PUBLIC_ZILAR_MOCK`; the
  backend `search` domain exists, so this becomes `createSearchApi(getSessionToken,
  mockFetch, API_URL)` (`lib/search-api.ts:54-56`).
- `components/chat/composer-sheet.ts:102` and
  `components/chat/chat-composer-dock.tsx:72,82,91` import demo data directly
  (`mock/gifs.ts` `mockDemoGifs`, `mock/attachments.ts` `mockDemoAttachments`,
  `mock/stickers.ts` `mockDemoStickerPacks`) under the same env test. The
  backend `gifs`/`stickers`/messages domains hold equivalents.
- `auth/RequireAuth.tsx:45` and `store/chat-store-provider.tsx:116` use
  `isMockMode` (`mock/gate.ts:31`) to fake the session; `gate.ts` is kept.

### Behaviour gaps between the old mocks and the backend

- **Approvals / rules.** `createMockApprovalsApi` returns `[]` from
  `listAiApprovalRules`/`listGroupApprovalRules` (`mock/approvals.ts:119-124`)
  and throws 404 from `revokeApprovalRule` (`:125-127`); the backend has a real
  `approvals` and `approval-rules` domain (`domains/index.ts:8-9,36-37`), so the
  adapter makes the AI/group rules screens work instead of empty.
- **Profile.** The mock covers profile + handle claim + avatar
  (`mock/profile.ts:125`); the backend `me` domain only serves `GET/PATCH /me`
  (`domains/me/routes.ts:5-19`) and the probe shows `PUT /me/handle` is
  `undefined`. Handle/avatar routes are missing (plan F, not built).
- **Integrations.** The mock (`components/integrations/integrations-mock.ts:125`)
  has no backend domain at all; an adapter cannot land until one is built.
- **Voice.** `mock/voice.ts` feeds `mock/messages.ts`; no backend voice domain
  (`domains/index.ts`), so voice transcript routes still fall back.

## 3. The mobile mock store

`apps/mobile/src/store/chat-store.ts` is **not reachable from any code, test
included**. `createChatStore` (`:358`) and `isMockMode` (`:1583`) have zero
importers: `grep -rn "chat-store" apps/mobile` outside the file returns nothing,
and `createChatStore` appears only at its definition. The two live `isMockMode`
importers use `@/mock/gate` instead (`auth/RequireAuth.tsx:7`,
`store/chat-store-provider.tsx:13`). The provider's old build-conditioned
`createMockStore` branch (plan §1.1) is gone; the current provider builds the
real store with `mockStoreDeps()` (`chat-store-provider.tsx:67-92,118-120`).

So `chat-store.ts` (and every `apps/mobile/src/mock/*.ts` it imports) is dead
today, pending task Q's deletion.

## 4. The old mock files

Web `apps/web/src/mock/`:

| File | Importers today | Dead after H2/sweep? |
| --- | --- | --- |
| `api.ts` | `backend.ts:12` (fallback) | yes, once all fallback domains are covered (I–R2) |
| `backend.ts` | `load.ts:9,18` | **kept** (task G) |
| `chats.ts` | `api.ts:4`, `index.ts:2` | yes |
| `groups.ts` | `api.ts:5`, `members.ts:2`, `index.ts:3` | yes |
| `helpers.ts` | `api.ts:13`, `chats.ts:2`, `messages.ts:2`, `topics.ts:2`, `index.ts:12`, `components/StickerPanel.tsx:14` | yes (StickerPanel needs an update) |
| `ids.ts` | `api.ts:3`, `helpers.ts:3`, `messages.ts:3`, `topics.ts:4`, `index.ts:1`, `auth/AuthProvider.tsx:9` | yes (`AuthProvider` touches auth) |
| `index.ts` | none | yes (already unimported) |
| `load.ts` | `lib/effect/api-client.ts:20`, `lib/api/http.ts:4`, `store/ChatStoreProvider.tsx:6` | **kept** |
| `members.ts` | `index.ts:4` | yes |
| `messages.ts` | `api.ts:6`, `chats.ts:3`, `index.ts:5` | yes |
| `topics.ts` | `api.ts:19`, `index.ts:11` | yes |
| `gate.ts` | `AuthProvider.tsx:8`, `StickerPanel.tsx:13`, `api-client.ts:19`, `api/http.ts:3`, `ChatStoreProvider.tsx:5`, `gate.test.ts` | **kept** |

Mobile `apps/mobile/src/mock/` and `components/*/*-mock.ts`:

| File | Importers today | Dead after H2? |
| --- | --- | --- |
| `ai-memory.ts` | `use-ai-memory-api.ts:16` | yes |
| `ais.ts` | `use-ais-api.ts:6,22` | yes |
| `approvals.ts` | `use-approvals-api.ts:16` | yes |
| `audit.ts` | `use-audit-api.ts:15` | yes |
| `tools.ts` | `use-tools-api.ts:15` | yes |
| `profile.ts` | `use-profile-api.ts:7,22` | yes (with F profile routes) |
| `directory.ts` | `use-directory-api.ts:6,22`, `chat-store.ts:31` | yes |
| `search.ts` | `chat-search-results.tsx:17` | yes |
| `gifs.ts` | `composer-sheet.ts:23`, `chat-composer-dock.tsx:10` | yes |
| `stickers.ts` | `chat-composer-dock.tsx:11`, `stickers-mock.ts:7` | yes |
| `attachments.ts` | `chat-composer-dock.tsx:9` | yes |
| `contacts.ts` | `chat-store.ts:32` | yes (task Q) |
| `chat-prefs.ts` | `chat-store.ts:30,588` | yes (task Q) |
| `pins.ts` | `chat-store.ts:29,649,671` | yes (task Q) |
| `invite-links.ts` | `chat-store.ts:19` | yes (task Q) |
| `channel.ts` | `index.ts:3`, `chat-store.ts:28,997` | yes (task Q) |
| `chats.ts` | `index.ts:2,29` | yes (task Q) |
| `messages.ts` | `index.ts:4,30` | yes (task Q) |
| `topics.ts` | `index.ts:5,27`, `chat-store.ts:27,818` | yes (task Q) |
| `index.ts` | `search.ts:12`, `chat-store.ts:18` | yes (task Q) |
| `voice.ts` | `messages.ts:6` | yes (task Q) |
| `drafts.ts` | `chat-store.ts:42` | kept by plan; import dies with Q |
| `time.ts` | `chats/messages/drafts/topics/channel` in mock/ | kept while `drafts.ts` stays |
| `load.ts` | `chat-store.ts:43` | kept by plan; import dies with Q |
| `gate.ts` | ten hooks + `RequireAuth.tsx:7` + `chat-store-provider.tsx:13` | **kept** |
| `backend.ts` | `chat-store-provider.tsx:70` | **kept** (task H) |
| `uploader.ts` | `chat-store-provider.tsx:72` | **kept** (T-1047) |
| `dev-kit-screen.tsx` | `app/dev/kit.tsx:13` | **kept** |
| `connections-mock.ts` | `use-connections-api.ts:6,22` | yes |
| `contacts-mock.ts` | `use-contacts-api.ts:6,22` | yes |
| `integrations-mock.ts` | `use-integrations-api.ts:6,22` | only after a backend `integrations` domain |
| `machines-mock.ts` | `use-machines-api.ts:6,22` | yes |
| `stickers-mock.ts` | `use-stickers-api.ts:8,23` | yes |

## 5. Proposed slices

Order: the H2 adapters first (each one domain group, small diffs), then the
deletions that become safe. Web deletions (W-slices) only depend on G, which is
merged, so they can run immediately; mobile deletions need their H2 to land
first. Every slice is a single diff under ~800 changed lines except the
single-file removals noted.

### H2 adapters (mobile)

1. **H2-1 AIs group** (~70 lines): `components/ais/use-ais-api.ts`,
   `use-ai-memory-api.ts`, `use-audit-api.ts`, `use-tools-api.ts` — pass
   `mockFetch` + `API_URL` to `createAisApi`/`createAiMemoryApi`/`createAuditApi`/
   `createToolsApi`; drop the old `@/mock/*` imports and `MOCK_ENV` scenarios.
2. **H2-2 Approvals** (~40 lines): `components/chat/use-approvals-api.ts` →
   `createApprovalsApi(getSessionToken, mockFetch, API_URL)`. Adds real rules.
3. **H2-3 Contacts/machines/connections/directory** (~80 lines):
   `use-contacts-api.ts`, `use-machines-api.ts`, `use-connections-api.ts`,
   `use-directory-api.ts`.
4. **H2-4 Stickers/profile/search/demo data** (~120 lines):
   `use-stickers-api.ts`, `use-profile-api.ts`, `chat-search-results.tsx`,
   `composer-sheet.ts`, `chat-composer-dock.tsx`. Needs the plan-F `me`
   handle/avatar routes for `use-profile-api.ts` (or keep that hook on the mock
   until F lands).
5. **H2-5 Integrations** — blocked until a backend `integrations` domain exists
   (plan §3: status/list only). `use-integrations-api.ts` +
   `integrations-mock.ts` remain until then.

### Deletions (each ≤ ~800 changed lines)

| Slice | Deletes | Anchor ranges | ~lines |
| --- | --- | --- | ---: |
| W1 | `api.ts` covered B/E routes | `633-822`, `2317-2319`, `2483-2498`, `2502-2629`, `2633-2678`, `2916-3019`, `3021-3056` | 530 |
| W2 | `api.ts` sticker routes | `2326-2361`, `2367-2432`, `2436-2464`, `2471-2478` | 140 |
| W3 | `api.ts` groups/members/topics | `3067-3673` | 590 |
| W4 | `api.ts` roles/topics/audit/approvals/connections/machines | `3678-4122` | 440 |
| W5 | `api.ts` state part 1 | `MockState :44`, `seedState :1028`, `resetMockApi :1285` | ~850 |
| W6 | `api.ts` state part 2 | `setMockDelay :40`, `mockRequest :2179` | ~850 |
| W7 | `api.ts` state part 3 | `searchMessages :4152` | ~848 |
| W8 | web seed files | `chats.ts`, `groups.ts`, `members.ts`, `topics.ts`, `helpers.ts`, `ids.ts`, `index.ts` + `StickerPanel.tsx`, `AuthProvider.tsx` (**auth**) | ~830 |
| W9 | web `mock/messages.ts` | `:1114` | 1,148 |
| W10 | `api.ts` remaining fallbacks after C2/F | `2208-2223`, `2232-2315`, `2685-2914`, `4127-4141` | ~230 |
| M1 (P1) | mobile `mock/{messages,topics}.ts` | `messages.ts:82`, `topics.ts:186` | 632 |
| M2 (P2) | mobile `mock/{tools,ais,ai-memory,approvals}.ts` | `tools.ts:202`, `ais.ts:45`, `ai-memory.ts:25`, `approvals.ts:86` | 787 |
| M3 (P3) | mobile `mock/{audit,directory,invite-links,profile,search}.ts` | `audit.ts:62`, `directory.ts:60`, `invite-links.ts:117`, `profile.ts:125`, `search.ts:143` | 747 |
| M4 (P4) | mobile `mock/{stickers,gifs,pins,chat-prefs,contacts,attachments,voice,channel,index,chats}.ts` | `stickers.ts:46`, … | 659 |
| M5 (Q) | mobile `store/chat-store.ts` | `createChatStore :358`, `isMockMode :1583` | 1,595 |
| M6 (R1) | `components/{stickers,contacts}/*-mock.ts` | `stickers-mock.ts:123`, `contacts-mock.ts:120` | 651 |
| M7 (R2) | `components/{machines,connections,integrations}/*-mock.ts` | `machines-mock.ts:99`, `connections-mock.ts:87`, `integrations-mock.ts:125` | 480 |

Slices that touch auth, keys or permissions code outside the mocks: **W7**
(carries `searchMessages`, which is data only), **W8** (`AuthProvider.tsx`
imports `mock/ids.ts` and must switch to the seed), **W4** (deletes the
`groups/approval-rules` and `approval-rules` routes), and **M6/M7** only if their
tests move. `M5` removes the store whose tests the plan warns about (risk R1).

### Order

1. H2-1 … H2-4 (H2-5 blocked on a backend domain).
2. W1–W4 (web route deletions; safe now that G is merged).
3. W5–W7, W8, W9 (web state/seed/messages machinery after all its callers are
   gone).
4. M1–M4 (mobile domain mocks), then M5 (store), then M6–M7 (component mocks).
5. W10 last: the remaining fallback families once C2 (backgrounds, folders,
   media) and plan F (voice, profile) are merged.

### Open question

`W8` must move `apps/web/src/auth/AuthProvider.tsx:9` (and `StickerPanel.tsx:14`)
off the deleted seed files. That is a code change, not a pure deletion, so it
needs its own allowed-files list; flagging it for the lead to scope.
