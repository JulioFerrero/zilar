---
id: T-0072
title: The runner app (M3, skeleton) — `galena-runner pair` and `run`: capability report, key pair on disk, pairing, and the tunnel connection
status: todo
milestone: M3
branch: task/T-0072-runner-app
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0068, T-0008]
estimate: 1.5 days
---

# T-0072: The runner app (skeleton)

## Spec (written by Claude, do not edit)

### Goal

Bring-your-own-compute needs the piece users install on their machines (`docs/PROJECT_PLAN.md` §11.2, §11.3, §11.9). This task creates `apps/runner` as a small Node CLI with two real commands and no desks yet:
- `galena-runner pair <CODE> --server <URL> [--name NAME]`: creates an ed25519 key pair, detects what the machine can do (the capability report), proves it holds the key and registers with the server (`POST /api/runner/pair`, built in T-0068), then stores its identity on disk.
- `galena-runner run`: reads the identity and connects to the server's runner hub with the `RunnerClient` from `@galena/runner-tunnel`, reconnecting with backoff, until stopped.
The server-side hub (T-0071) is being built in parallel, so `run` is proven here against the **in-process `TunnelServer` from the package** (as the package's own tests do), not against the real server.

The Docker driver, desks and OpenCode come in later tasks. **This app must not execute anything on behalf of the server.** The runner only understands what the protocol package lets it do (open allowlisted ports), and nothing here adds a "run a command" path (§11.9).

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §11.2 (pairing), §11.3 (the capability report, example JSON), §11.4, §11.9 (trust), §11.13
- `apps/server/src/machines/routes.ts` (**read only**): the exact `POST /api/runner/pair` request (`code`, `publicKey`, `signature`, `name`, `capabilities`: a strict object, check every field and its limits) and responses (`201 { machineId, status: 'pending' }`, `400 invalid_code`, `409 key_in_use`, `429`), and `machines/codes.ts` (`normalizePairingCode`, `pairingSignatureMessage`: the signature is over the ASCII bytes `galena-pair:v1:<NORMALIZED_CODE>`)
- `packages/runner-tunnel/src/keys.ts` (`generateRunnerKeypair`, `signNonce`; keys are base64 DER: SPKI public, PKCS8 private), `runner.ts` (`RunnerClient`: `serverUrl` must be `ws://…`, `runnerId`, `keypair`, events, `stop()`, close codes), `protocol.ts`, and `test-harness.ts` (how tests start a `TunnelServer` and a client)
- An existing package for conventions: `packages/runner-tunnel/package.json`, `tsconfig.json`; `apps/server/package.json` for scripts

### Allowed files
- `apps/runner/**` (new: `package.json`, `tsconfig.json`, `src/**`, tests, a short `README.md`)
- `pnpm-lock.yaml`
- `work/T-0072-runner-app.md`

**Not allowed:** everything else (`packages/**`, `apps/server/**`, web, mobile, `docs/**`, the root config). If the root `tsconfig`/turbo/lint setup needs a change for the new package, say so in the Report instead of editing it.

### Allowed dependencies
- `@galena/runner-tunnel` (`workspace:*`), `zod` (same version as the other packages), `tsx` (dev, same version as the server) and `vitest` (dev, same version as the other packages). **Nothing else**: use Node built-ins (`node:crypto`, `node:os`, `node:fs`, `node:util` `parseArgs`, global `fetch`) for the rest.

### What to build

Layout: `package.json` (`"name": "@galena/runner"`, `"private": true`, `"type": "module"`, scripts `typecheck`, `test`, `start` = `tsx src/cli.ts`), `tsconfig.json` like `packages/runner-tunnel` (Node types). Source under `src/`:

1. **`capabilities.ts`.** `detectCapabilities(deps?)` returns the report in the exact shape the server validates (snake_case: `os`, `os_version`, `arch`, `cpu`, `cores`, `ram_gb`, `disk_free_gb`, `power`, `drivers`, `tools`, `labels`, `runner_version`) with values within the server's limits (trimmed, non-empty strings, `cores >= 1`, `drivers` ≤ 32 entries of ≤ 64 characters, and so on). Sources: `os.platform()` (`darwin` → `macos`), `os.release()`, `os.arch()`, `os.cpus()`, `os.totalmem()`, free disk from `fs.statfs` of the home directory, `power` = `laptop`/`desktop` (`unknown` if not detectable; a simple heuristic is fine). `drivers`: `docker` when `docker version --format '{{.Server.Version}}'` succeeds within 3 s (run it with `execFile`, never through a shell, and cap the output); more drivers are out of scope. Everything that touches the machine goes through an injectable `deps` object so tests use fakes. A failing probe yields an empty list, never an error.
2. **`identity.ts`.** The identity file: `{ version: 1, serverUrl, machineId, publicKey, privateKey, name, createdAt }`, validated with zod on read. Default path `~/.galena-runner/identity.json`, overridable with `--home DIR` or `GALENA_RUNNER_HOME`. **Security rules (test each):** the directory is created `0700` and the file `0600` (write to a temp file in the same directory, `chmod`, then `rename`, so a crash never leaves a half-written or world-readable key); refuse to load an identity whose file is readable by group or others (clear error telling the user to `chmod 600`); a second `pair` refuses to overwrite an existing identity unless `--force`; the private key is **never printed or logged**, not even in error messages (redact).
3. **`pair.ts`.** `pairRunner({ code, serverUrl, name, ...deps })`:
   - normalize the code the way the server does (uppercase, strip spaces and dashes, 8 characters of the server's alphabet) and fail early with a friendly message for an impossible code;
   - generate the key pair (`generateRunnerKeypair`), sign `galena-pair:v1:<NORMALIZED>` with the private key (Node `crypto.sign(null, message, privateKey)`; check `signNonce` in the package and reuse it if it fits, otherwise use `crypto` directly with the same key format);
   - `POST <server>/api/runner/pair` with a 15 s timeout (`AbortSignal.timeout`), JSON body as the server's strict schema requires. `serverUrl` must be `http(s)://…` (validate with `URL`); it is only ever used to build that request and the hub URL below;
   - on `201`, save the identity (only after success) and return `{ machineId, fingerprint }` where `fingerprint` is the first 16 hex characters of `sha256(public key DER bytes)`, exactly how the server computes it, so the owner can compare it with the web page;
   - map errors to human messages: `400 invalid_code` ("That pairing code is invalid or expired. Get a new one from Settings → Machines."), `409 key_in_use`, `429` ("Too many attempts, wait a minute"), network failure, any other status; never echo the raw response body.
   - The machine name defaults to `os.hostname()` (trimmed to 64, at least 1 character).
4. **`connect.ts`.** `runRunner({ identity, ... })`:
   - derive the tunnel URL from `identity.serverUrl`: `http://host:PORT` → `ws://host:HUB_PORT/tunnel` where the hub port comes from the identity file's optional `hubUrl` or the `--hub URL` flag (the hub listens on its own port, `3189` by default, and the exact public URL is a deployment matter; do not guess: `run` requires `--hub ws://…` the first time, stores it in the identity as `hubUrl`, and prints a clear error if it is missing);
   - start a `RunnerClient` with `runnerId = machineId`, the stored key pair, `exposedPorts: []` (no ports are exposed yet) and `enableModelListener: false` (no desk exists), log one line per state change (`connecting`, `online`, `disconnected (code)`, `revoked: this machine was revoked, run pair again with a new code`), handle `SIGINT`/`SIGTERM` by stopping cleanly, and exit with a non-zero code when the server closes with the **revoked** or **auth** code (no endless reconnect loop after a revoke);
   - reconnect with the client's own backoff otherwise.
5. **`cli.ts`.** `pair`, `run`, `status` and `help` with `parseArgs`: `status` prints the machine id, name, server, fingerprint and file location (**never the key**). Unknown commands and flags print the usage and exit 2. Exit codes: 0 ok, 1 runtime failure, 2 usage. All output goes to stdout/stderr through small helpers so tests can capture it.
6. **`README.md`**: what the runner is, the two commands, where the identity lives, and the sentence "This runner cannot execute commands from the server; desks are a later step."

### Tests (Vitest, no external network, no Docker required)
- Capabilities: the report validates against a copy of the server's schema **written in the test** (do not import server code); a failing docker probe → `drivers: []`; a missing `statfs` → sensible fallback; strings trimmed and capped.
- Identity: round trip; file mode `0600` and directory `0700` after save (skip the mode assertions on Windows); refuses a group/world-readable file; refuses overwrite without `--force`; a corrupt or wrong-version file gives a clear error; the private key never appears in any thrown error message (assert on `String(error)`).
- Pair: against a **fake HTTP server** started in the test on a random port that implements the server's rules with real crypto (verify the signature over `galena-pair:v1:<CODE>` with the public key it received): happy path saves an identity and returns the fingerprint equal to `sha256(public DER)` first 16 hex; `400`, `409`, `429`, a timeout and a dead port map to the right messages; a bad code never hits the network; a failed pair leaves no identity file behind.
- Connect: with the package's `TunnelServer` and an `InMemoryKeyRegistry` on a loopback port: an approved key connects (`ready`); a key the registry does not know is refused and `run` exits non-zero without looping; revoking through the registry (`registry.revoke`) makes `run` end with the revoked message and a non-zero exit; SIGTERM-style stop resolves cleanly (call the exported stop function, do not send real signals).
- CLI: `help`, unknown command → 2, `status` without an identity → clear error, `status` output never contains the private key.
- Every test uses a temp directory for the identity home and cleans it up.

### Integration / manual check
Optional and honest: if you can, run `pnpm --filter @galena/runner start help` and show its output in the Report. Do **not** run `pair` or `run` against the real server or Julio's stack (ports 3000, 3188, 5173, 8081 and 3189 are off limits), and never write into the real home directory: always pass `--home` or set `GALENA_RUNNER_HOME` to a temp folder.

### Acceptance criteria
- [ ] `pair` registers a machine with a real proof of possession and stores the identity with `0600` permissions, without ever printing or logging the private key.
- [ ] `run` authenticates with the tunnel, reconnects with backoff, and stops (non-zero) on revoke or auth failure instead of looping.
- [ ] The runner can't be asked to run commands (no exec path from the network).
- [ ] The only new dependencies are the ones listed; no `any`, no `@ts-ignore`.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/runner
pnpm build
```
(Also run the whole `pnpm test` once to prove the new workspace does not break the others.)

### Out of scope
- Desks, the Docker driver, OpenCode, previews, model traffic, installers, auto-update, a menu-bar app, `wss://` / TLS, Windows.
- Changing the server, the tunnel package or the protocol.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
