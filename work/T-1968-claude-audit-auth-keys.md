---
id: T-1968
title: "Claude security audit 1/4: auth, sessions, invites, account export/deletion, stored provider keys, outbound fetch (SSRF), client IP and rate limits — findings go to a PRIVATE file"
status: merged
milestone: M5
branch: task/T-1968-claude-audit-auth-keys
model: anthropic/claude-opus-5-5
effort: high
estimate: 45 min
---

# T-1968: Claude security audit 1 (auth and keys)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: spend the Claude API credits on "find with Claude, fix with DeepSeek". Auth and keys is the first of four areas (`.claude` memory `claude-credits-1018`). This task only **finds**; every confirmed finding becomes its own cheap fix task later.

### The one hard rule: findings stay private
**The repo is public.** Do **not** put any finding, file:line, attack description or hint of one in the repo: not in this task file, not in a doc, not in a commit message, not in a code comment.

Write every finding to `/Users/julio/.zilar-lead/audits/T-1968-auth-keys.md` (outside the repo; create the folder if it is missing). In this task file's Report, write only the counts per severity and the private file's path.

**Read only:** change no source file. The only repo file you change is this task file's Report.

### Scope (paths under `apps/server/src/`)

| Area | Files |
|---|---|
| Sessions and sign-in | `auth/auth.ts`, `auth/sessions.ts`, `auth/api.ts`, `auth/me-view.ts`, `auth/sql-adapter.ts`, `auth/sql-where.ts` |
| Invites | `auth/invites.ts`, `auth/invite-cli.ts`, `invite-links/api.ts`, `invite-links/join.ts`, `invite-links/service.ts`, `invite-links/queries.ts` |
| Account data | `auth/export.ts`, `auth/export-stream.ts`, `auth/deletion-request.ts` |
| Mail | `auth/mailer.ts` |
| Stored provider keys | `connections/api.ts`, `connections/service.ts`, `connections/crypto.ts`, `connections/providers.ts` |
| Outbound fetch | `connections/pinned-fetch.ts`, `connections/base-url.ts`, `connections/probe.ts`, `http/read-capped.ts` |
| Client IP and limits | `http/client-ip.ts`, `rate-limit.ts`, `kdf-labels.ts` |
| XMPP token | the route that issues the XMPP token (find it from `getXmppToken` in `packages/client-core`, then follow it into the server) |

Follow a call into another file whenever you need to, to confirm or rule out a path.

### What to look for (each needs a concrete path through the code)
- **Sessions:** a session that survives logout, a password change or account deletion; a token or cookie that is guessable, never expires, or lacks `HttpOnly`/`Secure`/`SameSite`; a login CSRF.
- **Authorization:** a route that trusts an id from the request without checking it belongs to the caller (an IDOR): export, deletion, invites, connections, `me`.
- **Invites:** a code that is guessable, reusable past its limit, or still valid after revoke or expiry; a join that skips a check.
- **Mail:** a link built from the request's `Host` or `X-Forwarded-*` headers, so an attacker can poison the link; header injection.
- **SQL:** injection through `sql-where.ts` or the adapter, meaning any string concatenated into SQL.
- **Stored keys:** a key returned to the client, logged, or sent in an error; weak encryption (check the cipher, the IV/nonce reuse and where the key comes from in `connections/crypto.ts`); one user reading or using another's key.
- **SSRF:** a user-supplied base URL that can reach `localhost`, private ranges, the metadata IP or other internal services, including through redirects or DNS rebinding around the pin in `pinned-fetch.ts`.
- **Client IP:** a spoofed `X-Forwarded-For` that bypasses a rate limit or a lockout.

### How to report (in the private file)
- **A header:** the date, the commit you read (`git rev-parse --short HEAD`) and the files read.
- **Each finding:**
  - **ID:** `A1-01`, `A1-02` and so on.
  - **Severity:** `critical`, `high`, `medium` or `low`.
  - **Where:** `file:line`.
  - **The attack:** what an attacker does, in plain steps. **No working exploit code.**
  - **Why the code allows it:** quote the lines.
  - **The fix:** in one or two sentences.
  - **Confidence:** `confirmed` (you read the whole path) or `plausible` (one link unverified; say which).
- **Then a short "ruled out" list:** what you checked that is fine, one line each, so the next audit doesn't redo it.
- **At most 15 findings.** No style, no tests, and no generic "add hardening" items without a concrete path. If you find nothing in an area, say so.

### Allowed files
- `work/T-1968-claude-audit-auth-keys.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The private file exists, with findings in the format above.
- The Report has only counts and the path.
- No other repo file changed.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Read-only audit of every file in the Scope table, plus the XMPP token route, following calls into other files where needed.
- Findings are in the private file `/Users/julio/.zilar-lead/audits/T-1968-auth-keys.md` (outside the repo), in the format the spec asks for, with a "ruled out" list.
- Counts: critical 0, high 0, medium 5, low 3.
- Repo files changed: this task file only (front matter and Report). No source file changed.

### Checks run
- `pnpm install`: done.
- No tests run: this audit changes no source file, so there was nothing to test.
- `pnpm gate` (exit 0):
  ```
  gate: 1 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (1.4s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- Details are in the private file only.

## Review (written by Claude)

**Approved and merged (task file only).**
- **Findings:** they stay in the lead's private file. The lead read all 8, each with `file:line`, a concrete path, a fix and a confidence level.
- **Fix tasks:** the lead turns them into separate tasks.
- **Cost:** the session cost $2.84 on `anthropic/claude-opus-5-5` (Julio's promo credits).
