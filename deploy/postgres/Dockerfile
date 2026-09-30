# Galena Postgres image with the schema bootstrap baked in.
#
# The Coolify "Docker Compose Empty" path has no checkout of this repository,
# so the plain `deploy/docker-compose.yml` bind mount of `./postgres/init`
# cannot work there. This image copies the same init scripts into
# /docker-entrypoint-initdb.d/ so a pasted compose file needs no repository
# paths. The stock Postgres entrypoint runs them on the first start of an
# empty data volume; passwords still arrive as container environment
# (deploy/.env or Coolify SERVICE_PASSWORD_*), never from git.
#
# Build from the deploy/ directory:
#
#   docker build -f postgres/Dockerfile -t galena-postgres:local deploy/
#
# Published per release tag by .github/workflows/images.yml as
# ghcr.io/<owner>/galena-postgres.

FROM pgvector/pgvector:0.8.6-pg18-trixie

COPY postgres/init/ /docker-entrypoint-initdb.d/
