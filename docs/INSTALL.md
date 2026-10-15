# Install Zilar

## One line

On a fresh Debian or Ubuntu box (x86_64 or arm64), with root or `sudo`:

```bash
curl -fsSL https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/install.sh | sh
```

Read [`../deploy/install.sh`](../deploy/install.sh) before you pipe it into a shell — it is
short, and it never prints a secret. It:

1. checks `curl`, `tar` and that the host is Linux, fetches the release into a temp
   directory, and prints a host report (OS and version, CPU architecture, RAM, free
   disk, ports 80/443, virtualization, Docker, Coolify);
2. stops early, with a clear message, when the host is a container-based VPS that
   cannot run Docker (asking the provider to turn on nesting is the fix) — or, when
   Coolify is found, installs into Coolify through its API instead: it asks for a
   Coolify API token (under Coolify's "Keys & Tokens"; with `--yes`, read from
   `ZILAR_COOLIFY_TOKEN`) and creates project "Zilar" with the `zilar-core` service
   and the `zilar-server` and `zilar-web` image apps, fills in the generated
   secrets and derived variables, deploys, waits for `/health`, offers AI
   computers, writes a root-only copy of the secrets to
   `/root/zilar-secrets-<date>.env` and mints the first invite code;
3. installs Docker from [get.docker.com](https://get.docker.com) if it is missing,
   only after you say yes, then proves it runs with `docker run --rm hello-world`;
4. extracts only `deploy/` into `/opt/zilar` and runs `./zilar init` (passing the
   official `ghcr.io/julioferrero` images);
5. optionally runs `./zilar host-setup` for AI computers (gVisor) and turns them on
   (`DESKS_ENABLED=true`) only after a real gVisor sandbox run passes;
6. runs `./zilar up` and `./zilar doctor`, then prints the URL and `./zilar create-admin`.

Running it again updates `deploy/` and keeps your `.env`.

**Flags** (`sh install.sh --help` prints the same):

| Flag | Meaning |
|---|---|
| `--version TAG\|main` | release to install (default: the latest `v*` tag, else `main`) |
| `--dir PATH` | where `deploy/` is extracted (default: `/opt/zilar`) |
| `--domain HOST` | public host for Zilar (`init` asks when omitted) |
| `--admin-email EMAIL` | address of the first account (`init` asks when omitted) |
| `--desks` | also run `./zilar host-setup`, then turn AI computers on once the gVisor sandbox passes |
| `--yes` | no prompts (needs `--domain` and `--admin-email`; on a Coolify host, also `ZILAR_COOLIFY_TOKEN`) |
| `--dry-run` | print the plan, change nothing |

**Non-interactively** (automation, cloud-init):

```bash
curl -fsSL https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/install.sh | sh -s -- \
  --yes --domain chat.example.com --admin-email you@example.com --dir /opt/zilar
```

Add `--desks` to prepare the host for AI computers; add `--version v1.2.3` to pin a release.
To review the plan first, run `sh install.sh --dry-run`.

On a host that runs Coolify, the installer takes the Coolify path: it asks for a
Coolify API token (create one under "Keys & Tokens"). With `--yes` it reads the
token from `ZILAR_COOLIFY_TOKEN` instead, so a cloud-init run can install into
Coolify without a prompt:

```bash
curl -fsSL https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/install.sh | ZILAR_COOLIFY_TOKEN=CHANGE_ME sh -s -- \
  --yes --domain chat.example.com --admin-email you@example.com
```

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
