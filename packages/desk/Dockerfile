# The desk jail image: one image, used by Zilar cloud and by every runner, so
# `bash / read / write / edit / grep / glob / git` behave the same everywhere
# (docs/audit/desk-runner-plan.md §3.1, docs/design/agent-system.md §2.6).
#
# The base is pinned by digest. `node:24-bookworm-slim` multi-arch index digest
# resolved 2026-10-14 with:
#   docker buildx imagetools inspect node:24-bookworm-slim
# Re-pin by rerunning that command and replacing the digest below.
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

# git, a shell, ripgrep, python3, build-essential, ca-certificates and jq; the
# system git config disables hooks and fsmonitor for every repo in the jail
# (the daemon also passes -c core.hooksPath=/dev/null on every call).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        ripgrep \
        python3 \
        python3-pip \
        build-essential \
        ca-certificates \
        jq \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system core.hooksPath /dev/null \
    && git config --system core.fsmonitor false \
    && useradd -u 10001 -m -d /workspace desk

# `pnpm --filter @zilar/desk build` produces this single self-contained file.
COPY dist/desk-tool /opt/desk/desk-tool
RUN chmod 0755 /opt/desk/desk-tool

USER 10001
WORKDIR /workspace

ENTRYPOINT ["/opt/desk/desk-tool", "serve"]
