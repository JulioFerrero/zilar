---
id: T-0009
title: Spike S8 — a GitHub App token and a git proxy that only allows `agent/<ai>/*` pushes
status: todo
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
-

### The verdict
**Can we hold a GitHub credential the AI can never see, and restrict it to `agent/<ai>/*`?** Yes / No / Yes with caveats
-

### What is proven, and what is not
-

### Files changed
-

### Commands run and real results
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test`:

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
