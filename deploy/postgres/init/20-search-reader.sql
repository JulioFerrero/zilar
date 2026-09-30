-- Read-only role for message search (T-0117).
--
-- The server reads the ejabberd MAM archive (`public.archive`) through
-- `XMPP_ARCHIVE_DATABASE_URL` with this role. It can only SELECT from the
-- archive table: it cannot read credentials, rosters, room config, or
-- anything in the Galena database, and it cannot write anywhere.
--
-- The postgres image runs this on the first start of an empty data volume
-- with `psql -v ON_ERROR_STOP=1`. The password comes from the container
-- environment (infra/.env), never from git — and it may be ABSENT (fresh
-- installs, or stacks that never enabled search). The whole body is
-- therefore guarded: without the variable the script does nothing and
-- search simply stays off (the server answers 501 `search_unavailable`).
-- Nothing here revokes anything: the stock PUBLIC connect grants the other
-- roles rely on are untouched; the reader only gains SELECT on one table.
--
-- Create the matching entry in infra/.env (git-ignored):
--   GALENA_ARCHIVE_DB_PASSWORD=CHANGE_ME
-- and pass it into the postgres service in infra/docker-compose.dev.yml:
--   GALENA_ARCHIVE_DB_PASSWORD: ${GALENA_ARCHIVE_DB_PASSWORD:?...}
-- Then point the server at it:
--   XMPP_ARCHIVE_DATABASE_URL=postgres://galena_archive:CHANGE_ME@127.0.0.1:5432/ejabberd

\getenv galena_archive_password GALENA_ARCHIVE_DB_PASSWORD

-- Set when GALENA_ARCHIVE_DB_PASSWORD exists (even empty); unset otherwise.
\if :{?galena_archive_password}
-- An empty value means "not configured" too: resolve to a boolean flag.
SELECT (:'galena_archive_password' <> '') AS has_pw \gset
\if :has_pw
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'galena_archive', :'galena_archive_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'galena_archive') \gexec

-- The `ejabberd` database is created by 10-create-databases.sql in the
-- normal stack, but a bare install may not have it: only proceed when it
-- exists, so this script can never fail the initialisation.
SELECT EXISTS (SELECT FROM pg_database WHERE datname = 'ejabberd') AS has_ejabberd \gset
\if :has_ejabberd
\connect ejabberd
GRANT CONNECT ON DATABASE ejabberd TO galena_archive;
GRANT USAGE ON SCHEMA public TO galena_archive;
-- `archive` is created by ejabberd itself on first start (`update_sql_schema`),
-- so it usually does not exist yet when this runs. The direct GRANT below
-- covers volumes where it already does; the default privilege covers every
-- table the `ejabberd` role (its owner, created by 10-create-databases.sql)
-- creates afterwards — including a future `archive`.
SELECT EXISTS (SELECT FROM pg_class WHERE relname = 'archive') AS has_archive \gset
\if :has_archive
GRANT SELECT ON public.archive TO galena_archive;
\endif
ALTER DEFAULT PRIVILEGES FOR ROLE ejabberd IN SCHEMA public GRANT SELECT ON TABLES TO galena_archive;
\endif
\endif
\endif
