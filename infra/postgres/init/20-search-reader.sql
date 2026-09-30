-- Read-only role for message search (T-0117).
--
-- The server reads the ejabberd MAM archive (`public.archive`) through
-- `XMPP_ARCHIVE_DATABASE_URL` with this role. It can only SELECT from the
-- archive table: it cannot read credentials, rosters, room config, or
-- anything in the Galena database, and it cannot write anywhere.
--
-- The postgres image runs this on the first start of an empty data volume.
-- The password comes from the container environment (infra/.env), never
-- from git. The role name follows the existing per-service convention in
-- 10-create-databases.sql; the password placeholder is CHANGE_ME in
-- examples and docs (the real value lives in infra/.env, git-ignored).
--
-- Create the matching entry in infra/.env (git-ignored):
--   GALENA_ARCHIVE_DB_PASSWORD=CHANGE_ME
-- and pass it into the postgres service in infra/docker-compose.dev.yml:
--   GALENA_ARCHIVE_DB_PASSWORD: ${GALENA_ARCHIVE_DB_PASSWORD:?...}
-- Then point the server at it:
--   XMPP_ARCHIVE_DATABASE_URL=postgres://galena_archive:CHANGE_ME@127.0.0.1:5432/ejabberd

\getenv galena_archive_password GALENA_ARCHIVE_DB_PASSWORD

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'galena_archive', :'galena_archive_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'galena_archive') \gexec

\connect ejabberd
GRANT CONNECT ON DATABASE ejabberd TO galena_archive;
GRANT USAGE ON SCHEMA public TO galena_archive;
GRANT SELECT ON public.archive TO galena_archive;
