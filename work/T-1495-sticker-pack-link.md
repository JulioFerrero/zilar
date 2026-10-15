---
id: T-1495
title: "Sticker pack links (Julio, 2026-10-15): GET /sticker-packs/:id returns a pack to any signed-in user who has its id, with the owner's handle and whether it is in my panel; a private pack can be added by id; Discover still lists only shared packs"
status: merged
milestone: M5
branch: task/T-1495-sticker-pack-link
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-1495: Sticker pack links (server)

## Spec (written by Claude, do not edit)

### Why
Julio decided on 2026-10-15 that every sticker pack has a link, `https://chat.zilar.app/stickers/<packId>`, like Telegram and Signal. Anyone signed in who has the link can open the pack and add it to their panel. "Shared" still means listed in Discover.

The web and phone pages come later. This task is the server and the mock. The design is in `docs/design/mockups/stickers/` (`WebPack.dc.html`, `PhonePack.dc.html`, `README.md`).

### Facts (the lead read them on main, 2026-10-15)
- **The contract,** `packages/api-contract/src/stickers.ts` (205 lines):
  - `StickerPack` (`:98-108`) has `id`, `ownerId`, `title`, `visibility` (`'private' | 'server'`), an optional `importedFrom`, `stickers`, `createdAt` and `updatedAt`;
  - the endpoints are at `:140-200`;
  - there is `GET /sticker-packs` (`listPacks`, `:140`) and `GET /sticker-packs/discover` (`:147`), but **no `GET /sticker-packs/:id`**.
- **`apps/server/src/stickers/storage.ts:77-98`, `requireVisiblePack`:** a pack that is not `server` and not the caller's answers 404 "so pack ids cannot be probed". Its only caller is `addPanelPack` (`panel.ts:18`).
- **`requireOwnedPack`** (`storage.ts:100-…`) guards every edit, and stays as it is.
- **Pack ids** are `randomUUID()` (`packs.ts:83`), so a link is unguessable.
- **Imported Telegram packs stay private for personal use:** `patchPack` refuses `visibility: 'server'` for a pack with `importedFrom`, answering 400 `imported_private` (`apps/server/src/stickers/packs.ts:141-142`). A link must not get around that.
- **A user's handle:** `SELECT handle FROM handles WHERE user_id = … LIMIT 1` (as at `apps/server/src/auth/api.ts:356`).
- **Handlers** are in `apps/server/src/stickers/api-handlers.ts` (284 lines); `listPacks` is at `:92`. `packs.ts` has 302 lines.
- **There are no sticker tests today.** The route tests use `../test-support` (see `apps/server/src/auth/invites.test.ts:4-8`).
- **The mock's sticker routes** are in `packages/mock-backend/src/domains/stickers/routes.ts`.

### What to build
1. **Contract:**
   - add `StickerPackDetail = Schema.Struct({ ...StickerPack.fields, ownerHandle: Schema.NullOr(Schema.String), inPanel: Schema.Boolean })`;
   - add `HttpApiEndpoint.get('getPack', '/sticker-packs/:id', { params: { id: Schema.String }, success: StickerPackDetail })`, placed after `discover`, so `/sticker-packs/discover` keeps its own route.
2. **New `apps/server/src/stickers/pack-link.ts`:** `getPackDetail(deps, packId, userId)`.
   - It loads the pack and its stickers in pack order, the same way `listPacks` builds a `StickerPack`. Reuse that code; don't copy it.
   - It adds the owner's handle (`null` when there is none) and `inPanel`, true when a `user_sticker_packs` row exists for the caller.
   - A missing id or a malformed one answers 404 `not_found`.
   - **Any signed-in user may read any pack by id,** private or shared, **except an imported pack** (`importedFrom` set), which stays visible only to its owner: anyone else gets the same 404.
3. **`storage.ts` `requireVisiblePack`:**
   - a pack that exists is visible to any signed-in caller, except an imported pack, which is visible only to its owner;
   - keep the 404 for a missing id or a hidden one;
   - rewrite the comment: links make the id the capability, ids are random UUIDs, and imported packs stay personal.
   - `addPanelPack` then accepts a private pack by id. `getPackDetail` uses the same check.
   - Discover's own `visibility = 'server'` filter (`packs.ts:271`) stays.
4. **Handler:** wire `getPack` in `api-handlers.ts`. If that file would pass 400 lines, put the handler in `pack-link.ts`.
5. **Mock:** in `packages/mock-backend/src/domains/stickers/routes.ts`, add the same `GET /sticker-packs/:id` (owner handle from the mock people, `inPanel` from the mock panel), and allow adding a private pack by id, with the same imported-pack rule.
6. **Tests** (permissions are crucial code), in a new `apps/server/src/stickers/pack-link.test.ts` modelled on `auth/invites.test.ts`:
   - a non-owner reads another user's **private** pack by id: 200, with its stickers, `ownerHandle`, and `inPanel: false`;
   - after `PUT /sticker-panel/:packId`, it reads `inPanel: true`;
   - the non-owner still cannot `PATCH` or `DELETE` that pack, and gets today's answer;
   - an unknown id answers 404;
   - another user's **imported** pack answers 404 to `GET` and to `PUT /sticker-panel/:packId`, while its owner still reads it;
   - `GET /sticker-packs/discover` still answers, listing shared packs only (not the private one).
7. Every file stays at most 400 lines.

### Allowed files
- `packages/api-contract/src/stickers.ts`
- `apps/server/src/stickers/pack-link.ts`
- `apps/server/src/stickers/pack-link.test.ts`
- `apps/server/src/stickers/storage.ts`
- `apps/server/src/stickers/api-handlers.ts`
- `apps/server/src/stickers/packs.ts`
- `packages/mock-backend/src/domains/stickers/routes.ts`
- `work/T-1495-sticker-pack-link.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/stickers/pack-link.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and the new tests pass.
- **After the deploy, the lead calls the new get-pack route live:** signed out, it answers 401 for any pack id, and `/api/sticker-packs/discover` still answers 401, not a 404 from the new route.

---

## Report (written by the worker when done)

### What I did

**Contract** (`packages/api-contract/src/stickers.ts`): added `StickerPackDetail`
(`...StickerPack.fields` + `ownerHandle: NullOr(String)` + `inPanel: Boolean`) and
the `getPack` endpoint `GET /sticker-packs/:id`, declared right after `discover`
so `/sticker-packs/discover` keeps its own route.

**`apps/server/src/stickers/storage.ts`**: `requireVisiblePack` now treats the id
as the capability — any signed-in caller may read any existing pack, except an
imported pack (`importedFrom` set), which stays visible only to its owner; a
missing id and a hidden one keep the same 404. Rewrote the comment to say this.
Added `loadPackStickers(deps, packId)` (the pack's stickers in pack order) so the
query lives in one place.

**`apps/server/src/stickers/packs.ts`**: `patchPack` now loads its stickers
through `loadPackStickers` instead of repeating the query. Discover's
`visibility = 'server'` filter and `patchPack`'s `imported_private` guard are
unchanged.

**`apps/server/src/stickers/pack-link.ts`** (new): `getPackDetail(deps, packId,
userId)` — checks visibility with `requireVisiblePack`, reads the owner's handle
(`null` when none), reads whether the caller's panel holds the pack, and builds
the pack with `toPackView` (same code `listPacks` uses).

**`apps/server/src/stickers/api-handlers.ts`**: wired `getPack`, decoding the id
with `decodePathId` (a malformed escape is the same 404).

**`packages/mock-backend/src/domains/stickers/routes.ts`**: added
`GET /sticker-packs/:id` (returns the pack, `ownerHandle` from `data.me.handle`
or a seed person via `personHandle`, `inPanel` from `data.stickerPanel`) with the
same imported-pack rule; `PUT /sticker-panel/:packId` now answers the same 404
for an unknown or hidden-imported pack instead of silently returning `ok`.

**`apps/server/src/stickers/pack-link.test.ts`** (new): 6 tests — a non-owner
opens another user's private pack (stickers, `ownerHandle`, `inPanel: false`),
`inPanel` flips to true after `PUT /sticker-panel/:packId`, non-owner
`PATCH`/`DELETE` answer 404, an unknown id answers 404, an imported pack 404s for
everyone but its importer (on both `GET` and `PUT` panel), and `/discover` still
lists shared packs only.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/stickers/pack-link.test.ts` → `6 passed (6)`.
- `pnpm gate` (from the repo root):
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.2s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/api-contract (no nearby test files)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (4.4s)
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Scope lists 9 files I did not touch.** The gate's scope check diffs against
  `main...HEAD`, which includes the branch's own setup commit `95c78961b
  "T-1495: approved sticker boards"` that added
  `docs/design/mockups/stickers/*` (9 files). They are not part of this task's
  Allowed files and I made no edits to them; I could not make the scope list
  clean without touching files outside scope or rewriting the branch, which the
  rules forbid. Every file I changed is inside the Allowed files.
- `apps/server/src/stickers/api.ts` still says "All 14 routes are mounted here";
  the count is now 15. That file is not in the Allowed files, so I left it.
- The mock's `PUT /sticker-panel/:packId` now 404s an unknown pack (previously
  it returned `{ ok: true }`); this matches the server's `requireVisiblePack`.
- No migration was needed. The live acceptance call (401 signed out for the new
  route, `/discover` still 401) is a deploy-time check I cannot run here.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** the packet was clean (0 must-fix, 0 should-fix, 3 nits, 1 follow-up) for head `183ad3d3e`, and its 6 tests pass.
- **The permission change is exactly the spec:**
  - `requireVisiblePack` now hides only another user's imported pack, with the same 404 as an unknown id;
  - edits still go through `requireOwnedPack`;
  - `getPackDetail` adds the owner's handle and the caller's own `inPanel`;
  - Discover still filters on `visibility = 'server'`.
- **Images:** sticker files are already capability URLs for anyone signed in (`api-handlers.ts:258-282`, `readStickerFile` has no pack check), so a link viewer can load a private pack's images.
- **Left as they are:**
  - the stale "14 routes" counts in `api.ts:5` and `api-handlers.ts:2`;
  - the mock's bare `decodeURIComponent`;
  - no test for a malformed id, which uses the shared `decodePathId` like the other routes.
- **After the deploy,** the lead calls the new route signed out.

