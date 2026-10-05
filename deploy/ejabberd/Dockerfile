# Zilar ejabberd image with the production config baked in.
#
# The Coolify "Docker Compose Empty" path has no checkout of this repository,
# so the plain `deploy/docker-compose.yml` bind mounts of `ejabberd.yml` and
# `jwt-entrypoint.sh` cannot work there. This image copies both into the same
# paths the compose file mounts them at today, with the same entrypoint, so a
# pasted compose file needs no repository paths. Hosts, passwords, the upload
# URL and the JWT secret still arrive as container environment
# (EJABBERD_MACRO_* variables, see deploy/.env.example); nothing secret is
# baked in.
#
# Build from the deploy/ directory:
#
#   docker build -f ejabberd/Dockerfile -t zilar-ejabberd:local deploy/
#
# Published per release tag by .github/workflows/images.yml as
# ghcr.io/<owner>/zilar-ejabberd.

FROM ghcr.io/processone/ejabberd:26.07

COPY ejabberd/ejabberd.yml /opt/ejabberd/conf/ejabberd.yml
COPY --chmod=755 ejabberd/jwt-entrypoint.sh /zilar/jwt-entrypoint.sh
COPY --chmod=755 ejabberd/push-entrypoint.sh /zilar/push-entrypoint.sh

ENTRYPOINT ["/bin/sh", "/zilar/jwt-entrypoint.sh"]
CMD ["foreground"]
