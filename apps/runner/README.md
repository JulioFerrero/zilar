# @zilar/runner

The Zilar runner is a small Node CLI that you install on a machine you own.
It pairs with your Zilar server and stays online so the server can reach
the machine's desks. The server's hub is the one outbound WebSocket — the
runner works behind home routers and company firewalls.

## Commands

### `pair <CODE> --server <URL> [--name NAME]`

Generates an ed25519 key pair, detects the machine's capabilities, and
registers with the server's `POST /api/runner/pair` endpoint. The private
key never leaves the machine; the identity is saved to
`<home>/identity.json` with `0600` permissions.

After pairing, approve the machine in **Settings → Machines** in the web
app.

### `run [--hub WS_URL]`

Reads the identity and connects to the server's runner hub with
`@zilar/runner-tunnel`'s `RunnerClient`. It reconnects with backoff
when the link drops. The first run after pairing needs `--hub
ws://your-server:3189/tunnel`; the URL is saved to the identity for next
time.

`run` exits with a non-zero code if the server closes the connection
because the machine was revoked or because the auth failed; it never
loops forever in that state.

### `status`

Prints the machine id, friendly name, server, fingerprint and identity
file path. The private key is never printed.

## Where the identity lives

- Default: `~/.zilar-runner/identity.json` (file `0600`, directory `0700`)
- Override with `--home DIR` or the `ZILAR_RUNNER_HOME` environment variable

## Trust

The runner only opens the allowlisted ports the protocol package lets the
server open, and it runs desks only inside a jail (see below). A compromised
server cannot take over your machine.

## AI computers on your runner

An AI with a computer enabled can run its desk on your runner: the same jail
image and the same tool daemon as Zilar cloud, driven by the same lifecycle
code (`@zilar/desk`). The brain stays on the server; only the hands run here.

There is **no unsandboxed mode**. At start-up the runner picks an isolation
driver and refuses to run desks when it finds none:

| Host | Driver | Jail |
| --- | --- | --- |
| Linux | `runsc` | Docker with the gVisor runtime registered |
| macOS | `docker-vm` | Docker Desktop or OrbStack (its Linux VM is the boundary) |
| Other | — | refused |

When no driver is found the runner still pairs and serves its other features,
but it answers every `desk.provision` with `jail_unavailable`.
(bubblewrap on Linux is a later step.)

### Local policy: `~/.zilar-runner/policy.json`

Optional. It can only **tighten** what the server asks for: the effective
value of every limit is `min(server request, local ceiling)`, and a clamp is
logged. A missing or invalid file means the defaults (2 GiB memory, 256 pids,
5 GiB disk, 2 desks running).

```json
{
  "allowNetwork": true,
  "maxMemoryGb": 2,
  "maxCpuShares": 512,
  "maxDiskGb": 5,
  "maxRunning": 2
}
```

`allowNetwork: false` drops all egress for every desk on this runner.
