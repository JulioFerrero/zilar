# Install Zilar

Your own chat server, where people and your AIs talk together. Pick one
path — they all run the same code:

| Path | Effort | Pick it when… | Guide |
|---|---|---|---|
| **Docker** | Five minutes | You want the tested, supported install: one command, automatic HTTPS, updates by pulling images. | [INSTALL_DOCKER.md](INSTALL_DOCKER.md) |
| **Coolify** | Ten minutes, no clone | You already run Coolify: paste a compose file, fill variables, Coolify handles HTTPS. | [INSTALL_DOCKER.md](INSTALL_DOCKER.md) ("The Coolify path") |
| **Bare metal** | An afternoon | You do not want Docker and you are comfortable with Linux (systemd, your own Postgres and ejabberd). | [INSTALL_BARE_METAL.md](INSTALL_BARE_METAL.md) |

Requirements for any path: 1 vCPU / 2 GB RAM is enough for a small
group and a few hundred users of chat; you need more only if many AI
turns run on the same machine. Every path needs a domain pointing at
the host (or `localhost` just to try it out) and an email provider for
sign-in codes — Zilar signs people in with a one-time code sent by
email, there is no password login.

What was actually tested: the Docker stack on `localhost` (full proof
in the install guides); a real domain, the Coolify path and the
bare-metal guide were **not** verified live — each guide says exactly
what was and was not tested.
