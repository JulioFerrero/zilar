-- Creates one role and one database per Galena service.
--
-- The postgres image runs this on the first start of an empty data volume.
-- Passwords come from the container environment (infra/.env), never from git.
-- A .sql file is used instead of a .sh script on purpose: Docker Desktop marks
-- bind-mounted files as executable, so the image would exec a shell script
-- instead of sourcing it, and executing a bind mount does not work there.

\getenv galena_password GALENA_DB_PASSWORD
\getenv ejabberd_password EJABBERD_DB_PASSWORD
\getenv litellm_password LITELLM_DB_PASSWORD

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'galena', :'galena_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'galena') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'galena', 'galena')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'galena') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'ejabberd', :'ejabberd_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ejabberd') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'ejabberd', 'ejabberd')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ejabberd') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'litellm', :'litellm_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'litellm') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'litellm', 'litellm')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'litellm') \gexec

-- pgvector ships with the image; make it available to our server's database.
\connect galena
CREATE EXTENSION IF NOT EXISTS vector;