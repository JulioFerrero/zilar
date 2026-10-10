---
id: T-0897
title: "api-contract tidy: one middleware file and one schema-error layer, the chain lists merged, hand-decoded payloads declared and served with handleRaw, duplicate groups removed"
status: merged
milestone: M5
branch: task/T-0897-contract-tidy
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-0897: api-contract tidy

## Spec (written by Claude, do not edit)

### Why
Wave 5 (T-0892 to T-0895) moved 28 groups into `packages/api-contract`. To avoid conflicts between parallel chains, it left these behind:
- **Per-chain middleware files in the contract:** `packages/api-contract/src/chain-a-middleware.ts`, `chain-c-middleware.ts`, `chain-d-middleware.ts` and `middleware-chain-b.ts`, next to `middleware.ts`.
- **Per-module schema-error and rate-limit layers on the server:** `apps/server/src/groups/schema-errors.ts`, `apps/server/src/auth/schema-errors.ts` and `apps/server/src/auth/rate-limit-layer.ts`, plus small layers inside module `api.ts` files. The shared ones are in `apps/server/src/effect/http-core.ts` and `apps/server/src/effect/rate-limit-middleware.ts`.
- **Four `chainXGroups` arrays** in `packages/api-contract/src/api.ts`.
- **Hand-decoded endpoints** that the contract cannot type, so web still calls them with `request()` (19 calls in `apps/web/src/lib/api.ts`):
  - connections `create`;
  - tools `revert` and `run`;
  - push `subscribe`, `updateSettings` and `test`;
  - machines `rename` and `pair`;
  - gifs `search` and `trending`;
  - media `gallery`;
  - stickers `discover`, `removeFavorite` and `importTelegram`.
- **Duplicate groups:** connections and tools each exist twice in the contract, as a client version with the payload and a server version without it.

`apps/server/src/auth/api.ts:121-137` already shows the fix for hand-decoded endpoints: declare the payload in the contract and serve it with `handleRaw`, so the handler keeps its own decode order (for example a 503 or 501 before a 400).

### What to build, one commit per item
1. **Contract middleware:** merge the four chain middleware files into `packages/api-contract/src/middleware.ts` and update the imports. Merge the four `chainXGroups` arrays into one list in `api.ts`, and the chain blocks in `index.ts` into one sorted list.
2. **Server layers:**
   - Fold the per-module schema-error layers and tags into one shared layer in `apps/server/src/effect/http-core.ts`, and the rate-limit layers into `apps/server/src/effect/rate-limit-middleware.ts`.
   - The rate-limit layer should take a `Pick<RateLimiter, 'allow'>`, a wave 4 follow-up; check the `RateLimiter` type first.
   - Delete `groups/schema-errors.ts`, `auth/schema-errors.ts` and `auth/rate-limit-layer.ts` once nothing imports them.
3. **Hand-decoded endpoints:** for each one listed above, declare its payload or query in the contract and serve it with `handleRaw` wherever the handler's own decode order must stay. Delete the duplicate client and server groups for connections and tools. Then move the web and mobile functions for these endpoints onto the derived client, keeping their names and signatures. Mobile stickers, gifs and media keep their lenient row decoding: if the strict contract response would change that, keep their hand-written row decode on top of the client call, and say which endpoints stay hand-written in the Report.
4. **Update `docs/API_CONTRACT_RECIPE.md`:** no more chain blocks, and the `handleRaw` pattern for hand-decoded endpoints.

**The wire must not change:** every server route test passes unchanged, including the status and error-order tests.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/<task id>/`), `docs/API_CONTRACT_RECIPE.md`, and the Reports and Reviews of `work/T-0892-*.md` to `work/T-0895-*.md`.

### Allowed files
`packages/api-contract/src/**`, `apps/server/src/**/api.ts`, `apps/server/src/**/contract.smoke.test.ts`, `apps/server/src/effect/http-core.ts`, `apps/server/src/effect/rate-limit-middleware.ts`, `apps/server/src/effect/*.test.ts`, `apps/server/src/groups/schema-errors.ts`, `apps/server/src/auth/**`, `apps/server/src/connections/**`, `apps/server/src/tools/**`, `apps/server/src/blocks/**`, `apps/server/src/contract-smoke-support.ts`, `apps/web/src/lib/**`, `apps/web/src/components/**/*.test.tsx`, `apps/web/src/routes/**/*.test.tsx`, `apps/mobile/src/lib/**`, `docs/API_CONTRACT_RECIPE.md`, `work/T-0897-contract-tidy.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/api-contract exec vitest run --reporter=dot
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib
pnpm --filter @zilar/api-contract typecheck
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the full server suite once at the end. Every module's `api.ts` changes, so it is the guard.

### Acceptance
- The Checks pass, and no server route test is edited.
- The contract has one middleware file and no chain arrays, and the server has one schema-error layer.
- The Report lists every endpoint still outside the client, with a reason.
- Report the lines removed.

---

## Report (written by the worker when done)

### Commits
- `ff5a4543` item 1: the four chain middleware files are merged into `packages/api-contract/src/middleware.ts`; `api.ts` has one alphabetical group list; `index.ts` one alphabetical export list. `ChainASchemaErrors` and `ChainDSchemaErrors` are one `SchemaErrors` tag (same key as the old server tag, now declared in the contract; `http-core.ts` re-exports it).
- `16d5d873` item 2: `rateLimitLayer(tag, limiter: Pick<RateLimiter,'allow'>, message)` and `schemaErrorLayerFor(tag, logger, message | render)` are the only layers (`effect/rate-limit-middleware.ts`, `effect/http-core.ts`). Deleted `groups/schema-errors.ts`, `auth/schema-errors.ts`, `auth/rate-limit-layer.ts`, `blocks/chain-c-layers.ts`, and every module-local `schemaErrorLayer` / `writeRateLimitLayer` (pins, memory, ais, handles, stickers, tools, routines, audit, approvals, search, contact-requests). The `PinsSchemaErrors`, `AiMemorySchemaErrors`, `ToolsSchemaErrors` and `RoutinesSchemaErrors` tags did the same as `SchemaErrors` and are gone. Tags with a fixed or typed answer stay (audit, approvals, ais, search, contact-requests, handles, stickers) and use `schemaErrorLayerFor`. `makeRateLimit` (xmpp) now builds on `rateLimitLayer`.
- `8e9bae44` item 3: see below.
- Item 4: `docs/API_CONTRACT_RECIPE.md` rewritten (no chain blocks; `handleRaw` and `RawQueryValue` patterns; the mobile lenient-client rule). Committed with this Report.

### Item 3: what changed
- Duplicate groups: `ConnectionsServerGroup` and `ToolsServerGroup` are deleted. The servers use `ConnectionsGroup` / `ToolsGroup` and serve `create`, `revert` and `run` with `handleRaw` (the handlers are unchanged, so 503/400/404/429/501 order is unchanged).
- Payloads declared and served with `handleRaw`: push `subscribe`, `updateSettings`, `test` (`RegisterPushDevicePayload`, `PushSettingsPayload`, `PushTestPayload`), machines `rename` and `pair` (`RenameMachinePayload`, `PairMachinePayload`, moved from `machines/api.ts`), stickers `importTelegram` (`ImportTelegramPayload`). The servers decode with the contract schemas (one copy).
- Queries: `handleRaw` skips only the payload decode, the router always decodes a declared query first. So gifs `search`/`trending`, media `gallery`, stickers `discover` and `removeFavorite` declare each key as `RawQueryValue` (new `packages/api-contract/src/raw-query.ts`: a string or a list, never fails). Their handlers are unchanged and still hand-decode the raw URL after their guards (501, limiter). Smoke test added: a repeated `q` still reaches the 501 guard.
- Web (`apps/web/src/lib/api.ts`): `renameMachine`, `registerPushDevice`, `setPushSettings`, `sendTestPushNotification`, `discoverStickerPacks`, `removeStickerFavorite`, `importTelegramStickers`, `listChatMedia`, `searchGifs`, `trendingGifs` now call the derived client (`callApiAbortable` for the gifs, which keeps the abort behaviour). Names and signatures are unchanged. The hand-written `gifRequest` is gone. Web `connections.create`, `tools.revert/run` were already on the client.
- Mobile: only `renameMachine` moved to the client.

### Lines removed
`git diff --numstat main...HEAD`: 904 added, 1344 removed (net -440), 72 files.

### Endpoints still outside the client
- Mobile `gifs-api.ts`, `media-api.ts`, `stickers-api.ts` (all their calls, not only the ones in the spec): they drop a malformed row and keep the page. The derived client decodes the whole response strictly, so one bad row would fail the page. They would need a lenient response schema in the contract first; left hand-written.
- Mobile `integrations-api.ts` (`rawRequest`) and mobile `setAiMachine` (`PUT /api/ais/:id/machine`): not in the spec list, untouched.
- Web: `/xmpp/token`, `/voice/*` and `/settings/integrations/voice-transcription`, `/setup`, `/setup/status`, `/avatars/*` upload and delete, sticker file upload, background upload: not in the contract (voice, setup, avatars, xmpp) or raw bytes (uploads, media proxy, SSE).
- Machines `pair` is declared in the contract but no app calls it (the runner does); the server serves it with `handleRaw`.

### Test edits
- No server route test edited.
- `apps/server/src/gifs/contract.smoke.test.ts` and `apps/server/src/media/contract.smoke.test.ts` (allowed smoke files): `trending()`, `search()` and `gallery()` now take `{ query: {} }` because the client types the query. One new case in the gifs smoke test (repeated `q` reaches the 501 guard).
- No web or mobile test edited; all pass unchanged.

### Behaviour differences
- Web/mobile `renameMachine` trims the name before sending. An empty or blank name, `sendTestPushNotification('')` and similar now fail on the client with `ApiError(400, 'invalid_request', <schema text>)` instead of the server's 400 text. The UI does not send them.
- Request headers now also carry the client's trace headers (`b3`, `traceparent`), as every other contract call does; query strings are identical (`URLSearchParams` form), bodies identical JSON.
- No wire change on the server: every server route test passes unchanged.

### Commands
- `pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000`: 191 files passed, 7 skipped; 2344 passed, 10 skipped.
- `pnpm --filter @zilar/web exec vitest run --reporter=dot`: 185 files, 1918 passed.
- `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib`: 85 files, 767 passed.
- `pnpm --filter @zilar/api-contract exec vitest run --reporter=dot`: 3 files, 11 passed.
- Typecheck of api-contract, server, web, mobile: clean. Prettier and oxlint on the changed files: clean. `pnpm gate` not run (wave mode).

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **Contract:** one `middleware.ts`, one group list, and one `SchemaErrors` tag.
- **Server:** one rate-limit layer and one schema-error layer, and the four per-module layer files are deleted.
- **Duplicates:** the duplicate connections and tools groups are gone.
- **Hand-decoded endpoints:** declared and served with `handleRaw`. The query endpoints use `RawQueryValue`, which keeps the handlers' own guards and 400 texts. I accept that choice, because it keeps the wire identical.
- **Tests:** the full server suite passes, no route test was edited, and the size is net −440.
- **Follow-up:** the mobile gifs, media and stickers clients stay hand-written until the contract has lenient row schemas.
- **Check:** the combined wave 6 check passes.
