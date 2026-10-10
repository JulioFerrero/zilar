---
id: T-0867
title: "Server sweep: stickers, avatars, backgrounds, files onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses"
status: merged
milestone: M5
branch: task/T-0867-sweep-media-files
model: auto
effort: default
depends_on: [T-0863]
estimate: 0.5 day
---

# T-0867: Server sweep: stickers, avatars, backgrounds, files onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Phase 2 of the simplify plan (C-F1 to C-F5, B-B1 and B-B4 in `docs/audit/simplify-2026-10-09/C-server.md` and `docs/audit/simplify-2026-10-09/B-api-contract.md`). T-0863 built the helpers, converted blocks and roles, and wrote the recipe: read the Report section "How to convert a module" in `work/T-0863-server-http-helpers.md` and follow it exactly. One rule changed in round 1: each converted module gets `<module>/routes.expected.ts` holding its old route array, and `routes-manifest.test.ts` is not edited.

**Modules in this task:** `apps/server/src/stickers/`, `apps/server/src/avatars/`, `apps/server/src/backgrounds/`, `apps/server/src/files/`.

**Success statuses to make truthful in these modules** (B-B1; the server sends a status its HttpApi declaration does not say, which a derived client will reject):
- creates at `stickers/api.ts:468,771` send 201 through `jsonUnsafe` while they declare 200; a payload is decoded by hand at about `:514`
- create at `backgrounds/api.ts:210` sends 201; `:148,152` and `:274` declare `Void` but send 204

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
For each module, one commit per module:
1. Apply the T-0863 recipe, steps 1-6:
   - drop the local `runSql` copy;
   - use the shared `SchemaErrors`;
   - use `makeRateLimit` for the plain rate limits, keeping the tag strings and middleware order. Middlewares that are not plain limits, such as search `SearchGuards` and voice `TranscriptConfigured`/`VoiceSettingsOwnerLimit`, stay as they are;
   - write handlers with `handler(logger, ...)`;
   - end `createXApi` with `mountApi`;
   - move the old `*_API_ROUTES` array to `<module>/routes.expected.ts`.
2. **Truthful statuses** for the sites listed above:
   - for a 201, declare it with `HttpApiSchema.status(201)` or the 4.0.2 equivalent (check the .d.ts and how T-0864 did pins in `apps/server/src/pins/api.ts`), and return the value instead of `jsonUnsafe(…, { status: 201 })`;
   - for a 204, use `HttpApiSchema.NoContent` or its equivalent;
   - where a payload is decoded by hand, declare the payload schema. If the existing error order must stay (for example a 503 before decode), keep the hand decode but still declare the schema, and say so.

   Bodies, status codes and headers on the wire must stay byte-identical. The existing route tests assert them.
3. Count the lines removed per module (`git diff --numstat`).

The existing tests of these modules, `authz-sweep.test.ts` and `routes-manifest.test.ts` must pass unchanged. Use --testTimeout=120000 --hookTimeout=120000 because the machine is shared.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`apps/server/src/stickers/**`, `apps/server/src/avatars/**`, `apps/server/src/backgrounds/**`, `apps/server/src/files/**`, `work/T-0867-sweep-media-files.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/stickers src/avatars src/backgrounds src/files src/authz-sweep.test.ts src/routes-manifest.test.ts
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.

---

## Report (written by the worker when done)

### Commits (one per module)
- backgrounds, avatars, files, stickers: see `git log` (T-0867 commits on this branch).

### Lines removed (git numstat, +added/-removed)
- backgrounds: `api.ts` +76/-150, `service.ts` +1/-11, new `routes.expected.ts` +8.
- avatars: `api.ts` +38/-69, `service.ts` +1/-11, new `routes.expected.ts` +7.
- files: `api.ts` +11/-32, new `routes.expected.ts` +3.
- stickers: `api.ts` +179/-277, `service.ts` +31/-41 (most are the 28 call-site edits `runSql(deps` to `runSql(deps.db` plus prettier), new `routes.expected.ts` +19.
- Total: +366/-691 in the four modules, net -325 (the four `routes.expected.ts` files add 37 of the added lines).

### Truthful statuses
- backgrounds: upload declares 201 (`HttpApiSchema.status(201)`) and returns the value; remove declares `HttpApiSchema.NoContent` and returns nothing (wire 204); `getFile` declared `Void` but sends 200 raw bytes, now `HttpApiSchema.Empty(200)`. The audit's `:148,152` are `getFile` (200, not 204) and `remove` (204).
- stickers: `createPack` and `uploadSticker` declare 201 (`StickerPackCreated`, `StickerCreated`) and return the value instead of `jsonUnsafe(..., { status: 201 })`; `serveFile` declared no success (the default would be 204), now `HttpApiSchema.Empty(200)`. The audit lines `:468,771` matched `createPack` and `uploadSticker`.
- Hand-decoded payload at the Telegram import (about `:514`): kept as a hand decode and NOT declared as the endpoint payload. HttpApi decodes a declared payload before any handler code, which would turn the specified 501 `import_unavailable` (token missing) into a 400 for a malformed body. A comment in the handler says so. The same reasoning left the hand-decoded queries (discover, favorite delete) and the avatar/file/background body readers as they were.

### What stays local, and why
- stickers keeps its own `StickersSchemaErrors`: its 400 message is picked per route, so the shared `SchemaErrors` text would change the wire.
- backgrounds uses the shared `SchemaErrors` as the spec says; the old local layer answered 404 `not_found`. Its params are plain strings, so the decode never fails and nothing changes on the wire.
- avatars and files got no schema-error middleware (they had none; their params are plain strings).
- avatars: the upload limiter stays in the handler, after `checkAvatarWritePermission` (a stranger must not burn the owner's budget). files: the limiter stays in the handler, after the 501 archive check. Stickers: the Telegram import limiter stays in the handler (after the 501 token check and the input parse). All three are not plain limits.
- Plain limits moved to `makeRateLimit`: backgrounds upload (`zilar/effect/http/BackgroundsUploadRateLimit`) and stickers upload (`zilar/effect/http/StickersUploadRateLimit`); same messages. In both modules the injected `uploadLimiter` only has `allow`, while `makeRateLimit.layer` wants a full `RateLimiter`: the module wraps it as `{ allow, size: 0 }`. Suggestion for the lead: widen `layer(limiter: Pick<RateLimiter, 'allow'>)` in a later task, and the wrapper goes away.
- The 8 `sqlRuntimeFor(deps.db).runPromise(...)` calls in `stickers/service.ts` inside transactions or with other shapes were not touched (the spec asks to drop the local `runSql` copy only).

### Checks
- `vitest run src/stickers src/avatars src/backgrounds src/files src/authz-sweep.test.ts src/routes-manifest.test.ts` (timeouts 120000): 11 files, 146 tests passed, 3 of 3 runs after the last commit. Machine load was 55 to 75 (`uptime`), runs took 239 s to 302 s. Single-module runs earlier: stickers plus manifest 96 tests, avatars plus manifest 19, files plus manifest 15, backgrounds plus manifest 14.
- `pnpm --filter @zilar/server typecheck`: clean. `oxlint` on the four folders: clean. Test count before: same files, no tests added or edited.
- `pnpm gate` was not run (wave mode).

### Behaviour differences
- none on the wire (bodies, statuses, headers); the existing route tests pass unchanged.
- Order change: for the stickers upload and the background upload, the rate-limit middleware now runs before the params decode. Params are plain strings, so it cannot fail first.

### Unsure
- `uploadSticker` previously read `CurrentUser` in the handler; `handler()` now does it. Same.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **Converted:** backgrounds, avatars, files and stickers.
- **Truthful success statuses:**
  - 201 for the background upload, the pack create and the sticker upload;
  - 204 for the background remove;
  - `Empty(200)` for the file-serving endpoints, which used to declare Void or nothing.
- **Kept local:** the Telegram import hand decode (it keeps the 501 order), the stickers per-route schema errors and the ordered limiters, all accepted.
- **Follow-up:** `makeRateLimit.layer` should take `Pick<RateLimiter, 'allow'>`.
- **Check:** the combined wave 4 check passes.
