---
id: T-0873
title: "Server sweep: voice-transcription, gifs, auth, contact-requests onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses"
status: merged
milestone: M5
branch: task/T-0873-sweep-voice-auth
model: auto
effort: default
depends_on: [T-0863]
estimate: 0.5 day
---

# T-0873: Server sweep: voice-transcription, gifs, auth, contact-requests onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Phase 2 of the simplify plan (C-F1 to C-F5, B-B1 and B-B4 in `docs/audit/simplify-2026-10-09/C-server.md` and `docs/audit/simplify-2026-10-09/B-api-contract.md`). T-0863 built the helpers, converted blocks and roles, and wrote the recipe: read the Report section "How to convert a module" in `work/T-0863-server-http-helpers.md` and follow it exactly. One rule changed in round 1: each converted module gets `<module>/routes.expected.ts` holding its old route array, and `routes-manifest.test.ts` is not edited.

**Modules in this task:** `apps/server/src/voice-transcription/`, `apps/server/src/gifs/`, `apps/server/src/auth/`, `apps/server/src/contact-requests/`.

**Success statuses to make truthful in these modules** (B-B1; the server sends a status its HttpApi declaration does not say, which a derived client will reject):
- PATCH /me decodes its payload by hand (`auth/api.ts:205,261-264`)
- `contact-requests/api.ts:334-339` sends 200 for a reverse request and 201 otherwise (give it both success statuses)

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
`apps/server/src/voice-transcription/**`, `apps/server/src/gifs/**`, `apps/server/src/auth/**`, `apps/server/src/contact-requests/**`, `work/T-0873-sweep-voice-auth.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/voice-transcription src/gifs src/auth src/contact-requests src/authz-sweep.test.ts src/routes-manifest.test.ts
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

- Commits: voice-transcription `5faa7961`, gifs `b0fc1126`, auth `ccdd10c6`, contact-requests `86b765d1`.
- Lines (git numstat of `api.ts`, +added/-removed; each module also gains a `routes.expected.ts`): voice +173/-233 (net -60), gifs +140/-192 (net -52), auth +104/-172 (net -68), contact-requests +85/-192 (net -107). Total net -287 in `api.ts`, +34 in the four `routes.expected.ts`. No other file changed.
- Checks (`--testTimeout=120000 --hookTimeout=120000`): voice, gifs, auth, contact-requests, `authz-sweep.test.ts`, `routes-manifest.test.ts`: 17 files passed, 1 skipped; 172 tests passed, 2 skipped (skips are in existing files); 3 of 3 runs. `tsc --noEmit` on the server, `oxlint` and `prettier --check` on the four folders: clean. Machine load was about 55-62 (`uptime`); runs took 270-310 s.
- Recipe applied: shared `runSql` (auth had a local copy), shared `SchemaErrors` (voice, gifs, auth), `makeRateLimit` (contact-requests: Create, Read, ByHandle, same tag strings and message), `handler(logger, ...)` for every handler with a session, `mountApi` (voice, auth, contact-requests), `routes.expected.ts` for all four; `routes-manifest.test.ts` untouched.
- Voice: `TranscriptConfigured` and `VoiceSettingsOwnerLimit` stay (not plain limits).
- Deviation, gifs: no `mountApi`. It sets `routerConfig: { maxParamLength: 4096 }` and wraps the handler for the media 404 envelope, which `mountApi` cannot do. It uses `reflectRoutes(GifsApi)` for the routes and keeps `HttpRouter.toWebHandler`; the local handler const is now `edgeHandler`.
- Deviation, contact-requests: kept its own `ContactRequestsSchemaErrors`. The shared `SchemaErrors` answers the schema's text; this module answers a fixed text that `contact-requests.test.ts` asserts.
- Deviation, auth public group (`checkInvite`): no session, so it cannot use `handler` (needs `CurrentUser`); it keeps `withErrorEnvelope`.
- Truthful statuses: contact-requests `create` declares `success: [{request, incoming: true} (200), {request} with HttpApiSchema.status(201)]` and returns the value (no `jsonUnsafe`). The 200 member is first so `incoming` is not stripped by the 201 member. Existing tests assert 201, the reverse 200 and `incoming: true`.
- PATCH /me: the payload `UpdateMeBody` is declared, but the endpoint is served with `handleRaw`, so the framework does not decode the body. With `handle` (tested with a temporary probe, deleted): a malformed or empty body answered "Expected a valid JSON body" / "Expected JSON value" instead of "Invalid name", and a request without a JSON content-type answered 415 instead of 200. With `handleRaw` the probe (malformed, empty, null, array, string, valid, no content-type) gave the old answers. The hand decode and its messages stay.
- Behaviour differences on the wire: none observed.
- Audit line numbers had moved; the facts were right (hand decode in PATCH /me; 200 vs 201 in create). Voice and gifs have no 201/204 sites.
- I assembled gifs/auth/contact-requests `api.ts` with head/tail/cat from text I wrote, not with sed/python. Did not run `pnpm gate` (wave mode).

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **Converted:** voice-transcription, gifs, auth and contact-requests, net −287 lines in the `api.ts` files.
- **Statuses:** contact-requests declares both its 200 and its 201 success.
- **PATCH /me:** it declares its payload but keeps `handleRaw`, because the worker's probe showed that a framework decode changes the wire (415 and other messages).
- **gifs:** it keeps its own `toWebHandler` for `maxParamLength` and uses `reflectRoutes`.
- **Check:** the combined wave 4 check passes.
