---
id: T-0014
title: Server foundation — config, logging, errors, Postgres via Drizzle, migrations (tested with PGlite)
status: merged
milestone: M1
branch: task/T-0014-server-foundation
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0001]
estimate: 1 day
---

# T-0014: Server foundation

## Spec (written by Claude, do not edit)

### Goal
Turn `@galena/server` from a single health endpoint into a solid base that every M1 feature (auth, workspaces, rooms, AIs) plugs into:
- validated configuration
- structured logging that never leaks secrets
- consistent JSON errors
- request IDs
- a Postgres connection through Drizzle, with generated SQL migrations
- tests that run a **real Postgres engine in-process (PGlite)**, so CI never needs Docker

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md`: §17 (tech stack) and §19 (data model; only for context, since this task creates just one table)
- `apps/server/src/*` (current code and tests)
- Docs: Hono (`onError`, `notFound`, `hono/request-id`), Drizzle ORM (postgres-js driver, PGlite driver, migrator), drizzle-kit (`generate`), pino (`redact`)

### Allowed files
- `apps/server/src/**`, **except `apps/server/src/xmpp/**`**, which another worker (T-0003) is editing
- `apps/server/package.json`, `apps/server/tsconfig.json`
- `apps/server/drizzle.config.ts`, `apps/server/drizzle/**` (generated migrations)
- `apps/server/.env.example` (new)
- `pnpm-lock.yaml`

**Not allowed:** `infra/**`, `packages/**`, `apps/web/**`, `apps/mobile/**`, root files.

**Do not run Docker or `pnpm infra:*`.** Another worker uses the dev stack. All database tests use PGlite.

### Allowed dependencies
- Runtime: `drizzle-orm`, `postgres` (postgres-js), `pino`, `zod` (v4)
- Dev: `drizzle-kit`, `@electric-sql/pglite`, `pino-pretty`

Use the latest stable versions and list them in the Report.

### What to build
1. **`src/config.ts`: `loadServerConfig(env)`, validated with zod.**
   - Variables:
     - `NODE_ENV` (`development | test | production`, default `development`)
     - `PORT` (default 3000; reuse the current validation rules)
     - `DATABASE_URL` (must be a `postgres://` or `postgresql://` URL)
     - `LOG_LEVEL` (`fatal|error|warn|info|debug|trace`, default `info`)
     - `PUBLIC_URL` (a URL, default `http://localhost:3000`)
   - One error listing **every** invalid or missing variable, **without printing any values**.
   - Move the port parsing out of `index.ts` into this config.
2. **`src/logger.ts`: `createLogger(config)`.** A pino logger with `redact` for these paths:
   - `*.password`, `*.token`, `*.secret`, `*.apiKey`, `*.api_key`
   - `req.headers.authorization`, `req.headers.cookie`
   - `DATABASE_URL`

   Pretty output in development (`pino-pretty` transport), JSON otherwise.
3. **`src/app.ts`: `createApp({ db, logger, config })`**, replacing the module-level `app`.
   - Request ID middleware; every response carries `x-request-id`.
   - A request log line: method, path, status, duration and request id.
   - **`onError`:** JSON `{ error: { code, message, requestId } }`.
     - Known `HttpError` (define it in `src/errors.ts` with `status`, `code`, `message`) → its status and code.
     - Anything else → `500 { code: 'internal_error', message: 'Internal server error' }`. **Never leak stack traces or error details** to the client. Log them server-side with the request id.
   - **`notFound`:** `404 { error: { code: 'not_found', … } }`.
   - `GET /health` returns `{ ok, name, version, protocolVersion, db: 'ok' | 'down' }`.
     - `db` comes from a `select 1` with a 1-second timeout.
     - `ok` is `true` only if `db === 'ok'`.
     - Status 200 when ok, 503 when not.
4. **`src/db/`:**
   - `client.ts`: `createDb(databaseUrl)` → `{ db, close }` using postgres-js + drizzle.
   - `schema.ts`: one table for now:

     ```
     server_meta (key text primary key, value text not null, updated_at timestamptz not null default now())
     ```
   - `migrate.ts`: `runMigrations(db)` using drizzle's migrator and the `drizzle/` folder.
   - `drizzle.config.ts` for drizzle-kit, schema `src/db/schema.ts`, output `drizzle/`.
   - **Generate the first migration** with drizzle-kit and commit the SQL.
5. **`src/index.ts`:** load config → logger → db → run migrations → start the server.
   - On `SIGINT`/`SIGTERM`: stop accepting connections, close the DB, exit 0.
   - Config errors print a clear message and exit 1.
6. **Scripts in `apps/server/package.json`:**
   - `dev` (tsx watch)
   - `typecheck`
   - `test`
   - `db:generate` (drizzle-kit generate)
   - `db:migrate` (a tiny `src/db/migrate-cli.ts` that loads config and runs migrations)
7. **`apps/server/.env.example`:**
   - `DATABASE_URL=postgres://galena:CHANGE_ME@127.0.0.1:5432/galena` (matches the dev stack: user and database `galena`, password = `GALENA_DB_PASSWORD` from `infra/.env`)
   - the other variables, with comments
8. **Tests (Vitest), with no network and no Docker:**
   - **config:** valid, all-missing (lists them all), bad URL, bad port. Error messages contain no values.
   - **logger:** writing `{ password: 'hunter2', token: 'abc', req: { headers: { authorization: 'Bearer x' } } }` to an in-memory destination leaves none of those strings in the output.
   - **db with PGlite:** `runMigrations` on a fresh PGlite db creates `server_meta`. An insert/select round-trip works. Running migrations twice is a no-op.
   - **app:**
     - `/health` with a PGlite db → 200 `db: 'ok'`
     - with a db whose query throws → 503 `db: 'down'`
     - an unknown route → 404 JSON with a request id
     - a route that throws `HttpError(409, 'conflict', …)` → 409 JSON
     - a route that throws a plain `Error('secret detail')` → 500, and the body does **not** contain "secret detail"
     - `x-request-id` is present

     Register the throwing test routes only inside the test via a small hook, e.g. `createApp` accepting extra routes, or `app.route` in the test. Not in production code paths.

   Update the existing `app.test.ts` to the new shape.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` pass for the whole repo.
- [ ] The first migration SQL is committed under `apps/server/drizzle/` and was generated by drizzle-kit, not hand-written.
- [ ] No secret values in any error, log line or test snapshot.
- [ ] Only allowed files touched. No Docker used.

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
- Auth (Better Auth), users, workspaces, rooms: next tasks.
- XMPP code (T-0003).
- Running against the Docker Postgres. Claude will do a live check after merge.

---

## Report (written by the worker when done)

### What I did
- Added validated configuration in `apps/server/src/config.ts` (`loadServerConfig(env)` with zod): `NODE_ENV`, `PORT` (reuses the old 1–65535 digit rule; parsing moved out of `index.ts`), `DATABASE_URL` (must be `postgres://` / `postgresql://`), `LOG_LEVEL`, `PUBLIC_URL`. Failures throw one `ConfigError` listing every invalid/missing variable by name only (never the value). `loadServerConfigOrExit` prints the message and exits 1 for the two CLI entrypoints.
- Added `apps/server/src/logger.ts` (`createLogger(config)`): pino logger with `redact` for the requested paths, pretty transport in development, JSON otherwise. An optional second `destination` argument is used only by tests so redaction can be asserted against an in-memory stream.
- Added `apps/server/src/errors.ts` (`HttpError` with `status`, `code`, `message`).
- Rewrote `apps/server/src/app.ts` as `createApp({ db, logger, config })` (returns the Hono app): `hono/request-id`, a request log line (method, path, status, durationMs, requestId), JSON `onError` (`HttpError` → its status/code; anything else → 500 `internal_error` with details logged server-side only), JSON `notFound`, and `GET /health` (`select 1` with a 1 s timeout; `ok` only when the DB answers; 200/503).
- Added `apps/server/src/db/`: `client.ts` (`createDb(databaseUrl)` via postgres-js + Drizzle; also exports the `ServerDatabase` union type), `schema.ts` (`server_meta`), `migrate.ts` (`runMigrations`, drizzle migrator over the `drizzle/` folder), `migrate-cli.ts`, and `drizzle.config.ts`.
- Generated the first migration with drizzle-kit and committed the SQL + snapshot.
- Rewrote `apps/server/src/index.ts` to load config → logger → DB → migrations → serve, and to shut down on `SIGINT`/`SIGTERM` (stop the server, close the DB, exit 0).
- Added scripts `db:generate` and `db:migrate`; added `apps/server/.env.example`.
- Wrote Vitest tests for config, logger redaction, PGlite migrations and the app (throwing routes registered only in the test via `app.route`).

### Files changed
- `apps/server/src/config.ts` (new), `config.test.ts` (new)
- `apps/server/src/logger.ts` (new), `logger.test.ts` (new)
- `apps/server/src/errors.ts` (new)
- `apps/server/src/app.ts` (rewritten from module-level `app` to `createApp`)
- `apps/server/src/app.test.ts` (rewritten for the new shape)
- `apps/server/src/index.ts` (rewritten)
- `apps/server/src/db/client.ts`, `db/schema.ts`, `db/migrate.ts`, `db/migrate-cli.ts`, `db/migrate.test.ts` (new)
- `apps/server/drizzle.config.ts` (new)
- `apps/server/drizzle/0000_medical_exodus.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json` (generated)
- `apps/server/package.json`, `apps/server/tsconfig.json` (include `drizzle.config.ts`)
- `apps/server/.env.example` (new)
- `pnpm-lock.yaml`

### Dependency versions
- Runtime: `drizzle-orm` 0.45.3, `postgres` 3.4.9, `pino` 10.3.1, `zod` 4.6.5
- Dev: `drizzle-kit` 0.31.11, `@electric-sql/pglite` 0.5.8, `pino-pretty` 13.1.3
- (`hono` stays 4.13.9.)

### Commands run and real results
- `pnpm install`: up to date (125 packages resolved, added). Later `pnpm --filter @galena/server add …` installed the deps above and updated `pnpm-lock.yaml`.
- `pnpm --filter @galena/server db:generate`: `1 tables; server_meta 3 columns 0 indexes 0 fks` → wrote `drizzle/0000_medical_exodus.sql`.
- `pnpm --filter @galena/server typecheck` / `pnpm typecheck`: pass (5/5 tasks successful).
- `pnpm --filter @galena/server test`: 4 files, 17 tests passed (config 7, logger 1, migrate 3, app 6).
- `pnpm test`: 5/5 tasks successful (server 17 tests above, other packages cached/passing).
- `pnpm format:check`: `All matched files use Prettier code style!`
- `pnpm lint`: `Found 0 warnings and 0 errors.`
- `pnpm build`: 1/1 task successful (only `@galena/web` has a build script; `@galena/server` has none, as specified).

### Problems, deviations from the spec, open questions
- **Redact paths (deviation).** With fast-redact, `*.password` does not match a top-level `password`, but the required logger test logs the sensitive keys at the top level. I therefore pass both the bare keys and the `*.`-prefixed keys (`password`, `token`, `secret`, `apiKey`, `api_key`), plus the requested `req.headers.*` and `DATABASE_URL` paths.
- **`createLogger` extra argument (deviation).** It takes an optional `destination` so tests can assert redaction without touching stdout; production callers use `createLogger(config)` exactly as specified.
- **Migration dispatch (deviation).** `runMigrations` calls drizzle's per-driver `migrate` (`drizzle-orm/postgres-js/migrator` or `drizzle-orm/pglite/migrator`) and picks between them from `db.$client`. I first tried a driver-agnostic `new PgDialect().migrate(...)` over `db._.session`, but drizzle's `PgSession` generic defaults reject a schema-typed session, so the official migrators were the clean, type-safe option. `pglite/migrator` has no runtime import of `@electric-sql/pglite`, so production stays on postgres-js.
- **Config error format.** Errors read `Invalid server configuration: PORT (invalid), DATABASE_URL (missing)` — variable names and a generic reason, no values. Since only `DATABASE_URL` is required (the rest have defaults), the "all-missing" case lists `DATABASE_URL`; a separate test asserts that several invalid variables are all listed.
- **Generated files were Prettier-formatted.** drizzle-kit output did not match the repo's Prettier rules, and `.prettierignore` is not in my allowed files, so I ran Prettier on the two `drizzle/meta` JSON files and `app.ts` to make `format:check` pass. The SQL itself is untouched.
- **`config` is accepted but unused** inside `createApp` for now; it is part of the requested signature and will be used by later features.
- No live Postgres run (out of scope; no Docker). PGlite covers migrations, round-trip and health.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict: approved.** Merged by Claude.

This is a clean, well-structured foundation, and every deviation in the Report is justified.

### What I verified myself (on commit cc44384)
- `install`, `format:check`, `lint`, `typecheck`, `test` (server **17**) and `build`: all PASS.
- An independent leak probe (a temporary test, removed afterwards) on a route that throws `Error('leak postgres://u:SUPERSECRET@h/db')`, sent with `Authorization: Bearer SECRETTOKEN` and `x-request-id: <script>…`:
  - status **500**
  - the body does **not** contain the secret
  - the malicious request id was **replaced** with a generated UUID
  - the logs do **not** contain the bearer token
- A live check against the Docker Postgres is postponed until T-0003 releases the dev stack (PGlite already covers migrations, round-trips and health).

### Findings
1. **(accepted)**
   - redact paths covering both the bare and `*.`-prefixed keys
   - the test-only `destination` argument
   - per-driver migrator dispatch
   - Prettier on the generated JSON
2. **(follow-up, next server task)** The `dev` script doesn't load `apps/server/.env`. Use `tsx watch --env-file-if-exists=.env src/index.ts`, or Node's `--env-file-if-exists`, so `pnpm --filter @galena/server dev` works after copying `.env.example`.
3. **(follow-up, next server task)** Type `HttpError.status` as Hono's `ContentfulStatusCode`, so `onError` doesn't need the `as` cast.
4. **(note)** Running migrations on startup is fine for a single instance. Revisit this (with a lock or a separate migration step) before running more than one server instance.
