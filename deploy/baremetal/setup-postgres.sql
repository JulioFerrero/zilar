-- Roles and databases for a bare-metal Galena install.
--
-- Run as the postgres superuser (peer auth as the postgres OS user):
--
--   sudo -u postgres psql -v galena_password='...' \
--     -v ejabberd_password='...' -v archive_password='...' \
--     -f deploy/baremetal/setup-postgres.sql
--
-- Passwords arrive as psql variables, never from git. Use URL-safe
-- passwords (letters and digits) because some are embedded in Postgres
-- connection URLs. Mirrors deploy/postgres/init/10-create-databases.sql
-- and 20-search-reader.sql: one role and database per service, pgvector
-- in the galena database, and a read-only galena_archive role that can
-- only SELECT ejabberd's message archive.
--
-- Needs the pgvector extension installed for your PostgreSQL first
-- (postgresql-16-pgvector / postgresql-18-pgvector package, or from
-- source). The CREATE EXTENSION below fails loudly if it is missing.

-- The galena database lives here too (same cluster, separate role).
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'galena', :'galena_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'galena') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'galena', 'galena')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'galena') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'ejabberd', :'ejabberd_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ejabberd') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'ejabberd', 'ejabberd')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ejabberd') \gexec

\connect galena
CREATE EXTENSION IF NOT EXISTS vector;

-- Read-only role for message search: it can only SELECT the archive
-- table, nothing else, and it cannot write anywhere. Leave
-- archive_password empty to skip search (the server answers 501 and
-- the web hides the feature).
\connect postgres
SELECT (:'archive_password' <> '') AS has_archive_pw \gset
\if :has_archive_pw
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'galena_archive', :'archive_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'galena_archive') \gexec
\connect ejabberd
GRANT CONNECT ON DATABASE ejabberd TO galena_archive;
GRANT USAGE ON SCHEMA public TO galena_archive;
-- ejabberd creates `archive` itself on first start (update_sql_schema),
-- so it usually does not exist yet when this runs. The direct GRANT
-- covers reruns after it exists; the default privilege covers every
-- table the ejabberd role creates afterwards.
SELECT EXISTS (SELECT FROM pg_class WHERE relname = 'archive') AS has_archive \gset
\if :has_archive
GRANT SELECT ON public.archive TO galena_archive;
\endif
ALTER DEFAULT PRIVILEGES FOR ROLE ejabberd IN SCHEMA public GRANT SELECT ON TABLES TO galena_archive;
\endif
