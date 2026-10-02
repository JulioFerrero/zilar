---
id: T-0028
title: Settings → Connections: connect a provider account from the web app, with the key encrypted at rest
status: merged
milestone: M2
branch: task/T-0028-connections-ui
model: opencode-go/deepseek-v4-pro
depends_on: [T-0007]
estimate: 2 days
---

# T-0028: Connections — the UI where a user connects a provider

## Spec (written by Claude, do not edit)

### Goal

Right now there is no way for a person to give the platform a provider key.
`docs/PROJECT_PLAN.md` §"Keys" says where it goes:

> **Entry.** Keys are entered in a settings form only, never in chat.
> **Storage.** Keys are encrypted at rest. MVP: envelope encryption with a master
> key from the environment.
> **Decryption** happens only inside the LLM gateway. Desks get a virtual key per
> AI that works only through the platform and has a hard cap.
> **Setup help.** A "Test key" button.

And the data model already has the row: §20.1 lists `provider_connections`
(`id, owner (user/workspace), provider, encrypted_key, label, status`).

**Julio will use this to connect a real account from the web app.** So it must be
a working, honest screen — not a mock. He is the first user of it.

T-0007 already proved the LiteLLM side: `/ai/virtual-keys` issues a **capped,
server-owned** key and the master key never leaves the server. Do not reopen
that; this task is the *human* side of the same wall.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` — the "Keys" section (§~570-600) and §20.1/§20.2
- `apps/server/src/ai/routes.ts` — the route style, the `HttpError` shape, the
  `.strict()` zod idiom, and the comment about why the cap is server-owned
- `apps/server/src/db/schema.ts` + how migrations are applied (find the real
  mechanism; do not invent one)
- `apps/server/src/config.ts` — how env entries are declared and validated
- `apps/server/src/logger.ts` — `redactPaths`, and **add the new secret env name
  to it**
- `apps/web/src/routes/AppRoutes.tsx`, `LoginPage.tsx` and the components in
  `apps/web/src/components/` — for the house UI style
- `docs/design/ui-style.md`

### Allowed files
- `apps/server/src/connections/**` (new module: crypto, routes, service, tests)
- `apps/server/src/db/schema.ts` and the migration file for the new table
- `apps/server/src/config.ts` — only to add the new env entries
- `apps/server/src/logger.ts` — only to add the new secret to `redactPaths`
- `apps/server/src/app.ts` — to mount the route
- `apps/web/src/routes/ConnectionsPage.tsx` (new) and its test
- `apps/web/src/routes/AppRoutes.tsx` — to add the route
- `apps/web/src/components/**` — new connection components only
- `infra/.env.example` — placeholder values only, e.g. `CHANGE_ME`
- `work/T-0028-connections-ui.md`

**Not allowed:** `apps/mobile/**`, `packages/**`, other `apps/web/src/routes/*`,
`apps/server/src/ai/**`, `apps/server/src/git/**`, other `apps/server/src/*`
routes, `docs/**`. If you need one of those, describe it in the Report and stop.

> Another worker (T-0029) is editing three `apps/web` test files and
> `apps/web/vite.config.ts` in a separate worktree. Do not touch those.

### Allowed dependencies
None. Node's built-in `crypto` is enough. **Do not add a crypto library.**

### What to build

**1. Storage.** A `provider_connections` table matching the plan: id, owner
(the authenticated user), provider, `encrypted_key`, label, status, created/updated
timestamps. Follow the existing migration mechanism exactly.

**2. Envelope encryption** (`apps/server/src/connections/crypto.ts`).
- AES-256-GCM, key derived from a master key that comes **only** from the
  environment (`ZILAR_KEY_ENCRYPTION_KEY`), validated at startup.
- Store what is needed to decrypt: ciphertext, IV, auth tag. Use a versioned
  string envelope so you can rotate the scheme later.
- Tests: round-trip; **tampering with the ciphertext, IV or tag fails loudly**;
  a wrong master key fails; the plaintext never appears in the stored blob.
- The master key must never be logged, returned, or included in any error
  message. Reuse `redactSecrets` the way `apps/server/src/ai/` does.

**3. Routes** (`/api/connections`), all behind `requireSession`:
- `GET /api/connections` — list the caller's connections. **Never returns the
  key.** Return at most a non-reversible hint (e.g. provider, label, status,
  created_at, and the last 4 characters of the key if you are comfortable — say
  which you chose and why in the Report).
- `POST /api/connections` — create. Validate with `zod`, `.strict()`.
- `POST /api/connections/:id/test` — the **"Test key"** button: decrypt in
  memory, make one cheap, real request to the provider, and return
  `ok` or a **sanitised** error. The provider key must not appear in the error
  or the log. If the provider is unreachable, say so — do not report a false
  failure and do not report a false success.
- `DELETE /api/connections/:id` — remove.
- **A user may only ever see, test or delete their own connections.** A missing
  or foreign id returns the same 404 (do not leak existence).

**4. The screen** (`apps/web/src/routes/ConnectionsPage.tsx`, route
`/settings/connections`, reachable from the app).
- One row per connection: provider, label, status, when it was added, and
  actions: **Test** and **Remove**.
- An "Add connection" flow: pick a provider from a fixed list matching the plan
  (OpenAI, Anthropic, Google Gemini, DeepSeek, xAI, OpenRouter, GitHub), paste
  the key, optional label, save.
- **Telegram-like, per `docs/design/ui-style.md`.** Read it before you write a
  single component. This is a settings screen, not a landing page: compact,
  list-driven, one obvious primary action.
- Password-type input with a reveal toggle. Never render a stored key back into
  an input field.
- Handle the four states honestly: empty, loading, error (with the server's
  message), and success. A screen that only renders the happy path is not done.
- `apps/web` has a `?mock=1` story for other pages — follow whatever the
  existing pages do, and make sure the real path is the default.

### Tests (Vitest, no real network, no real keys)
- crypto: round-trip, tamper detection, wrong key, no plaintext in the blob.
- routes: auth required; a caller cannot read, test or delete another user's
  connection; **no response body anywhere contains the key**; a create with an
  unexpected field is rejected (`.strict()`); a test-connection failure is
  sanitised.
- web: the page renders the empty state, the list, and an error state.

### Integration check
The LiteLLM side is proven. For **this** task, prove the human path end to end
against the running server on `127.0.0.1:3188`: create a connection, list it,
test it, and delete it, with a **fake/throwaway key value you made up**. A real
provider key is not needed and must not be used. Report the real HTTP statuses.
Gate it behind an env flag (`ZILAR_CONNECTIONS_INTEGRATION=1`) so it does not run
in the normal suite. If you cannot run the server, say so plainly — do not
describe it as verified.

### Acceptance criteria
- [x] `pnpm format:check`, `lint`, `typecheck`, `test`, `build` all pass.
- [x] A key is encrypted at rest and the plaintext is nowhere in the database
      row, the API responses, or the logs.
- [x] Cross-user access is impossible and returns 404, not 403.
- [x] The master key is in `redactPaths` and in no error message.
- [x] The screen follows `docs/design/ui-style.md` and handles empty/loading/
      error/success.
- [x] `infra/.env.example` uses placeholders, never a real value.
- [x] The Report states exactly what you ran live and what you did not.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Out of scope
- Actually creating an AI from a connection (that is T-0030, the M2 wizard).
- OAuth sign-in for providers. API keys only for now; say so in the UI copy.
- Wiring decrypted keys into the LLM gateway's request path. Build the seam
  (`decryptForGatewayUse(connectionId)`) and stop there. M2 uses it.

## Report (written by the worker when done)

### What I did

Built the server-side "human" side of the BYO-key wall and the web settings
screen that lets Julio paste a provider key.

**Server — new module `apps/server/src/connections/`**
- `crypto.ts` — envelope encryption with Node's built-in `crypto` only (no new
  dependency). Format `v1:<salt>:<iv>:<ciphertext>:<tag>` (all base64url),
  AES-256-GCM, key derived from the master key via `scryptSync`. `decrypt` fails
  loudly (`DecryptionError`) on tampering, wrong key, or malformed input, and its
  message is a fixed string that never carries the blob/key.
- `providers.ts` — the fixed provider id list + zod enum (openai, anthropic,
  google, deepseek, xai, openrouter, github).
- `probe.ts` — the "Test key" probe. One cheap GET per provider (`/v1/models`
  for OpenAI/Anthropic/DeepSeek/xAI/OpenRouter, Gemini `v1beta/models?key=…`,
  GitHub `/rate_limit`), 10s timeout via `AbortSignal.timeout`. Returns fixed,
  sanitised outcomes: `ok`, "The provider rejected the key" (401/403), "The
  provider returned an unexpected response" (other non-2xx), "The provider is
  unreachable" (network error). The key never appears in any outcome message.
  Reuses `redactSecrets` from `ai/litellm-client` via `redactKey`.
- `service.ts` — drizzle CRUD keyed on `owner = user.id`, plus the
  `decryptForGatewayUse(db, cipher, connectionId)` seam (nothing calls it yet).
- `routes.ts` — `GET/POST /api/connections`, `POST /api/connections/:id/test`,
  `DELETE /api/connections/:id`, all behind `requireSession`. Create uses
  `.strict()` zod. Missing or foreign id returns the same 404.

**Storage** — added `provider_connections` to `schema.ts` and generated the
migration with `pnpm --filter @zilar/server db:generate` (the repo's real
mechanism): `drizzle/0004_charming_forgotten_one.sql` + snapshot + journal.

**Config/logger** — `ZILAR_KEY_ENCRYPTION_KEY` in `config.ts` (min 32 chars) and
added to `redactPaths` in `logger.ts`. `app.ts` mounts the route only when the
key is configured (mirrors LITELLM_MASTER_KEY).

**Web** — `ConnectionsPage.tsx` (route `/settings/connections`, registered in
`AppRoutes.tsx` under `RequireAuth`), plus `ConnectionsPage.test.tsx`. Compact,
list-driven Telegram-style screen: empty/loading/error/list states, one primary
"Add a connection" action, password input with reveal toggle, Test + Remove per
row. API keys only (copy says so). Real path is the default; it does not use the
`?mock=1` store.

**`infra/.env.example`** — added `ZILAR_KEY_ENCRYPTION_KEY=CHANGE_ME`.

### Decisions worth flagging
- **Key hint:** `GET /connections` returns only `id, provider, label, status,
  createdAt` — I did **not** return the last 4 characters of the key, because
  that would require decrypting every row on every list. `label` is the
  disambiguator instead.
- **`ZILAR_KEY_ENCRYPTION_KEY` is optional in the config schema**, not required.
  The spec says "validated at startup", but `test-support.ts` (out of scope)
  calls `loadServerConfig` without it, so a required key would break every other
  test. It is still validated (min 32 chars) when present, the module refuses to
  start without it (`createKeyCipher`/mount), and the route is only mounted when
  it is set. Flagging for Claude to decide whether `test-support.ts` should later
  be updated to make it truly required.

### Files changed
- `apps/server/src/connections/{crypto,providers,probe,service,routes}.ts`
- `apps/server/src/connections/{crypto,probe,routes}.test.ts`
- `apps/server/src/connections/integration.test.ts` (gated)
- `apps/server/src/db/schema.ts`, `apps/server/drizzle/0004_charming_forgotten_one.sql`,
  `apps/server/drizzle/meta/0004_snapshot.json`, `apps/server/drizzle/meta/_journal.json`
- `apps/server/src/config.ts`, `apps/server/src/logger.ts`, `apps/server/src/app.ts`
- `apps/web/src/routes/ConnectionsPage.tsx`, `apps/web/src/routes/ConnectionsPage.test.tsx`,
  `apps/web/src/routes/AppRoutes.tsx`
- `infra/.env.example`

### Commands run (real results)
- `pnpm install` — Done in 7.6s (909 packages).
- `pnpm format:check` — `All matched files use Prettier code style!` (exit 0).
- `pnpm lint` — `Found 0 warnings and 0 errors.` (exit 0).
- `pnpm typecheck` — `Tasks: 8 successful, 8 total` (exit 0).
- `pnpm test` — `Tasks: 8 successful, 8 total`; server 232 passed / 4 skipped;
  web and the other packages green (exit 0).
- `pnpm build` — `Tasks: 2 successful, 2 total` (exit 0).
- `pnpm --filter @zilar/server exec vitest run src/connections` — 24 passed,
  1 skipped (the gated integration test), exit 0.

### What I did NOT run live
The **integration check against `127.0.0.1:3188` did not run**. I wrote
`connections/integration.test.ts`, gated behind `ZILAR_CONNECTIONS_INTEGRATION=1`
and skipped in the normal suite, but I could not start the dev stack (Postgres +
ejabberd + server + invite) in this worktree. The full human path
(create → list → test → delete with a fake key) is therefore **not verified
against a live server** — only the unit/route tests above are. The integration
test is ready to run once the stack is up.

### Open questions
- Whether `ZILAR_KEY_ENCRYPTION_KEY` should become required in `config.ts` (and
  `test-support.ts` updated to supply a test key) to satisfy "validated at
  startup" more strictly.
- The `/settings/connections` route is reachable by URL but has no in-app nav
  link, because the settings entry point lives in `ChatList`/`ChatShell`, which
  are outside my Allowed files.

### Round 2

Fixes for the six review findings. I audited the interrupted "WIP round 2" commit
edit by edit. The HKDF switch, the key trim, the 429 mapping, the always-mount,
the Back button and the two-step Remove were all correct and are kept. Two things
were wrong or missing and are fixed here: the always-mounted `/api/connections`
route **shadowed the test-injected routes** (10 `routes.test.ts` tests returned
503), and none of the new navigation/error/remove tests existed yet.

**Finding 1 — reachable from the app, with a way back.** Kept the `Connections`
`menuitem` in `ChatList.tsx` (between "Invite a friend" and "Sign out") and the
arrow Back button (`aria-label="Back"`) in `ConnectionsPage.tsx`. Added both named
tests: the menu item navigates to `/settings/connections` and the page renders, and
Back returns to the chat list. They live in `ConnectionsPage.test.tsx` because the
task widened access by exactly one file (`ChatList.tsx`); `ChatList.test.tsx` was
not touched. The original open question about no in-app nav link is now resolved.

**Finding 2 — unconfigured server gives 503, not a bare 404.** `app.ts` always
mounts `createConnectionsRoutes`; `routes.ts` gained `requireCipher()`, which
(after `requireSession`) throws `HttpError(503, 'connections_unavailable',
'Provider connections are not configured on this server')` on every route. Server
test asserts the 503 and code on list/create/test/delete through the real
`createApp`; web test asserts the page shows that message in its error state.

**Finding 3 — HKDF instead of scrypt.** `deriveKey` uses
`hkdfSync('sha256', masterKey, salt, 'zilar/provider-key/v1', 32)` wrapped in
`Buffer.from`; the `v1` envelope is unchanged and all 8 crypto tests still pass.
Fixed the stale "scrypt" line in the file comment.

**Finding 4 — trim the key at the API boundary.** `key` is now
`z.string().trim().min(1).max(16384)`. Test creates with `"  fake-key\n"` and
asserts the stored blob decrypts to `"fake-key"`.

**Finding 5 — two-step Remove.** The trash button swaps the row's actions for a
danger `Remove` plus `Cancel`; `confirmRemove` catches failures and shows the
server's message on that row in `text-danger` while keeping the row. No
`window.confirm`. Tests: nothing is sent until the confirm (fetch stays at one
call), and a failed DELETE shows the message and keeps the row.

**Finding 6 — 429 means rate-limited, not unexpected.** `probe.ts` maps 429 to
"The provider is rate-limiting this key. Try again in a minute." and
`probe.test.ts` covers it.

**One app.ts change beyond the WIP mount (flagged).** Because the real app now
always owns `/api/connections`, a test that called `testApp` and then added its
own handler got the app's 503 handler first. `routes.test.ts` now builds the app
with `createApp` and injects the fixed master key, fake probe and a capturing
logger through a new optional `connections` dependency on `AppDependencies` —
the same injection pattern already used for `voice`/`voiceMaxBytes`. This keeps
every route test running against the real app assembly and leaves
`test-support.ts` (outside my Allowed files) untouched.

**Files touched in round 2:** `apps/server/src/app.ts`,
`apps/server/src/connections/crypto.ts` (comment only),
`apps/server/src/connections/routes.test.ts`,
`apps/web/src/routes/ConnectionsPage.test.tsx`. The WIP commit already carried the
changes to `routes.ts`, `probe.ts`, `probe.test.ts`, `ChatList.tsx`,
`ConnectionsPage.tsx` and the integration-test env-var comment (finding 2, 3, 4, 5,
6, 1); those were verified and kept.

**Commands run (real results, round 2)**
- `pnpm install` — `Already up to date`, `Done in 815ms` (exit 0).
- `pnpm format:check` — `All matched files use Prettier code style!` (exit 0).
- `pnpm lint` — `Found 0 warnings and 0 errors.` (303 files, exit 0).
- `pnpm typecheck` — `Tasks: 8 successful, 8 total` (web and server ran
  uncached; exit 0).
- `pnpm exec turbo test --force` — `Tasks: 8 successful, 8 total`, `Cached: 0`;
  server `26 passed | 3 skipped` files and `235 passed | 4 skipped` tests.
- `pnpm --filter @zilar/web test` — `19 passed` files, `95 passed` tests.
- `pnpm build` — `Tasks: 2 successful, 2 total` (web: 2325 modules, built).
- `pnpm --filter @zilar/server exec vitest run src/connections` — 3 passed
  files, 1 skipped; `27 passed | 1 skipped` tests.
- `pnpm --filter @zilar/web exec vitest run src/routes/ConnectionsPage.test.tsx`
  — `10 passed`.

**Still not run live.** As instructed, I did not start a server or run
`ZILAR_CONNECTIONS_INTEGRATION=1`; the lead runs that after this round. The
integration test's header now lists the exact env vars it needs.

## Review (written by Claude)

**Verdict:** Round 1: changes requested

Verified by the lead: scope is inside Allowed files; `format:check`, `lint`,
`typecheck`, `build` pass; every named test from the spec exists and tests
behavior, not the mock. The crypto (AES-256-GCM, per-blob salt and IV, fixed
error strings), the owner check on every query, and 404-not-403 are correct.

### Findings
1. **The screen is not reachable from the app, and has no way back.** The spec
   said "reachable from the app"; that was the lead's spec gap, since the menu
   was outside your Allowed files. **You may now edit
   `apps/web/src/components/ChatList.tsx`, only to add one `Connections`
   menuitem** to the "Main menu", between "Invite a friend" and "Sign out", that
   navigates to `/settings/connections`. In `ConnectionsPage.tsx`, add a back
   button (arrow icon, `aria-label="Back"`) left of the "Connections" title that
   goes to `/`, like a Telegram settings screen.
   Tests: the menu item navigates to the page; Back returns to the chat list.
2. **An unconfigured server gives a misleading error.** Without
   `ZILAR_KEY_ENCRYPTION_KEY` the routes are not mounted, so the page shows a
   bare "Not found". Always mount the routes. When the key is absent, every
   `/api/connections` route (after `requireSession`) returns **503**, code
   `connections_unavailable`, message "Provider connections are not configured
   on this server". Keep the env entry optional: your reasoning about
   `test-support.ts` is right.
   Tests: server returns that 503 when no cipher is configured; the page shows
   that message in its error state.
3. **`scryptSync` blocks the event loop on every encrypt/decrypt.** scrypt is a
   password KDF. The master key is a random, high-entropy secret, so it adds
   nothing except tens of milliseconds of blocked CPU per request. Use HKDF:
   `hkdfSync('sha256', masterKey, salt, 'zilar/provider-key/v1', 32)`, which
   returns an `ArrayBuffer` (wrap it in `Buffer.from`). Keep the `v1` envelope
   format (nothing is stored yet) and keep every crypto test passing.
4. **The server must trim the key.** Pasted keys often carry a trailing newline.
   The web form trims, but the API is the boundary: use
   `z.string().trim().min(1).max(16384)` for `key`.
   Test: creating with `"  fake-key\n"` stores a blob that decrypts to `"fake-key"`.
5. **Remove fails silently, and deletes on one click.** `removeConnection` has no
   error handling, so a failed DELETE is an unhandled rejection and the row just
   stays. Make Remove two-step on the row: the trash button swaps the row's
   actions for "Remove" (danger) and "Cancel"; on failure, show the server's
   message on that row in `text-danger`. Do not use `window.confirm`.
   Tests: nothing is deleted until the confirm; a failed delete shows the message
   and keeps the row.
6. **A 429 from the provider is reported as "unexpected response".** On
   `/models` a 429 almost always means the key authenticated. Map it to
   "The provider is rate-limiting this key. Try again in a minute." Test it in
   `probe.test.ts`.

*(No change needed.)*
- No last-4 hint in the list: accepted, for the reason you gave.
- `ZILAR_KEY_ENCRYPTION_KEY` stays optional in `config.ts` (see finding 2).
- The live integration test: **do not try to start a server.** After this round
  the lead runs `ZILAR_CONNECTIONS_INTEGRATION=1` against a server started from
  this worktree. Make sure the test's README-style comment at the top says
  exactly which env vars it needs.

**Verdict:** Round 2: Approved

Verified by the lead:
- Scope: every changed path is in the Allowed files (plus `ChatList.tsx`, allowed by round 1).
- `format:check`, `lint`, `typecheck`, `build` pass; `pnpm exec turbo test --force`:
  8/8 tasks, 0 cached; server 235 passed / 4 skipped, web 95 passed.
- All six round-1 findings are fixed as asked, with the named tests. Good catch that the
  always-mounted route shadowed the test routes; injecting through `AppDependencies`
  like `voice` is the right fix.
- **Live, by the lead**, against a server started from this branch on port 3189 with a
  freshly generated master key (migration 0004 applied to the dev database):
  - the gated `ZILAR_CONNECTIONS_INTEGRATION=1` test: 1 passed (sign-up with a fresh
    invite, then create → list → test → delete);
  - a marker key sent with surrounding whitespace was stored trimmed; the Postgres row
    holds a `v1` 5-part envelope, and the marker appears in **no** DB row, API response
    or server log line;
  - "Test" called the real OpenAI API with the made-up key and returned
    `{"ok":false,"message":"The provider rejected the key"}`;
  - delete removes the row (0 rows after); no session gives 401.

### Follow-ups
- `POST /api/connections/:id/test` makes an outbound provider call per request; add it to
  the rate limiter before real users (board follow-up).
