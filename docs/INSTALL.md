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
   cannot run Docker (asking the provider to turn on nesting is the fix) — or,
   when Coolify is found, stops after the report and points you at the one-click
   template instead of installing on the host (see "On a host that runs Coolify"
   below);
3. installs Docker from [get.docker.com](https://get.docker.com) if it is missing,
   only after you say yes, then proves it runs with `docker run --rm hello-world`;
4. extracts only `deploy/` into `/opt/zilar` and runs `./zilar init` (passing the
   official `ghcr.io/julioferrero` images);
5. optionally runs `./zilar host-setup` for AI computers (gVisor) and proves a
   real gVisor sandbox run passes;
6. runs `./zilar up` and `./zilar doctor`, then prints the URL and `./zilar create-admin`.

Running it again updates `deploy/` and keeps your `.env`.

`get.zilar.app` redirects to the latest release's `install.sh`, so `curl -fsSL https://get.zilar.app | sh` always installs the newest release; pin a version with `--version vX.Y.Z`.

**Flags** (`sh install.sh --help` prints the same):

| Flag | Meaning |
|---|---|
| `--version TAG\|main` | release to install (default: the latest `v*` tag, else `main`) |
| `--dir PATH` | where `deploy/` is extracted (default: `/opt/zilar`) |
| `--domain HOST` | public host for Zilar (`init` asks when omitted) |
| `--admin-email EMAIL` | address of the first account (`init` asks when omitted) |
| `--desks` | also prepare the host for AI computers (`./zilar host-setup`), then check the gVisor sandbox |
| `--desks-host` | on a Coolify host: run only the AI-computer host prep and the sandbox check |
| `--yes` | no prompts (needs `--domain` and `--admin-email`) |
| `--dry-run` | print the plan, change nothing |

**Non-interactively** (automation, cloud-init):

```bash
curl -fsSL https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/install.sh | sh -s -- \
  --yes --domain chat.example.com --admin-email you@example.com --dir /opt/zilar
```

Add `--desks` to prepare the host for AI computers; the desk agent runs on every
install and stays idle until the host has gVisor. Add `--version v1.2.3` to pin a release.
To review the plan first, run `sh install.sh --dry-run`.

On a host that runs Coolify, the installer stops after the host report and points
you at the one-click template instead of installing on the host:

1. In Coolify, create a resource from a Docker Compose file (New Resource →
   Docker Compose Empty) and paste
   `https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/coolify/docker-compose.yml`
   — or pick "Zilar" once it is in Coolify's catalog.
2. Set the domain on the `web` service and deploy.

AI computers need gVisor and a memory pool on the host, which Coolify cannot
install. Run one host command:

```bash
curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host
```

It runs only the host prep and a real gVisor sandbox check, then prints one
line when the host is ready. The desk services already run in the stack and
stay idle until then, so computers turn on within about a minute and there is
nothing to set on the Zilar service in Coolify and no redeploy. It also works
on a plain-Docker host, but there the installer's own prompt (or `--desks`)
covers it.

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
