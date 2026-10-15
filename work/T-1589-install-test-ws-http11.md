---
id: T-1589
title: "Fresh-install CI test: the XMPP WebSocket check forces HTTP/1.1 (curl negotiated HTTP/2 over TLS, so the Upgrade request was answered 200 instead of 101 in the first real run 38772833055); on a failed check print the response headers"
status: merged
milestone: M5
branch: task/T-1589-install-test-ws-http11
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1589: WebSocket check over HTTP/1.1

## Spec (written by Claude, do not edit)

### Why
The first manual run of the new "Fresh install" workflow (T-1583, GitHub run 38772833055 on main `0bdd29272`, 2026-10-15) got this far:
- the install succeeded on a fresh runner;
- `/health` answered 200 with `ok:true`;
- `/api/me` answered 401;
- **`/xmpp-ws/ws` answered 200, not 101**, so the job failed before the migrations check.

**The likely cause:** `curl -k -sS --resolve localhost:443:127.0.0.1` over HTTPS negotiates HTTP/2, which has no `Upgrade:` header handshake, so the request goes through as a plain GET. The T-0126 proof (`docs/INSTALL_DOCKER.md` "What was tested") saw 101 over HTTP/1.1.

### Facts (the lead read them on main `0bdd29272`)
- **`.github/workflows/install-test.yml`:**
  - the step "Assert /health, /api/me and the XMPP WebSocket" builds `curl_https="curl -k -sS --max-time 15 --resolve localhost:443:127.0.0.1"` and runs the upgrade with `-H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: …'`, expecting `101`;
  - the next step, "Assert every migration is applied", was skipped.
- **The pre-review nit:** a comment in the same file hard-codes "applies 67 migrations".

### Steps
1. **The WebSocket curl only:** add `--http1.1`. Also send `-H 'Sec-WebSocket-Protocol: xmpp'`, which is what XMPP clients send. With `--max-time 5`, the handshake returns its headers and curl then waits, so keep `|| true` and read the code from `-w`.
2. **When the code isn't 101,** print the response status line and headers (`-D -`, without the body) before failing, so a real failure shows what answered.
3. **The comment:** remove the hard-coded "67" (the count is read live).
4. **Nothing else changes.**

### Tests
The workflow is the test. The lead dispatches it after merge.

### Allowed files
- `.github/workflows/install-test.yml`
- `work/T-1589-install-test-ws-http11.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The diff** is limited to the WebSocket curl, the failure print and the comment.
- **The lead's dispatch** after merge passes all three assertions and the migrations check.

---

## Report (written by the worker when done)

### What I did

Changed only the WebSocket assertion step in `.github/workflows/install-test.yml`, plus the
stale comment:

1. **WebSocket curl** now forces HTTP/1.1 (`--http1.1`) so the `Upgrade:` handshake is not
   skipped by HTTP/2, and sends `-H 'Sec-WebSocket-Protocol: xmpp'` like an XMPP client. It
   uses `--max-time 5`, keeps `|| true`, and reads the code from `-w`.
2. **Failure print**: the curl output (`-D -`, so the status line and headers, with `-o
   /dev/null` dropping the body) is captured; `code` is taken from the trailing `-w` line. When
   the code is not `101`, the captured status line and headers are printed before the
   `::error::` and `exit 1`, so a real failure shows what answered.
3. **Comment**: the job-header comment no longer hard-codes "applies 67 migrations"; it now
   says "applies every migration" (the count is read live in the migrations step).

Nothing else changed.

### Checks run

- `pnpm gate` (repo root): ended with `GATE PASS`.
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.2s)
  PASS  lint  (1.3s)
  PASS  typecheck  (1.4s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single-file tests were run: this task touches only a GitHub Actions workflow file and this
  task file, so no workspace package changed (`gate` reports `SKIP effect`).

### Notes for the lead

- The workflow is the test; it needs a dispatch after merge. I could not exercise the live
  WebSocket handshake here (no fresh container stack in this worktree), so the `101` path is
  unverified by me — the change matches the T-0126 HTTP/1.1 proof in `docs/INSTALL_DOCKER.md`.
- `--max-time 5` is added on top of the shared `$curl_https` (which sets 15); curl keeps the last
  value for a repeated option, so the WS request gets the 5s ceiling the spec wants.
- Files changed: `.github/workflows/install-test.yml`, `work/T-1589-install-test-ws-http11.md`.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits.
- **The diff is only what the spec asked:**
  - the WebSocket curl adds `--http1.1 --max-time 5`, `-H 'Sec-WebSocket-Protocol: xmpp'` and `-D -`;
  - on a non-101 it prints the status and headers before failing;
  - the "67 migrations" comment now says "every migration".
- **After merge:** the lead dispatches the workflow again and records the result in `work/NOW.md`.

