---
id: T-0028
title: Settings → Connections: connect a provider account from the web app, with the key encrypted at rest
status: ready
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
  environment (`GALENA_KEY_ENCRYPTION_KEY`), validated at startup.
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
Gate it behind an env flag (`GALENA_CONNECTIONS_INTEGRATION=1`) so it does not run
in the normal suite. If you cannot run the server, say so plainly — do not
describe it as verified.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test`, `build` all pass.
- [ ] A key is encrypted at rest and the plaintext is nowhere in the database
      row, the API responses, or the logs.
- [ ] Cross-user access is impossible and returns 404, not 403.
- [ ] The master key is in `redactPaths` and in no error message.
- [ ] The screen follows `docs/design/ui-style.md` and handles empty/loading/
      error/success.
- [ ] `infra/.env.example` uses placeholders, never a real value.
- [ ] The Report states exactly what you ran live and what you did not.

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
