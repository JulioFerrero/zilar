---
id: T-0894
title: "api-contract chain C: move the contacts, contact-requests, directory, blocks, search, chats, drafts, handles groups into packages/api-contract; web and mobile clients derive from it"
status: merged
milestone: M5
branch: task/T-0894-contract-chain-c-people
model: auto
effort: default
depends_on: [T-0891]
estimate: 1 day
---

# T-0894: api-contract chain C

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of the simplify plan (`docs/audit/simplify-plan.md`, root cause "the client is written twice"). Today web (`apps/web/src/lib/api.ts`, 2,641 lines and 139 functions) and mobile (25 `apps/mobile/src/lib/*-api.ts` files) each hand-write schemas and fetch code for every endpoint.

T-0864 moved the pins group into `packages/api-contract` and derived both clients from it with `HttpApiClient`. T-0891 then:
- unified `Session`/`CurrentUser` with no bridge;
- gave each of the four chains its own import area and block in `packages/api-contract/src/api.ts` and `index.ts`;
- gave each group its own smoke file, `apps/server/src/<x>/contract.smoke.test.ts`, using `apps/server/src/contract-smoke-support.ts`.

**This is chain C.** It works only inside the Chain C blocks.

**Modules:** `apps/server/src/contacts/`, `apps/server/src/contact-requests/`, `apps/server/src/directory/`, `apps/server/src/blocks/`, `apps/server/src/search/`, `apps/server/src/chats/`, `apps/server/src/drafts/`, `apps/server/src/handles/`. **Mobile clients:** `apps/mobile/src/lib/contacts-api.ts`, `apps/mobile/src/lib/directory-api.ts`, `apps/mobile/src/lib/search-api.ts`, `apps/mobile/src/lib/chat-api.ts` (whichever exist).

### What to build
Follow `docs/API_CONTRACT_RECIPE.md` exactly, one group per commit. For each module:
1. **Server:** move its schemas into `packages/api-contract/src/<x>.ts`, and register the group in the Chain C import area and block of `api.ts` and `index.ts`. Keep the middleware order, the parse options and `.prefix('/api')`. The server module keeps its own `HttpApi` built from the contract group, plus `mountApi` and `routes.expected.ts`. Its existing tests must pass unchanged.
2. **Smoke test:** add `apps/server/src/<x>/contract.smoke.test.ts` covering one create or list and one error, through the derived client.
3. **Web:** in `apps/web/src/lib/api.ts`, move that group's functions onto `callApi((client) => client.<x>.<endpoint>(...))`. Keep the names, signatures and exported types, and delete the hand-written schemas.
4. **Mobile:** in `apps/mobile/src/lib/<x>-api.ts`, use `createApiClient` and `runApi` and keep the port interface. Delete the transport, the tagged errors and the schemas.
5. **What stays outside the client** (recipe step 9):
   - binary uploads and downloads (files, avatars, sticker images, media);
   - SSE streams;
   - better-auth's own endpoints, so in `auth` only the app's `/api/me` style JSON routes move.

   Leave those endpoints exactly as they are and list them in the Report.
6. **Undeclared payloads:** where a payload is still decoded by hand because declaring it would change the error order (the sweeps T-0866 to T-0873 noted these), the contract cannot type it. Leave the hand decode and declare nothing, or declare the payload only on the client side if the recipe allows it. Say which you chose, per endpoint.
7. **Measure:** report the lines removed per group (server, web, mobile, contract), and the web main bundle size (`pnpm --filter @zilar/web build`) at the start and at the end.

The wire must not change: every server route test passes unchanged. Web and mobile tests may change only where the recipe says (fetch-stub shapes, header casing, `new Response(...)` fakes), and each such edit is listed.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), `docs/API_CONTRACT_RECIPE.md`, the Reports of `work/T-0864-api-contract-pilot.md` and `work/T-0891-contract-prep-chains.md`, and `packages/api-contract/src/pins.ts` with `apps/server/src/pins/api.ts` as the worked example.

### Allowed files
`packages/api-contract/src/**` (only your chain's blocks in `api.ts` and `index.ts`), `apps/server/src/contacts/**`, `apps/server/src/contact-requests/**`, `apps/server/src/directory/**`, `apps/server/src/blocks/**`, `apps/server/src/search/**`, `apps/server/src/chats/**`, `apps/server/src/drafts/**`, `apps/server/src/handles/**`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/*.test.ts`, `apps/web/src/lib/**`, `apps/web/src/components/**/*.test.tsx`, `apps/web/src/routes/**/*.test.tsx`, `apps/web/src/store/**/*.test.ts`, `apps/web/src/store/**/*.test.tsx`, `apps/mobile/src/lib/**`, `apps/mobile/src/**/*.test.ts`, `apps/mobile/src/**/*.test.tsx`, `apps/server/src/groups/**`, `apps/server/src/invite-links/**`, `apps/server/src/roles/**`, `apps/server/src/chat-folders/**`, `apps/server/src/chat-prefs/**`, `apps/server/src/topics/**` (lead: chain A, carried by the merge of T-0892), `work/T-0894-contract-chain-c-people.md`.

Three other chains edit `apps/web/src/lib/api.ts` in parallel. Change only your groups' functions there, and never reorder or reformat other parts of the file.

### Checks (wave mode)
```bash
pnpm --filter @zilar/api-contract exec vitest run --reporter=dot
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/contacts src/contact-requests src/directory src/blocks src/search src/chats src/drafts src/handles src/authz-sweep.test.ts src/routes-manifest.test.ts
pnpm --filter @zilar/web exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/api-contract typecheck
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the full web and mobile suites once at the end, too (`pnpm --filter @zilar/web test --reporter=dot`, the same for mobile), because components use these clients.

### Acceptance
- The Checks pass.
- Every moved group has a smoke file.
- Only Allowed files change.
- Lines removed and bundle sizes are in the Report, measured.
- Live check for Julio: the screens of these groups work on web and mobile.

---

## Report (written by the worker when done)

### What moved (one commit per group)
| Group | Commit | Contract file | Smoke file |
|---|---|---|---|
| contacts | b21733a7 | `contacts.ts` | `contacts/contract.smoke.test.ts` |
| blocks | f4176949 | `blocks.ts` | `blocks/contract.smoke.test.ts` |
| contact-requests (+ `GET /api/users/by-handle/:handle`) | b04f183e | `contact-requests.ts` | `contact-requests/contract.smoke.test.ts` |
| handles | c1705325 | `handles.ts` | `handles/contract.smoke.test.ts` |
| directory | 2948ea03 | `directory.ts` | `directory/contract.smoke.test.ts` |
| search | e3d18a60 | `search.ts` | `search/contract.smoke.test.ts` |
| chats | 17e97bb6 | `chats.ts` | `chats/contract.smoke.test.ts` |

Chain C middleware tags are in the new `packages/api-contract/src/chain-c-middleware.ts` (like chains A and B, so `middleware.ts` is untouched): `ChainCSchemaErrors`, `ContactRequestsSchemaErrors`, `HandlesSchemaErrors`, `SearchSchemaErrors`, `SearchGuards` and the rate-limit tags (`BlocksWrite/Read`, `ContactRequestCreate/Read/ByHandle`, `HandlesCheck`, `Directory`) with the same key strings as before. The server layers are in `apps/server/src/blocks/chain-c-layers.ts` (`chainCSchemaErrorLayer`, and `rateLimitLayer(tag, limiter, message)`, the contract-tag twin of `makeRateLimit`); the other chain C modules import it. Each server module keeps its own `HttpApi`, `mountApi`, layers and `routes.expected.ts`; handlers return plain values. Middleware order, parse options and `.prefix('/api')` are unchanged.

### Lines removed (git numstat per commit, + added / - removed)
| Group | server | web | mobile | contract |
|---|---|---|---|---|
| contacts | +42 / -24 | +3 / -12 | +8 / -39 | +32 / -0 |
| blocks | +140 / -58 | +6 / -22 | +9 / -75 | +81 / -0 |
| contact-requests | +105 / -141 | +25 / -78 | +18 / -322 | +164 / -0 |
| handles | +74 / -61 | +26 / -31 | +0 / -0 | +84 / -0 |
| directory | +94 / -63 | +13 / -32 | +27 / -86 | +70 / -0 |
| search | +114 / -68 | +186 / -81 (new test file +127) | +55 / -183 | +92 / -0 |
| chats | +52 / -16 | +8 / -2 | +8 / -2 | +27 / -0 |

Whole task: 35 files, +1553 / -1386. The server numbers include the new smoke files and `chain-c-layers.ts` (+71); the web search number includes the new `api.chain-c.test.ts`. Hand-written client code removed: web -258 / mobile -707 (before the additions above).

### Web bundle (`pnpm --filter @zilar/web build`, main chunk `index-*.js`)
- Start (main at the worktree base dff7d6a3): 587.08 kB, gzip 164.31 kB.
- End: 587.08 kB, gzip 164.32 kB. Flat: the contract schemas replace the deleted web schemas one for one.

### Endpoints left outside the client, and why
- `drafts` (`GET /api/drafts/stream`): an SSE stream (spec step 5). I moved nothing: no contract group, no smoke file. The server module is unchanged.
- Mobile `profile-api.ts` `checkHandle`/`claimHandle` (`/api/handles/check`, `PUT /api/me/handle`): that file also owns `/api/me`, avatars and its own `ProfileApiError` with `nextChangeAt`, which belong to other groups. The handles group is in the contract and web uses it; mobile profile-api stays hand-written. Follow-up for whoever moves the profile/me group.
- Mobile `chat-api.ts` keeps its transport for `getMe`, `getGroup`, `getXmppToken` (other chains' endpoints). `getChats` and `getContacts` use the derived client; `ChatApiError` is now the shared `ApiError` (`export const ChatApiError = ApiError`), so the old transport throws the shared class too.
- Mobile `directory-api.ts` keeps its transport for `joinPublicGroup`, `getGroupVisibility`, `setGroupVisibility` (groups chain). `searchDirectory`, `lookupGroupByHandle`, `checkGroupHandle` use the client.
- Mobile `contacts-api.ts` and `search-api.ts`: no transport left.

### Undeclared payloads
- `GET /api/chats` entries: declared `Schema.Array(Schema.Unknown)` in the contract (as on the server before), because declaring the group entry would drag in the topics view schemas (chain A) and a named struct drops keys. The hand decode stays in the clients: web `chatsSchema` and mobile `parseChatsList` run on the client's body; a malformed entry still gives `invalid_response` (status 200, same text).
- Everything else is declared. `PUT /api/contact-requests` create has two success statuses (200 reverse `{request, incoming: true}` first, 201 `{request}`); both are declared and the smoke test hits both.

### Behaviour differences (deliberate, all client side; the wire is unchanged)
- `handles.check`: the server answers a query outside 1..64 characters with a 200 `{available:false, reason:'invalid'}` through its schema-error layer, but the derived client encodes the query before sending. So web `checkHandle`/`checkGroupHandle` and mobile `checkGroupHandle` return that same answer locally, without a request, for an empty or longer-than-64 handle (`HANDLE_CHECK_MIN/MAX` in the contract).
- Client-side validation (like pins): `directory.search` with `q` > 100 or `cursor` > 200, `search` with `q` empty or `limit` outside 1..50, or a non-numeric `before`, now fail locally with 400 `invalid_request` and the schema text (the server used to answer 400 `invalid_request` with its own text). A message that fails the cursor parse (`Number(before)`) is the same case.
- Strictness moves with the contract: mobile contacts/blocks rows used lenient null/optional strings (`handle`, `image`, `jid`, `decidedAt`, `incoming`); they are now strict like web (the server always sends them). A contact row now also carries `handle` on mobile.
- Search items gain an optional `match` (`exact|fuzzy`, lenient, unknown reads `exact`), and `marks` are `Int >= 0` pairs in the contract (the old clients' rule; the server's offsets are string indices, so it always holds).
- Unknown `kind` on a directory entry reads `group`, an unknown `reason` on a handle check reads `invalid` (lenient literals, as the recipe says).
- Search abort: web `callApiAbortable` (new, at the end of `apps/web/src/lib/effect/api-client.ts`) and mobile `searchMessages` run the call with `Effect.runPromise(..., { signal })`; an abort rejects with a `DOMException` named `AbortError`, never an `ApiError`, exactly as before. In web mock mode the search now goes through the same `webFetch` as the other calls (the old code had its own mock branch).

### Test edits to existing tests (each listed)
- `apps/mobile/src/lib/directory-api.test.ts` `jsonResponse`: the fake `{ ok, status, json }` became `new Response(JSON.stringify(body), { status })` (the recipe's edit; the fake lacks `headers`/`arrayBuffer`).
- `apps/mobile/src/lib/search-api.effect.test.ts`: unchanged after round 1 (chain A made `apiErrorFromBody` per-field lenient again, so the half-valid envelope tests pass as written).
- No server route test changed. `chat-api*.test.ts`, `contacts-api.test.ts` passed unchanged (they already return `Response`-like objects that the client can read).
- New tests: 7 server smoke files (2 cases each, 14 cases), `apps/web/src/lib/api.chain-c.test.ts` (7 cases: contacts and blocks arrays, the 200/201 contact-request create, the handle-check short answer, directory query building, search cursor, abort, 501).

### Commands run (wave mode; no `pnpm gate`)
- `pnpm --filter @zilar/api-contract exec vitest run --reporter=dot`: 8 passed.
- `pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/contacts src/contact-requests src/directory src/blocks src/search src/chats src/drafts src/handles src/authz-sweep.test.ts src/routes-manifest.test.ts`: 20 files, 137 passed.
- `pnpm --filter @zilar/web exec vitest run --reporter=dot src/lib`: 38 files, 365 passed. Full web suite: 182 files, 1889 passed.
- `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib`: 85 files, 767 passed. Full mobile suite: 291 files passed (2 skipped), 2682 passed, 2 skipped.
- Typecheck `api-contract`, `server`, `web`, `mobile`: all exit 0.
- `prettier --check` and `oxlint` on all 30+ changed `.ts`/`.tsx` files: clean.
- Not run: `pnpm gate`, the emulator, `pnpm phone:smoke`, a live web check.

### Round 1 (merge of chain A, `omitUndefined` audit)
- Merged `task/T-0892-contract-chain-a-groups`. One conflict, the import block at the top of `apps/web/src/lib/api.ts`: kept both lists and took A's `import type { FolderChatType, FolderIcon }` (the `FOLDER_ICONS` value import is unused after A's change).
- Audit of the nullable-optional-undefined-becomes-null bug: none of chain C's payloads or queries has a nullable optional field. The only payloads are `{handle}` (contact-request create, handles claim, both required strings); the optional fields are the query keys of `directory.search`, `search.search` and `handles.check`, which are `optional` and not nullable, and every client already builds them with conditional spreads, so no key is ever `undefined`. So `omitUndefined` was not needed anywhere; I did not copy or use it. Added a body-shape test in `apps/web/src/lib/api.chain-c.test.ts` (claim body is exactly `{handle}`; search and directory with nothing set send no query string).
- Dedup: chain A's `ChainASchemaErrors` and `chainASchemaErrorLayer` (`apps/server/src/groups/schema-errors.ts`) do exactly what my `ChainCSchemaErrors`/`chainCSchemaErrorLayer` did, so I deleted mine; blocks and directory use A's. `chain-c-middleware.ts` keeps only chain C's own tags. `iso-datetime` and `mutable-struct` are not used by chain C (no datetimes or mutable structs declared), so nothing to share.
- Checks after the merge: api-contract 11 passed; server Checks list 137 passed; full web 1908 passed; full mobile 2682 passed (2 skipped); typecheck of the four packages clean; prettier and oxlint clean.

### Process notes
- Something outside my session (an auto-commit of the dirty worktree) made three "HEAD" / "HEAD~1" / "HEAD~2" commits during the work; I squashed each back into the group commit with `git reset --soft` (local branch only, nothing pushed). The seven commits above are the final history.
- I ran `cat > /tmp/x` once by mistake (it waited for stdin and was stopped) and one empty `python3 -c 1`; neither touched the repo.
- `apps/web/src/lib/api.ts` imports from the contract in a second `import type`-style block (a multi-name `import { ..., type X } from '@zilar/api-contract'` placed below the existing single-line import) so the other chains' edits to the first import line do not conflict with mine.

### Unsure
- Live check for Julio (web and mobile): contacts list, add by @handle (new request and "already asked" Accept), requests screen (accept, decline, cancel), blocked people (block, unblock, list), Explore directory (search, open by handle), message search (type, cancel by typing on, 501 hides it), handle availability on profile and welcome (web only; mobile profile-api is still hand-written), chat list.
- The smoke test of `search` builds its own app with a fake archive pool, because the shared harness has none.

## Review (written by Claude)

**Lead, 2026-10-10: approved after round 1.**
- **What moved:** seven groups (contacts, blocks, contact-requests, handles, directory, search, chats) are in the contract, and the web and mobile clients drop 965 lines. `drafts` is SSE and stays outside.
- **Round 1:** it merges chain A, reuses A's schema-error layer and adds a body-shape test. No payload had the `undefined`→`null` risk.
- **Stray commits:** the "HEAD" commits came from a shared-scratchpad script of another worker. The content is the worker's own, and the brief now requires per-task scratch folders.
- **Check:** the combined wave 5 check passes.
- **Live check for Julio:** contacts, contact requests, blocking, search and Explore.
