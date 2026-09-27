---
id: T-0014
title: Server foundation — config, logging, errors, Postgres via Drizzle, migrations (tested with PGlite)
status: todo
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
-

### Files changed
-

### Dependency versions
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-
