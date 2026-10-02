-- Creates one role and one database per Zilar service.
--
-- The postgres image runs this on the first start of an empty data volume.
-- Passwords come from the container environment (deploy/.env), never from git.
-- A .sql file is used instead of a .sh script on purpose: Docker Desktop marks
-- bind-mounted files as executable, so the image would exec a shell script
-- instead of sourcing it, and executing a bind mount does not work there.
--
-- Production copy of infra/postgres/init/10-create-databases.sql, minus the
-- LiteLLM role and database: the production stack ships no LiteLLM service.

\getenv zilar_password ZILAR_DB_PASSWORD
\getenv ejabberd_password EJABBERD_DB_PASSWORD

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'zilar', :'zilar_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zilar') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'zilar', 'zilar')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'zilar') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'ejabberd', :'ejabberd_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ejabberd') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'ejabberd', 'ejabberd')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ejabberd') \gexec

-- pgvector ships with the image; make it available to our server's database.
\connect zilar
CREATE EXTENSION IF NOT EXISTS vector;
