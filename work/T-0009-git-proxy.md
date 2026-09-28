---
id: T-0009
title: Spike S8 — a GitHub App token and a git proxy that only allows `agent/<ai>/*` pushes
status: review
milestone: M3
branch: task/T-0009-git-proxy
model: opencode-go/deepseek-v4-pro
depends_on: [T-0001]
estimate: 1 day
---

# T-0009: Spike S8 — GitHub App tokens and a branch-restricted git proxy

## Spec (written by Claude, do not edit)

### Goal
§1103–1109 of the plan: one GitHub App for the platform, a **git proxy that
injects the token**, and the rule that an AI may push **only** to
`agent/<ai>/*`. §1561: "Clone, push to `agent/<ai>/*` only, open PRs".

The security value of this whole design is that the AI's own credentials never
exist — the proxy holds them and injects them per request, and refuses anything
outside the allowed branch space. This spike proves the two halves separately:
the token lifecycle, and the branch restriction. **The branch restriction is the
interesting half; spend the effort there.**

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §1103–1109 and the "Keeping credentials out of the
  agent's reach" row (§153)
- `apps/server/src/**` for the Hono route style, zod validation, the error shape
  (`HttpError`) and the logger pattern. **This is where the proxy lives.**
- `apps/server/src/test-support.ts`
- GitHub docs, with versions: **GitHub App installation access tokens**
  (`POST /app/installations/{id}/access_tokens`, default 1 hour, max 24 h),
  the fine-grained permissions needed for `contents: write` and `pull_requests:
  write`, and **Octokit** if you use it
- How a git HTTP proxy is expected to work: the client speaks HTTP git to us, we
  forward to GitHub, and we inject `Authorization` on the way out

### Allowed files
- `apps/server/src/git/**` (new module)
- `apps/server/src/config.ts` — **only** to add new env entries
- `pnpm-lock.yaml`
- `work/T-0009-git-proxy.md`

**Not allowed:** `apps/web/**`, `apps/mobile/**`, `packages/**`, `infra/**`,
`docs/**`. If you need a change there, describe it in the Report and stop.

> Other workers have edited `pnpm-lock.yaml`. Do not resolve a lockfile conflict.

### Allowed dependencies
- `@octokit/rest` or `@octokit/auth-app` **only if** you can justify it in the
  Report; plain `fetch` is acceptable and preferred if it keeps the tests simple.
- Nothing else.

### What to build
1. **Token lifecycle.** A client that mints an installation access token, caches
   it until shortly before expiry, and re-mints when it is stale. Validate every
   response with `zod`. Tests with a fake `fetch`:
   - a cached token is reused rather than re-minted;
   - a token inside the refresh window is re-minted;
   - a failure to mint produces a clear error and **never leaks the App private
     key or the installation id into the message or the log**.
2. **The branch restriction — the heart of this task.** A pure function that
   decides whether a push is allowed, with tests that must include:
   - `agent/<ai>/feature` → **allowed**;
   - `main`, `master`, `release/*`, `agent/<other-ai>/x`, `agent/`, `agent/x`
     (no slash), a ref like `refs/heads/agent/x/y`, and a branch containing
     `..` or a leading `/` → **rejected**;
   - a **path-traversal style** input (`agent/../../etc/passwd`, `agent/a/../../b`)
     → rejected, and rejected **before** any value is used to build a path or a
     remote URL;
   - case handling is deliberate and documented.
   Make this function total and side-effect free so it can be reused by the
   proxy and by any future tool call.
3. **The proxy.** A route or handler that forwards an HTTP git request to
   GitHub, injecting the token outbound, and **refusing** a receive-pack (push)
   whose ref the function rejects. It must:
   - allow the branch check to run **before** anything is forwarded, so a
     rejected push never reaches GitHub;
   - never accept a token, a remote URL or a credential **from** the client;
   - strip any inbound `Authorization` header so a caller cannot smuggle one.
4. **Tests** for the proxy with a fake `fetch`: a push to an allowed branch is
   forwarded with an injected token; a push to `main` is refused **and the
   upstream is never called**; a `git-upload-pack` (clone/fetch) is allowed.

### Integration check
**No real GitHub account or App is available to you, and you must not create
one.** This is a pure spike: prove the logic and the wiring with fakes, and say
in the Report exactly which parts remain unproven without a real App. That is an
honest result, not a failure. Do not ask for credentials.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test`, `build` pass.
- [ ] Every test named above exists and passes.
- [ ] The Report states plainly what is proven and what still needs a real App.
- [ ] No credential, token or App id appears in the Report, the commits or any
      log line.
- [ ] Only allowed files touched.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Out of scope
- The runner, the tunnel and desks (T-0008).
- Opening pull requests for real.
- Any change to `infra/**`, the web or the mobile app.

---

## Report (written by the worker when done)

### What I did
- Built a new `apps/server/src/git/` module with the three pieces the spec asks for:
  - `branches.ts` — a pure, total, side-effect-free `isPushAllowed(aiName, branch)` that allows only `agent/<ai>/*`. It rejects path-traversal (`..`, a leading `/`, empty or `.` segments) *before* the value is used anywhere, rejects full refs (`refs/…`), and rejects reserved/other-AI branches. Comparison is case-sensitive and documented.
  - `token.ts` — `createGitHubAppTokenClient` that signs an RS256 App JWT (`jose`, already a dependency) and POSTs to `POST /app/installations/{id}/access_tokens`, caches the token, re-mints inside a 5-minute refresh window, and validates the response with zod. Every mint failure is a `GitTokenError` whose message never carries the App private key or the installation id. Also added `createGitHubAppTokenClientFromConfig`.
  - `proxy.ts` + `routes.ts` — a git smart-HTTP forward proxy. It detects a receive-pack push, parses the refs out of the pkt-line body, runs the branch check *before* forwarding, strips inbound `Authorization` (plus the other hop-by-hop headers), and injects the token. It never reads a token, remote URL or credential from the client.
- Added optional GitHub App env entries to `config.ts` (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`) with all-or-nothing validation.
- Wrote 19 tests (7 branch + 7 token + 5 proxy) using fake `fetch` only; no real GitHub calls and no real credentials.

### The verdict
**Can we hold a GitHub credential the AI can never see, and restrict it to `agent/<ai>/*`?** Yes with caveats
- The two halves are proven separately with fakes: the credential lives only in the server (the AI never sees it), and the branch rule is total and fails closed. What is *not* proven is anything against a real GitHub App or a real `git` client, because no account/App is available (and none was created).

### What is proven, and what is not
Proven (with fakes):
- A cached token is reused; a token inside the refresh window is re-minted; a mint failure produces a clear error that never leaks the private key or the installation id.
- The branch rule rejects the full enumerated list (`main`, `master`, `release/*`, `agent/<other-ai>/x`, `agent/`, `agent/x`, `refs/heads/agent/x/y`, `..`, leading `/`) and rejects `agent/../../etc/passwd` / `agent/a/../../b` before any path or URL is built.
- The proxy forwards an allowed push with the injected token, refuses `main` / other-AI / tag pushes *without calling upstream*, and allows `git-upload-pack` (clone/fetch).

Not proven / still needs a real App or git client:
- That GitHub accepts the App JWT and mints the installation token (the endpoint, expiry and error shapes are only faked).
- The pkt-line/ref parsing against a real `git` client (tests use synthetic receive-pack bodies).
- Streaming and fail-closed parsing: the proxy buffers the whole receive-pack body, and an empty/unparseable ref list is currently forwarded rather than rejected.

### Files changed
- `apps/server/src/git/branches.ts` (new)
- `apps/server/src/git/branches.test.ts` (new)
- `apps/server/src/git/token.ts` (new)
- `apps/server/src/git/token.test.ts` (new)
- `apps/server/src/git/proxy.ts` (new)
- `apps/server/src/git/proxy.test.ts` (new)
- `apps/server/src/git/routes.ts` (new)
- `apps/server/src/config.ts` (env entries only)
- `work/T-0009-git-proxy.md`

### Commands run and real results
- `pnpm install`: "Done in 10.6s using pnpm v10.32.1", exit 0.
- `pnpm format:check`: first run flagged the 5 new source/test files; after `pnpm exec prettier --write apps/server/src/git apps/server/src/config.ts` it reports "All matched files use Prettier code style!", exit 0.
- `pnpm lint`: "Found 0 warnings and 0 errors.", exit 0.
- `pnpm typecheck`: "Tasks: 8 successful, 8 total", exit 0.
- `pnpm test`: "Tasks: 8 successful, 8 total"; the server suite alone: "23 passed | 2 skipped (25), Tests 205 passed | 3 skipped (208)"; the git module alone: "3 passed (3), Tests 19 passed (19)".
- `pnpm build`: "Tasks: 2 successful, 2 total", exit 0.

### Problems, deviations from the spec, open questions
- The proxy is **not** mounted in `app.ts` because `apps/server/src/app.ts` is not in the Allowed files. Wiring it needs a decision on the AI-name binding and the route prefix; the module exposes `createGitRoutes` and `createGitHubAppTokenClientFromConfig` ready for that wiring.
- `GITHUB_APP_PRIVATE_KEY` is not in the logger's `redactPaths` (`apps/server/src/logger.ts` is out of scope). My code never logs it, but the future wiring should add it to the redaction list.
- Dependency choice: plain `fetch` plus the already-present `jose` (no Octokit). Justification: keeps the tests simple and adds no dependency.
- The proxy buffers the whole receive-pack body to parse refs rather than streaming the pack; a production proxy should stream the pack section and fail closed when refs cannot be parsed.

### Blocked / needs a decision
- (none)

### Round 2 (review finding 1 fixed)
- `parseRefUpdates` now returns `{ refs, malformed }` and reports a body as malformed when a pkt-line length is invalid, a command line is not exactly `<old-oid> <new-oid> <ref>`, the length runs past the body, or the body ends without a flush packet.
- The handler now refuses a receive-pack whose parsed ref list is empty or malformed with `403 push_rejected` ("push is unparseable") before anything is forwarded, with a comment explaining why an unreadable push is refused rather than forwarded.
- Added three tests: an unreadable body is refused and the upstream is never called; a body that yields no refs is refused; a body with one good and one malformed ref is refused. All assert `calls` is empty.

#### Commands run and real results (Round 2)
- `pnpm format:check`: "All matched files use Prettier code style!", exit 0.
- `pnpm lint`: "Found 0 warnings and 0 errors.", exit 0.
- `pnpm typecheck`: "Tasks: 8 successful, 8 total", exit 0.
- `pnpm test`: "Tasks: 8 successful, 8 total"; server suite "208 passed | 3 skipped (211)"; git module alone "22 passed (22)".
- `pnpm build`: "Tasks: 2 successful, 2 total", exit 0.

---

## Review (written by Claude)

**Verdict:** Round 2: changes requested. The branch rule and the credential
handling are right, and you were honest enough to write down the problem I am
going to ask you to fix — which is the best possible outcome here.

### What the lead verified
- **Checks.** Uncached run: `format:check`, `typecheck` PASS; `test` fails only
  on `apps/web` `MessageActions.test.tsx > opens on right-click and closes with
  Escape` at 5178 ms — the known load-sensitive test already on the board, in a
  package this task never touches. The `git` module's own suite is
  **19 passed / 3 files**, run directly. `build` PASS, `lint` exit 0. Not a
  finding against this task.
- **The branch rule is total and fails closed on the enumerated cases.** I read
  `branches.ts`: `main`, `master`, `release/*`, `agent/<other-ai>/x`, `agent/`,
  `agent/x`, `agent/alice/` and `refs/heads/agent/alice/feature` are all
  rejected, and `agent/../../etc/passwd` and `agent/a/../../b` are rejected on
  the `..` / leading-`/` check **before** the value is used for a path or a URL.
  That is the right order and the comment says so.
- **The credential never comes from the client.** `authorization` and
  `proxy-authorization` are in the stripped-header list, and the proxy sets its
  own `Bearer` outbound. A caller cannot smuggle a credential in.
- **A rejected push never reaches GitHub.** The test asserts
  `expect(calls).toHaveLength(0)` after a push to `main` returns 403. That is
  the test that matters most, and it exists.

### Finding
1. **The proxy fails OPEN on a push it cannot parse** (`apps/server/src/git/proxy.ts`).
   The guard is:
   ```ts
   const refs = parseRefUpdates(new Uint8Array(buffer));
   for (const ref of refs) {
     if (!isAllowedRef(aiName, ref)) {
       throw new HttpError(403, 'push_rejected', ...);
     }
   }
   body = buffer;   // ← forwarded
   ```
   If `parseRefUpdates` returns **zero** refs — a malformed pkt-line, a length
   prefix the decoder dislikes, a body our parser walks past — the `for` loop
   never executes, nothing is rejected, and the request is forwarded to GitHub
   **with a valid installation token**.

   That is a bypass of the entire control this task exists to prove. The AI
   controls the request body. If it can produce a body our parser cannot read
   but GitHub's can, it pushes to `main` and the branch rule never fires. The
   Spec said the rule must fail closed; this path fails open.

   You flagged this in the Report, which is why I am asking for a fix rather
   than writing it up as a discovery. Do not leave it as a caveat — a caveat in
   a Report is not a control.

   - When the service is `receive-pack` and the parsed ref list is **empty**,
     reject with `403 push_rejected` and a reason like `unparseable`. A push we
     cannot enumerate is not a push we can allow.
   - Also reject when the body yields a ref that is present but **malformed**;
     the same reasoning applies.
   - Tests: a `receive-pack` body with no readable refs is refused **and the
     upstream is never called** (assert `calls` is empty, like the `main` test);
     a body with one good and one malformed ref is refused too.
   - One line of comment saying why an unreadable push is refused rather than
     forwarded, so nobody "optimises" it back later.

2. *(No change needed.)* The Report's "proven vs not proven" section is exactly
   right, and "no account/App is available and none was created" is the correct
   outcome for a spike. Buffering the whole receive-pack body is a real
   limitation worth stating; it is not a defect at this stage.

### Follow-ups
- The real-App wiring (create the App, confirm the JWT → installation token
  exchange, and run a real `git` client through the proxy) needs Julio's GitHub
  account, so it cannot be done by a worker. It is a small task once he is
  awake and I have put it on the board.
