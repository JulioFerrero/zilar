# Install Zilar

## One line

On a fresh Debian or Ubuntu box (x86_64 or arm64), with root or `sudo`:

```bash
curl -fsSL https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/install.sh | sh
```

Read [`../deploy/install.sh`](../deploy/install.sh) before you pipe it into a shell — it is
short, and it never prints a secret. It:

1. checks the host (10 GB free disk, 2 GB RAM, ports 80 and 443 free, `curl` and `tar`);
2. installs Docker from [get.docker.com](https://get.docker.com), only after you say yes;
3. downloads the latest release, or the `main` branch, and extracts only `deploy/` into
   `/opt/zilar`;
4. runs `./zilar init` (passing the official `ghcr.io/julioferrero` images);
5. optionally runs `./zilar host-setup` for AI computers (gVisor);
6. runs `./zilar up` and `./zilar doctor`, then prints the URL and `./zilar create-admin`.

Running it again updates `deploy/` and keeps your `.env`.

**Flags** (`sh install.sh --help` prints the same):

| Flag | Meaning |
|---|---|
| `--version TAG\|main` | release to install (default: the latest `v*` tag, else `main`) |
| `--dir PATH` | where `deploy/` is extracted (default: `/opt/zilar`) |
| `--domain HOST` | public host for Zilar (`init` asks when omitted) |
| `--admin-email EMAIL` | address of the first account (`init` asks when omitted) |
| `--desks` | also run `./zilar host-setup` (gVisor for AI computers) |
| `--yes` | no prompts (needs `--domain` and `--admin-email`) |
| `--dry-run` | print the plan, change nothing |

**Non-interactively** (automation, cloud-init):

```bash
curl -fsSL https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/install.sh | sh -s -- \
  --yes --domain chat.example.com --admin-email you@example.com --dir /opt/zilar
```

Add `--desks` to prepare the host for AI computers; add `--version v1.2.3` to pin a release.
To review the plan first, run `sh install.sh --dry-run`.

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
