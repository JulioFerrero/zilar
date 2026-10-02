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

This runner cannot execute commands from the server; desks are a later step.
The runner only knows how to open the allowlisted ports the protocol
package lets the server open. A compromised server cannot take over your
machine.