---
id: T-0895
title: "api-contract chain D: move the stickers, gifs, machines, integrations, push, backgrounds, voice, media, auth groups into packages/api-contract; web and mobile clients derive from it"
status: merged
milestone: M5
branch: task/T-0895-contract-chain-d-media
model: auto
effort: default
depends_on: [T-0891]
estimate: 1 day
---

# T-0895: api-contract chain D

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of the simplify plan (`docs/audit/simplify-plan.md`, root cause "the client is written twice"). Today web (`apps/web/src/lib/api.ts`, 2,641 lines and 139 functions) and mobile (25 `apps/mobile/src/lib/*-api.ts` files) each hand-write schemas and fetch code for every endpoint.

T-0864 moved the pins group into `packages/api-contract` and derived both clients from it with `HttpApiClient`. T-0891 then:
- unified `Session`/`CurrentUser` with no bridge;
- gave each of the four chains its own import area and block in `packages/api-contract/src/api.ts` and `index.ts`;
- gave each group its own smoke file, `apps/server/src/<x>/contract.smoke.test.ts`, using `apps/server/src/contract-smoke-support.ts`.

**This is chain D.** It works only inside the Chain D blocks.

**Modules:** `apps/server/src/stickers/`, `apps/server/src/gifs/`, `apps/server/src/machines/`, `apps/server/src/integrations/`, `apps/server/src/push/`, `apps/server/src/backgrounds/`, `apps/server/src/voice/`, `apps/server/src/media/`, `apps/server/src/auth/`. **Mobile clients:** `apps/mobile/src/lib/stickers-api.ts`, `apps/mobile/src/lib/gifs-api.ts`, `apps/mobile/src/lib/machines-api.ts`, `apps/mobile/src/lib/integrations-api.ts`, `apps/mobile/src/lib/media-api.ts`, `apps/mobile/src/lib/auth-api.ts`, `apps/mobile/src/lib/profile-api.ts` (whichever exist).

### What to build
Follow `docs/API_CONTRACT_RECIPE.md` exactly, one group per commit. For each module:
1. **Server:** move its schemas into `packages/api-contract/src/<x>.ts`, and register the group in the Chain D import area and block of `api.ts` and `index.ts`. Keep the middleware order, the parse options and `.prefix('/api')`. The server module keeps its own `HttpApi` built from the contract group, plus `mountApi` and `routes.expected.ts`. Its existing tests must pass unchanged.
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
`packages/api-contract/src/**` (only your chain's blocks in `api.ts` and `index.ts`), `apps/server/src/stickers/**`, `apps/server/src/gifs/**`, `apps/server/src/machines/**`, `apps/server/src/integrations/**`, `apps/server/src/push/**`, `apps/server/src/backgrounds/**`, `apps/server/src/voice/**`, `apps/server/src/media/**`, `apps/server/src/auth/**`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/*.test.ts`, `apps/web/src/lib/**`, `apps/web/src/components/**/*.test.tsx`, `apps/web/src/routes/**/*.test.tsx`, `apps/web/src/store/**/*.test.ts`, `apps/web/src/store/**/*.test.tsx`, `apps/mobile/src/lib/**`, `apps/mobile/src/**/*.test.ts`, `apps/mobile/src/**/*.test.tsx`, `apps/server/src/groups/**`, `apps/server/src/invite-links/**`, `apps/server/src/roles/**`, `apps/server/src/chat-folders/**`, `apps/server/src/chat-prefs/**`, `apps/server/src/topics/**`, `apps/server/src/ais/**`, `apps/server/src/agents/memory/**`, `apps/server/src/connections/**`, `apps/server/src/approvals/**`, `apps/server/src/audit/**`, `apps/server/src/tools/**`, `apps/server/src/routines/**`, `apps/server/src/contacts/**`, `apps/server/src/contact-requests/**`, `apps/server/src/directory/**`, `apps/server/src/blocks/**`, `apps/server/src/search/**`, `apps/server/src/chats/**`, `apps/server/src/handles/**` (lead: chains A, B and C, carried by the merges of T-0892, T-0893 and T-0894), `work/T-0895-contract-chain-d-media.md`.

Three other chains edit `apps/web/src/lib/api.ts` in parallel. Change only your groups' functions there, and never reorder or reformat other parts of the file.

### Checks (wave mode)
```bash
pnpm --filter @zilar/api-contract exec vitest run --reporter=dot
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/stickers src/gifs src/machines src/integrations src/push src/backgrounds src/voice src/media src/auth src/authz-sweep.test.ts src/routes-manifest.test.ts
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

### Groups moved (one commit each)
integrations, push, machines, backgrounds, gifs, media, auth, stickers (all in `packages/api-contract/src/<x>.ts`, chain D blocks of `api.ts`/`index.ts`, smoke file per group). Plus a middleware-tags commit and a final `omitUndefined`/test/prettier commit. Chain A (T-0892) was merged in (clean, no conflicts) as the lead asked.

### Not moved, and why (endpoints left outside the derived client)
- `voice` (`POST /api/voice`): raw audio in, raw bytes out; no JSON, so no contract group.
- Binary: backgrounds `upload`/`getFile`, stickers `uploadSticker`/`serveFile`, gifs `media`. They are declared in the contract without payload/success so the server builds from it, but clients do not call them.
- Undeclared payload/query (server decodes by hand to keep the step order and fixed texts; I declared nothing, per spec item 6): push `subscribe`/`updateSettings`/`test`; machines `rename`/`pair`; gifs `search`/`trending` (query); media `gallery` (query); stickers `discover`, `removeFavorite` (query), `importTelegram`. Web keeps `request()` for these, decoding with the contract reply schema. (Option for a follow-up: declare the payload and serve with `handleRaw`, as auth `patchMe` already does.)
- Mobile left unchanged: `stickers-api.ts`, `gifs-api.ts`, `media-api.ts`. They deliberately drop malformed rows and tolerate drifted optional fields; the strict contract decode would change that behaviour. Mobile `integrations-api.ts` keeps hand-written voice-transcription calls (module not in any chain), and `machines-api.ts` keeps `renameMachine` and `setAiMachine` (AIs module is chain C). Both use the new shared `apps/mobile/src/lib/effect/raw-request.ts` (bearer, ApiError only). `checkInvite` (public, pinned fetch init) stays a plain fetch.
- better-auth endpoints untouched.

### Decisions / deviations
- `apps/server/src/effect/http-core.ts` is not in Allowed files, so the contract has its own `ChainDSchemaErrors` tag (`chain-d-middleware.ts`, like chain C), and two small server helpers in the allowed `apps/server/src/auth/`: `schema-errors.ts` (layer) and `rate-limit-layer.ts` (layer for a contract rate-limit tag). Suggest folding them into http-core later.
- Dates the server returned as `Date` (machines, invites) are mapped to ISO strings in the handler; wire unchanged.
- `STICKER_*` limits now live in the contract; `stickers/service.ts` re-exports them. `isMailbox` moved to the contract.
- Web `StickerPack` keeps a mutable `stickers` array (editor takes `Sticker[]`; `PackEditor` is outside Allowed).
- Names: `AuthMe`/`AuthInvite` in the contract (web aliases `Me`/`Invite`).

### Test edits (existing tests)
Fake `{ok,status,json}` responses became `new Response(...)` in: web `useIsServerOwner.test.tsx`, `IntegrationsPage.test.tsx`, `NotificationsPage.test.tsx`, `InstallMenu.test.tsx`, `StickersPage.test.tsx`, `AddMachineDialog.test.tsx`, `MachinesPage.test.tsx` (204 gets a null body), `AiPanel.test.tsx`. Mobile `auth-api.test.ts`: error `name` `'AuthApiError'` -> `'ApiError'`. (I briefly edited `invites-api.effect.test.ts`, then restored it after chain A's merged `apiErrorFromBody` kept the old per-field behaviour.) Server tests: none edited.
New tests: 8 server `contract.smoke.test.ts` files (integrations, push, machines, backgrounds, gifs, media, auth, stickers), web `api.chain-d.test.ts` (body shapes, 5 cases).

### omitUndefined (lead note)
Reused chain A's `omitUndefined` for `createStickerPack` and `patchStickerPack`; the other optional payloads (email key) are already built conditionally. Body-shape test in `api.chain-d.test.ts`. No copy of the helper, `iso-datetime` or `mutable-struct`.

### Measured
- Web main chunk (`index-*.js`): base main 587.08 kB raw / 164.31 kB gzip; now 587.09 kB / 164.52 kB (includes the merged chain A; no cut visible because the server-only schemas moved, not web ones).
- Lines (non-test, vs main, mine only): server stickers +37/-198, gifs +7/-49, machines +34/-96, integrations +10/-119, push +5/-70, backgrounds +19/-74, media +8/-51, auth +77/-93 (includes new helper files). Contract: new files ~1,000 lines. Web `api.ts` and mobile `lib` diffs vs main include chain A's merge, so a clean per-group number is not separable; mobile: `integrations-api` +53/-200, `machines-api` +33/-255, `auth-api` +48/-159, `invites-api` +11/-138, new `raw-request.ts` +48.

### Checks (wave mode, no `pnpm gate`)
api-contract 11 passed; server Checks list 474 passed, 6 skipped; web full 1904 passed; mobile full 2680+ passed after the restore (invites 10/10); typecheck api-contract/server/web/mobile: 0 errors; prettier/oxlint on changed files clean.

### Unsure
- Behaviour: client-side encode now rejects bad input before sending (400 `invalid_request`, same as pins); mobile `fetchMe` with a non-string `jid` is `invalid_response` instead of null; machine `status` unknown decodes to `pending`.
- Not run on a device or the emulator.
- Process: several files first written with shell heredocs (`chain-d-middleware.ts` append, early integrations/contract files) instead of Edit/Write.

## Review (written by Claude)

**Lead, 2026-10-10: approved, with follow-ups.**
- **What moved:** the JSON parts of eight groups (integrations, push, machines, backgrounds, gifs, media, auth, stickers). Binary, voice and better-auth endpoints stay outside, and the sticker payloads use `omitUndefined`.
- **Follow-ups:**
  - Many endpoints are still hand-decoded, so web keeps `request()` for them: push subscribe and settings, machines rename and pair, gifs search, the media gallery, and sticker discover and import. They should be declared and served with `handleRaw`.
  - Mobile's stickers, gifs and media clients stay hand-written, because they drop malformed rows on purpose.
  - Chains C and D have their own schema-error tags, which should be folded into `http-core`.
- **Check:** the combined wave 5 check passes.
- **Live check for Julio:** stickers, gifs, push settings, machines and integrations.
