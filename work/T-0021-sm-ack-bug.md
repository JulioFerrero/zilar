---
id: T-0021
title: Fix random disconnects — XEP-0198 stream-management ack miscount (xmpp.js over WebSocket)
status: todo
milestone: M1
branch: task/T-0021-sm-ack-bug
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0016]
estimate: 1 day
---

# T-0021: Stream-management ack bug

## Spec (written by Claude, do not edit)

### Goal
During the T-0016 review, ejabberd sometimes closed a client session right after login with:

```
Closing c2s session for <jid>: Stream closed by local host: Client acknowledged more stanzas than sent by server (undefined-condition)
```

That means our client (`@xmpp/client`, used inside `@galena/xmpp-core` over **WebSocket**) sent a stream-management (XEP-0198) `<a h='N'/>` with an `h` **larger** than the number of stanzas ejabberd actually sent. In the apps this would look like **random disconnects**. There's a known discussion upstream: xmpp.js discussion #1009, "Stream-management ack for websocket connection in react native".

**Find the root cause and fix it** so sessions stay up, **without** losing what stream management gives us (or, if disabling SM is the only safe choice, prove it and explain the trade-off; see Decisions).

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0016-xmpp-core.md`: the whole file, especially the round 2 Review
- `packages/xmpp-core/src/client.ts` and the ambient types in `src/types/xmpp.d.ts`
- The installed `@xmpp/client` and `@xmpp/stream-management` source under `node_modules` (read it: how the inbound counter is incremented, what counts as a stanza, and how `<open/>`, `<close/>`, stream features, `<enabled/>`, `<r/>` and `<a/>` are handled over the WebSocket framing)
- XEP-0198 §4: only `message`, `presence` and `iq` stanzas count. Nonzas (`<enabled/>`, `<r/>`, `<a/>`, stream features, SASL elements) must not be counted.
- xmpp.js discussion #1009 and any related upstream issues or PRs (use web fetch)

### Allowed files
- `packages/xmpp-core/**`
- `pnpm-lock.yaml`, only if you pin or patch a dependency version
- If a dependency patch is truly needed: `patches/**` and the `pnpm.patchedDependencies` entry. **Ask first** in the Report (`status: blocked`) before touching root files.

**Docker:** you may use the dev stack (`pnpm infra:up` / `infra:down`, no reset). You're the only worker using it now.

### Decisions
- **Preferred fix (in `@galena/xmpp-core`):**
  - Work around the miscount without patching `node_modules`, for example by correcting the counter, by wrapping or overriding the SM ack handler through the public `streamManagement` object, or by configuring it.
  - Keep stream management **enabled** if that can be done correctly.
- **If** the only reliable fix is disabling stream management:
  - That's acceptable, because we recover with reconnect plus MAM history.
  - Document exactly why, and make sure a reconnect still refetches missed messages (MAM `after` the last seen id, or the latest page).
  - Report this clearly as a decision for Claude to review.
- **Never** silence the error by catching and ignoring the disconnect.

### What to build
1. **A reproduction first.** An integration test (gated by `GALENA_XMPP_INTEGRATION=1`, like T-0016's) that keeps two clients connected for **at least 60 s** while exchanging **≥ 200 stanzas**: messages, presence, iq pings, and forcing `<r/>` requests if possible. It asserts:
   - no unexpected `disconnect` / `offline`
   - the status stays `online`
   - after the run, ejabberd's log for that window has **no** "Client acknowledged more stanzas" line (read it with `docker compose … logs --since`)

   Run it **before** your fix and confirm it fails or reproduces. Paste the evidence.
2. **The root cause:** explain in the Report exactly which inbound elements are counted wrongly, with a code reference into the installed xmpp.js version.
3. **The fix,** plus unit tests: a fake inbound sequence of stanzas and nonzas gives the right `h`.
4. Rerun the reproduction **3 times** after the fix. All pass. Paste the output.

### Acceptance criteria
- [ ] Before and after evidence in the Report: the failing reproduction, then 3 passing runs.
- [ ] The root cause is explained with code references.
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` pass (integration skipped by default).
- [ ] Only allowed files touched.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm infra:up && GALENA_XMPP_INTEGRATION=1 pnpm --filter @galena/xmpp-core test; pnpm infra:down
```

### Out of scope
- Any other xmpp-core feature. The server. The apps.

---

## Report (written by the worker when done)

### What I did
-

### Root cause
-

### Files changed
-

### Commands run and real results (before / after)
-

### Problems, deviations from the spec, open questions
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-
