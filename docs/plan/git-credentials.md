# Git credentials for AI computers: a short-lived GitHub token the jail never holds (T-1653)

- **Written by** the worker on 2026-10-16 from the lead's task `work/T-1653-git-credentials-plan.md`.
- **Goal:** give an AI computer (gVisor jail) a safe way to `git clone` and `git push` its
  owner's private repo, where the token is minted by the server, lives only in the egress
  proxy, and never appears in the jail's env or `/proc`.
- **Constraint:** docs only. Nothing here is implemented. Every claim about today's code
  carries a `file:line`.
- **Read alongside:** `docs/audit/desk-runner-plan.md` §5.1–5.4 (`:450-494`) and §8 Task F
  (`:660-670`), `docs/PROJECT_PLAN.md:1114-1124` (§12), and `docs/design/agent-system.md:77`
  and `:146` (the "credentials never enter the jail" decision).

The proxy, the jail and the per-desk credential already exist; what is missing is a token and
a way to attach it to a git request. The approved plan (`desk-runner-plan.md:477-494`) assumed
the proxy could add a header on HTTPS requests to `github.com`; §1 shows why today's proxy cannot,
and §2 picks a shape that does not need TLS interception.

---

## 1. Today: the proxy, the registry and how the jail reaches them

### 1.1 The proxy request path

`desk-egress` is a plain `node:http`/`node:net` process; the jails dial it as
`desk-egress:3128` (`packages/desk/src/egress/main.ts:13-15`, config read at `:35-47`, started
at `:55-69`). It serves two shapes:

1. **Plain `http://` GET/HEAD** — `handleRequest` (`packages/desk/src/egress/proxy.ts:94-185`).
   Only `GET` and `HEAD` are accepted (`proxy.ts:120-124`); the host is resolved and pinned by
   `checkTarget` on **port 80 only** (`proxy.ts:126-136`, ports at `packages/desk/src/egress/policy.ts:11`).
   The forwarded header map is built at `proxy.ts:137-141`.
2. **`CONNECT host:443`** — `handleConnect` (`proxy.ts:188-256`), registered on the server's
   `'connect'` event (`proxy.ts:282-302`); the target is pinned on **port 443 only**
   (`proxy.ts:213-218`).

Both paths answer **407** when the per-desk credential is missing or wrong (`proxy.ts:261-266`
and `:285-289`).

### 1.2 How a request is tied to a desk

The proxy reads `Proxy-Authorization: Basic base64(<deskId>:<secret>)` in `authenticate`
(`packages/desk/src/egress/proxy.ts:42-60`) and looks the desk up in an in-memory registry
(`DeskRegistry.authenticate`, `packages/desk/src/egress/registry.ts:42-48`; constant-time compare
at `registry.ts:20-27`). A `DeskRegistration` today is exactly `{ deskId, secret, allowedHosts }`
(`registry.ts:12-18`); the register wire request carries that same triple
(`registry.ts:61-74`, applied at `:101-106`). The sidecar is the only writer, over a unix socket
(`DEFAULT_REGISTRY_SOCKET = '/run/zilar/egress.sock'`, `registry.ts:10`), through
`createRegistryClient` (`registry.ts:209-217`).

### 1.3 How the jail reaches the proxy

The sidecar mints one secret per desk for its lifetime (`packages/desk/src/agent/egress.ts:27-44`)
and builds the jail's proxy URL `http://<deskId>:<secret>@<host:port>` (`agent/egress.ts:16-21`).
It registers on provision and unregisters on stop (`packages/desk/src/agent/lifecycle.ts:204-226`,
called at `:165` and `:210`; unregister at `:217-226`). The URL reaches the jail as
`HTTP_PROXY`/`HTTPS_PROXY` (`packages/desk/src/agent/docker-args.ts:38-50`), with
`NO_PROXY=localhost,127.0.0.1` (`docker-args.ts:48`). Because gVisor cannot use Docker's embedded
DNS, the proxy name is pinned in the jail's `/etc/hosts` (`docker-args.ts:62-98`, flag at
`:140-143`).

### 1.4 Can a CONNECT tunnel be inspected today? No — say it plainly

A `CONNECT github.com:443` is, after the `200 Connection Established` line, a **blind byte pipe**:
the proxy only counts bytes and pipes both directions (`packages/desk/src/egress/proxy.ts:234-244`).
It never parses TLS, so it cannot see the HTTP request, cannot read the path, and cannot add a
header. `git clone https://github.com/...` therefore already works through the tunnel for **public**
repos, with no credential, and there is **no place today** to inject a token on that path.

The only header-injection hook that exists is `BeforeForward`
(`packages/desk/src/egress/proxy.ts:20-26`), and it is called **only** in the plain-HTTP forward
(`proxy.ts:137-141`) where it returns `{}` today (`proxy.ts:26`). It is never reached on the git
path, because git over HTTPS uses CONNECT, not the plain forward.

**Consequence:** host+path `Authorization` injection on `https://github.com` requires the proxy to
**terminate TLS for `github.com`** (option a), or git must ask the proxy for a credential before
dialing (option b), or git must speak plain HTTP to the proxy and let the proxy speak TLS to GitHub
(option c). §2 compares them.

### 1.5 Today's config, and the unused `git` field

- The App credentials are declared but nothing uses them: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`
  and `GITHUB_APP_INSTALLATION_ID` are optional and must be set together
  (`apps/server/src/config/server-schema.ts:38-42`, cross-field rule at
  `apps/server/src/config/mail.ts:18-30`); the private key is in the logger's redact list
  (`apps/server/src/logger.ts:27`, list at `:19-35`). A search of `apps/server/src` shows the only
  readers are those two config files and the logger. `jose` (JWT signing) is already a dependency
  (`apps/server/package.json:32`).
- The wire shape for a permitted repo **already exists and is unused.** `DeskEgressPolicy` has an
  optional `git: { host, ownerRepo }` (`packages/desk/src/hands.ts:54-64`); the runner frame mirrors
  it as `{ host, owner_repo }` (`packages/runner-tunnel/src/desk-frames.ts:64-74`); the server fills
  it server→runner (`apps/server/src/hands/runner-hands.ts:99-105`) and the runner fills it
  frame→sidecar (`apps/runner/src/desk/handler.ts:179-190`). But the turn never sets `egress`
  (`apps/server/src/agents/gateway/desk-exec.ts:91-105` — no `egress` field), and the sidecar's
  `registerEgress` ignores `spec.egress.git`, passing only `allowedHosts`
  (`packages/desk/src/agent/lifecycle.ts:204-214`). So the field is plumbed but dead.
- A runner's local policy can drop all egress (`apps/runner/src/desk/policy.ts:118-126`).
- GitHub is not an LLM provider (`apps/server/src/connections/providers.ts:7-9`, `:24-28`), and a
  connection stores only an encrypted key, a label and a base URL
  (`apps/server/src/connections/service.ts:12-20`, insert at `:71-73`) — there is **no repo field
  anywhere** today.
- The git tool already refuses to trust a repo and forces HTTPS only:
  `GIT_ALLOW_PROTOCOL=https` (`packages/desk/src/tools/git.ts:50-58`, documented at
  `packages/desk/README.md:52-58`).
- The per-connection host log records `timestamp, deskId, host, allowed, reason, bytes` and
  **nothing else** — never a URL, path, header or body (`packages/desk/src/egress/log.ts:9-17`,
  written at `:46-57`).

---

## 2. Options for giving git a token without the jail holding it

All three keep the token out of the jail's env and `/proc`; they differ in where TLS terminates
and what the AI types.

### (a) MITM `github.com` only, with a jail-trusted CA

The proxy terminates TLS for `github.com`, presents a certificate signed by a CA the jail trusts,
reads the plaintext request, and adds `Authorization` on the scoped host+path before re-encrypting
upstream. This is the shape `desk-runner-plan.md:489-492` describes.

- **AI types:** `git clone https://github.com/<owner>/<repo>` — unchanged.
- **Security:** the token stays outside the jail; but the proxy must hold a CA whose key, if
  leaked, lets an attacker impersonate **any** host the jail trusts. TLS is re-originated for the
  path, so the jail has no end-to-end assurance for `github.com`.
- **Effort:** the highest. New CA material and rotation; the read-only jail image
  (`docker-args.ts:117`, `--read-only`) must trust the CA (image change or a mounted CA plus
  `GIT_SSL_CAINFO`); a TLS terminator in the proxy (a new dependency or `node:tls` cert plumbing);
  HTTP/2 and cert-pinning surprises; and the `git` tool's `https`-only rule still holds.
- **Fit:** closest to the written plan, weakest operationally.

### (b) A git credential helper in the jail that asks the proxy

The jail's git is configured with a credential helper that calls a proxy endpoint to fetch a
short-lived token, then uses it on `https://github.com` (through the existing CONNECT tunnel). The
helper could be a tiny script in the image or the `git` tool.

- **AI types:** `git clone https://github.com/<owner>/<repo>` — unchanged.
- **Security:** **the token passes through the jail** (the helper holds it for the length of the
  operation, and it is visible in the helper's memory and argv/env). This contradicts the design's
  "the jail never sees it" (`docs/design/agent-system.md:77`, `desk-runner-plan.md:479`). The
  helper must also reach the proxy endpoint, which means the proxy must serve a token route.
- **Effort:** medium — a helper in the image, a token route on the proxy, and the same
  server-mint path as (a)/(c).
- **Fit:** simplest on the git side, but the one option the design explicitly rules out.

### (c) A git-over-HTTP smart endpoint on the proxy

The proxy serves `http://desk-egress:3128/git/<owner>/<repo>`, accepts the git smart-HTTP verbs,
adds `Authorization: Basic base64("x-access-token:<token>")`, and forwards to `https://github.com`
**over TLS itself**. The jail speaks plain HTTP to the proxy; the token never leaves the host.

- **AI types:** `git clone http://desk-egress:3128/git/<owner>/<repo>` — **or** the same
  `https://github.com/...` URL, with the `git` tool rewriting the configured repo to the proxy
  endpoint locally (a `url.<proxy>.insteadOf` config the tool injects). With the tool doing the
  rewrite, the model is never aware of the endpoint.
- **Security:** best containment. No CA and no TLS interception (so nothing new to leak); the token
  lives only in the proxy's memory; the proxy already authenticates the desk and already owns the
  host log. Because the proxy terminates the push, it can also **inspect the pushed refs** and
  refuse anything outside `agent/<ai>/*` (§4). The jail's only transport change is reaching the
  proxy on plain HTTP, which it already does for redirects.
- **Effort:** medium — a new `packages/desk/src/egress/git.ts` (route match, TLS client to
  `github.com`, header injection, receive-pack ref check) wired into `proxy.ts` before the
  port/method checks, plus the token arriving from §3. No image CA change.
- **Caveats:** the proxy's plain-HTTP forward refuses `POST` today (`proxy.ts:120-124`) — the
  `/git/` endpoint is a separate branch, so this is a new path, not a behaviour change. The `git`
  tool allows only `https` (`tools/git.ts:52`); the rewrite makes git use the `http` transport for
  the proxy URL only, so `http` is added to `GIT_ALLOW_PROTOCOL` (bounded by the proxy). And it only
  covers git-over-HTTP (fine for GitHub; a plain `git://` remote stays refused, as today).

### Recommendation

**Adopt (c).** It is the only option that needs **no new trust material** (no CA, no TLS
termination), keeps the token entirely on the host, and puts the push-ref check exactly where the
push is seen. The cost is that git for the configured repo goes through a proxy endpoint; the
`git` tool hides that by rewriting the remote, so the AI's command and the tool result stay
natural. Keep (a) in reserve as a later "transparent" upgrade if the rewrite ever gets in the way;
reject (b) because it puts a token inside the jail, which is the one thing the design forbids
(`docs/design/agent-system.md:77`).

---

## 3. Minting the token, and reaching the proxy

### 3.1 Where it is minted

A new server module `apps/server/src/git/app-token.ts`:

1. Sign a GitHub App JWT with `jose` (`apps/server/package.json:32`) — RS256, `iss = GITHUB_APP_ID`,
   `iat` a few seconds in the past, `exp` at most 10 minutes (GitHub's cap).
2. `POST https://api.github.com/app/installations/<GITHUB_APP_INSTALLATION_ID>/access_tokens`
   (`server-schema.ts:42`) with `repositories: ["<owner>/<repo>"]` and
   `permissions: { contents: "write", pull_requests: "write" }`. GitHub returns a token valid for
   **one hour** (`docs/audit/desk-runner-plan.md:481-486`).
3. Cache the result **per repo** in memory until `expires_at` minus a safety margin (say 5 min), so
   a burst of turns does not mint per call. Never log the JWT, the token or the private key; the
   private key is already redacted (`apps/server/src/logger.ts:19-35`).

The module takes an injected `fetch` (and clock) so `apps/server/src/git/app-token.test.ts` runs
with no network, per `AGENTS.md` ("tests must not call real external services").

### 3.2 Which repo, and who sets it

The repo is **per AI**, set by that AI's owner — matching `DeskEgressPolicy.git` being per desk
(`packages/desk/src/hands.ts:54-64`) and the `docs/PROJECT_PLAN.md:1118` "each client picks repos"
intent. Nothing stores a repo today (§1.5), so add one nullable column, `ais.github_repo` (an
expand-only migration, `SET lock_timeout = '5s';`, `apps/server/drizzle/`), surfaced through the
existing AI update path (`apps/server/src/ais/api.ts:218`, `updateAi` at
`apps/server/src/ais/provisioning.ts:125`) and the AI settings UI (web + mobile, twin task).
Unset = no injection (public clone over the tunnel still works, §4).

### 3.3 How it reaches the proxy

The proxy already has a per-desk registration channel (`registry.ts:209-217`) and a per-turn
control channel to the sidecar (the `desk.provision` frame, sent fresh every turn —
`apps/server/src/agents/gateway/desk-exec.ts:91-105`). Use both, in the existing direction of
travel:

1. At the start of a turn, the server mints (or reuses) the token for the AI's `github_repo` and
   sets `spec.egress.git = { host: 'github.com', ownerRepo, token, expiresAt }`. This rides the
   **authenticated** server→runner tunnel (`runner-hands.ts:99-105`, `desk-frames.ts:64-74`) or the
   cloud sidecar socket (`apps/server/src/hands/cloud-hands.ts:13-19`) — never through the jail.
2. The sidecar registers the desk with the proxy, extending the register request with the `git`
   block + token (`agent/egress.ts:27-44`, `lifecycle.ts:204-214`).
3. The proxy holds `{ host, ownerRepo, token, expiresAt }` in its in-memory registry and injects it
   only on the matching `/git/<owner>/<repo>` path (§4).

**Refresh.** A token is one hour; a turn's wall clock is 30 minutes
(`desk-exec.ts:29`), so minting at turn start outlives the turn. Two code facts make this work:

- Provision runs once per turn and the frame is re-sent even for a live jail
  (`desk-exec.ts:91-105`).
- The sidecar's re-provision currently re-registers with the **stored** spec, not the incoming one
  (`lifecycle.ts:129-142`); that must change to re-register with the **incoming** spec (and update
  the record) so a rotated token lands. This is a required, small change.

Risk 9 of the approved plan ("the token can expire mid-task", `desk-runner-plan.md:733-734`) is
therefore bounded for v1: if a task ever ran past an hour, the proxy answers GitHub's 401 to git,
and the next turn's provision supplies a fresh token. A proxy-side re-mint on 401 (proxy → server)
is a later hardening task, not v1 (§6).

### 3.4 Scopes and lifetime

- Permissions: `contents: write`, `pull_requests: write` (`desk-runner-plan.md:483`).
- Repositories: exactly the one configured repo — GitHub enforces this, so the token cannot reach
  another repo even if the proxy were bypassed.
- Lifetime: GitHub's one hour; the server cache keeps a 5-minute margin.

---

## 4. Safety

- **The jail never holds the token.** With option (c) the token lives only in the proxy's memory
  (§2c). The jail keeps only its per-desk proxy secret, which it already has
  (`agent/egress.ts:16-21`), and `/proc`/env never see an `Authorization`. The `git` tool already
  runs with prompts off and no repo config (`tools/git.ts:50-67`).
- **Push only to `agent/<ai>/*`.** Two layers:
  - The token is repo-scoped and `contents: write` still allows `main`, so the **proxy** is the
    gate: on a `git-receive-pack` request it parses the leading pkt-line commands (the
    `old new ref\0caps` lines that precede the packfile) and refuses any ref not under
    `refs/heads/agent/<ai>/`. `<ai>` comes from the desk registration
    (`docs/PROJECT_PLAN.md:1118`, `desk-runner-plan.md:493-494`).
  - Optionally, a GitHub ruleset on the repo as defence in depth. Recommend the proxy check (it is
    the hard gate and needs no owner action) with the ruleset optional.
- **Logs never carry tokens.** The host log already records only ids/host/decision/bytes
  (`log.ts:9-17`). The new code must add **no** header or body to it; the injected `Authorization`
  is never logged, and the register request that carries the token is never logged. The private key
  stays redacted (`logger.ts:27`).
- **An `Authorization` from the jail is stripped.** `forwardHeaders` already drops
  `proxy-authorization`/`connection` (`proxy.ts:77-91`); the `/git/` endpoint must set its own
  `Authorization` **after** discarding any client-supplied one, so the jail can never override the
  injected token.
- **Tests for the auth/keys area (required, `AGENTS.md`).** `apps/server/src/git/app-token.test.ts`
  (JWT claims, single-repo scoping, permissions, cache/expiry; injected fetch, no network) and
  `packages/desk/src/egress/git.test.ts` (injection only on the configured host+path; a foreign host
  or repo gets none; a client `Authorization` is replaced; a push to `main` is refused; no token in
  the log line).

---

## 5. Task split

Ordered, one PR each; every file stays under 400 lines. Current sizes that matter: `proxy.ts` is
320 lines (keep the git logic in a new file), `registry.ts` is 218, `lifecycle.ts` is 323.

1. **Mint the GitHub App token (server).** Goal: an installation token for one repo, cached.
   Files: new `apps/server/src/git/app-token.ts`; wire its config check beside
   `apps/server/src/config/server-schema.ts:38-42`. **Tests:** `git/app-token.test.ts` (injected
   fetch). Est. **90 min.**
2. **Store the allowed repo (server + web + mobile).** Goal: the owner sets one repo per AI. Files:
   a new `apps/server/drizzle/` migration (expand-only, `SET lock_timeout = '5s';`),
   `apps/server/src/db/rows.ts` (`AiRow`), `apps/server/src/ais/provisioning.ts:125` +
   `apps/server/src/ais/api.ts:218`, `packages/api-contract/src/ais.ts`, the web AI settings panel
   and the mobile twin. **Tests:** the AI update route scoping + the 401 sweep; no UI tests.
   Est. **120 min.**
3. **Carry the scope + token on the wire.** Goal: `spec.egress.git` (with `token`/`expiresAt`) set
   by the turn and re-registered. Files: `packages/desk/src/hands.ts:54-64`,
   `packages/runner-tunnel/src/desk-frames.ts:64-74`, `apps/server/src/hands/runner-hands.ts:99-105`,
   `apps/runner/src/desk/handler.ts:179-190`, `packages/desk/src/egress/registry.ts:12-18,61-74`,
   `packages/desk/src/agent/egress.ts:27-44`, `packages/desk/src/agent/lifecycle.ts:129-142,204-214`
   (re-register with the incoming spec), `apps/server/src/agents/gateway/desk-exec.ts:91-105`.
   **Tests:** `registry.test.ts`, `agent/egress.test.ts`, `runner-hands.test.ts`. Est. **120 min.**
4. **The proxy git endpoint, injection and push check.** Goal: serve `/git/<owner>/<repo>`, inject
   the token, refuse non-`agent/<ai>/*` pushes. Files: new `packages/desk/src/egress/git.ts`;
   `packages/desk/src/egress/proxy.ts` (a branch before `:120-136`), `registry.ts` (hold the `git`
   block). **Tests:** `egress/git.test.ts` + `egress/proxy.test.ts`. Est. **150 min.**
5. **The jail's `git` command.** Goal: the tool rewrites the configured `https://github.com/<owner>/<repo>`
   to the proxy endpoint (`insteadOf`), allows `http` for that URL, and leaves everything else
   `https`-only. Files: `packages/desk/src/tools/git.ts:42-73`, the daemon env that carries the repo,
   `packages/desk/README.md:52-58`. **Tests:** `packages/desk/src/git.test.ts`. Est. **90 min.**
6. **Mid-task re-mint (later, optional).** Goal: on a GitHub 401 the proxy re-mints (proxy → the
   host sidecar → server) instead of failing the push. Files: `egress/git.ts`, a small reply path in
   `agent/` and one server route. Defer until a task can exceed one hour (§3.3). Est. **90 min.**

Dependencies: 1 → 3 → 4; 2 → 3; 4 → 5; 4 → 6.

---

## 6. Open questions for Julio

1. **Which repo may an AI use, and who sets it?** **Recommended:** one repo **per AI**, set by that
   AI's owner in the AI settings (a new `ais.github_repo`, task 2). It matches the per-desk
   `egress.git` shape and `PROJECT_PLAN.md:1118`. Alternative: one account-wide repo, simpler but
   coarser.
2. **Confirm option (c): git for the configured repo goes through the proxy endpoint.** The AI (or
   the `git` tool's rewrite) uses `http://desk-egress:3128/git/<owner>/<repo>`; no CA and no TLS
   interception. **Recommended:** yes for v1; keep (a) as a later transparent upgrade. **Reject
   (b)** (a token inside the jail).
3. **The GitHub App is one global installation today.** `GITHUB_APP_INSTALLATION_ID`
   (`server-schema.ts:42`) is a single value, so minting works for one install (yours). Multi-owner
   needs a per-owner installation lookup. **Recommended:** ship v1 on the single install and record
   the limitation as a follow-up.
4. **Branch rule: proxy check or a GitHub ruleset?** **Recommended:** the proxy parses the
   receive-pack refs and refuses anything outside `agent/<ai>/*` (the hard gate, no owner action),
   with a repo ruleset as an optional second layer.
5. **Public clones when no repo is set.** Anonymous `git clone https://github.com/...` over the
   CONNECT tunnel works today (§1.4). **Recommended:** leave it working when no repo is configured;
   inject only for the configured private repo.
6. **Refresh on a 401 mid-task.** **Recommended:** rely on the per-turn re-mint for v1 (a 30-minute
   turn fits inside the one-hour token, `desk-exec.ts:29`), and schedule task 6 only if tasks ever
   run longer. Confirm that a one-hour token is acceptable.
