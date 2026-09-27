---
id: T-0004
title: Spike S2 — can @xmpp/client (xmpp.js) connect and stay connected from Expo on iOS?
status: todo
milestone: M1
branch: task/T-0004-expo-xmpp-spike
model: opencode-go/deepseek-v4-pro
depends_on: [T-0003, T-0016]
estimate: 1 day
---

# T-0004: Spike S2 — xmpp.js in Expo

## Spec (written by Claude, do not edit)

### Goal
The mobile app is still on mock data, and the blocker is that `@galena/xmpp-core`
is built on `@xmpp/client` (xmpp.js), a **Node** library, while `apps/mobile` is
**Expo / React Native**. This task answers, empirically, whether that stack can
connect from a real iOS build, so the next task can put the mobile app on real
data the same way T-0024 did for the web.

**This is a spike.** The deliverable is a *working connection* plus a written
verdict, not production code. The next task will do the real integration, so
optimise for a clear answer, not for polish.

### Read first
- `AGENTS.md` (mandatory)
- `packages/xmpp-core/src/client.ts` — how the core connects: `service`, `domain`,
  SASL PLAIN with a short-lived JWT password, the status state machine, the
  `createLibraryClient` factory and `CoreDependencies.createClient` (the seam a
  spike can reuse)
- `apps/server/src/xmpp/routes.ts` — `POST /api/xmpp/token` returns
  `{ jid, token, expiresAt, service, domain, mucDomain }`
- `apps/server/src/xmpp/config.ts` — `XMPP_WS_PUBLIC_URL` defaults to
  `ws://127.0.0.1:5280/ws`
- `infra/ejabberd/ejabberd.yml` — the WebSocket listener on port 5280, path `/ws`
- `apps/mobile/metro.config.js`, `apps/mobile/package.json`, `apps/mobile/app.json`
- `work/T-0024-web-real-data.md` — the web equivalent, for the auth flow
- External docs to check, with versions:
  - **xmpp.js** (the `@xmpp/*` packages, currently 0.14.x) — which entry points
    are browser-safe, and what `xmpp.js` uses from `node:stream` / `Buffer` /
    `TextEncoder`
  - **Metro** (Expo SDK 57) — `resolverMainFields` defaults to
    `['react-native', 'browser', 'main']`; confirm what that means for a package
    that ships a `browser` field
  - **Expo** (SDK 57) — `expo run:ios` dev-client workflow, and `AppState` for
    background/foreground

### Allowed files
- `apps/mobile/**` (a throwaway spike under `apps/mobile/src/spike/`, plus
  `package.json`, `metro.config.js` and `app.json` **only** if the spike needs it)
- `pnpm-lock.yaml`
- `work/T-0004-expo-xmpp-spike.md`

**Not allowed:** `packages/**`, `apps/server/**`, `apps/web/**`, any other
`work/T-*.md`. If `@galena/xmpp-core` itself needs a change to work on native,
**do not make it** — describe the exact change in the Report and stop.

### Allowed dependencies
- `@xmpp/client` (and its `@xmpp/*` siblings) — install with
  `npx expo install @xmpp/client`
- Polyfills **only if** you hit the problem they solve, and only after proving the
  problem: `buffer`, `text-encoding`, `events`, `stream-browserify`, `process`
- Nothing else. Every added dependency needs a line in the Report saying what it
  fixes.

### What to build
1. **A spike screen that connects.** `apps/mobile/src/spike/` — a minimal screen
   (it does not have to look like Telegram; this is a diagnostic tool) with a
   "Connect" button that:
   - calls `POST /api/xmpp/token` on the running server,
   - connects to the returned `service` with `@xmpp/client`, SASL PLAIN using
     `jid` and `token` as the password,
   - prints the connection status and the client's JID, and
   - sends one message to a JID you type in, and shows the replies.
   Log everything to the Metro console *and* to a visible list on screen, so a
   failure is diagnosable from a screenshot.
2. **Polyfills, if needed.** Expect at least a possible `Buffer` / `TextEncoder`
   problem. Wire them in the smallest way that works and record **exactly** what
   was needed. If everything works with no shims, say so — that is a valid and
   valuable result.
3. **Reconnect.** Kill the network on the simulator (or stop/start Metro's
   tunnel) and confirm the client reconnects, and that the JWT refresh path works
   (the token expires after 300 s, so a connection older than that must fetch a
   new one).
4. **Background / foreground.** Use `AppState`: background the app for a minute,
   come back, and report what happened to the socket. State plainly whether the
   client must reconnect on foreground, and how long a message takes to arrive.
5. **A verdict.** The Report must end with a clear answer to: *can the mobile app
   use `@galena/xmpp-core` on iOS, and what does the next task have to do?*

### Integration check (you run it against the running stack)
The dev stack is **already running** and Julio is using it: the server is on
`127.0.0.1:3188`, ejabberd's WebSocket is on `ws://127.0.0.1:5280/ws`.

- Build and run: `npx expo run:ios --no-bundler`, with Metro started separately
  (`npx expo start`) in the background.
- **You must stop Metro and any process you started when you finish.**
- Never run `pnpm infra:up`, `infra:down` or `infra:reset`. Never stop, restart
  or reset anything you did not start. If a simulator is busy, say so in the
  Report and stop rather than taking it over.
- Put screenshots in `apps/mobile/screenshots/` (they are committed) and describe
  what each one shows.

### Acceptance criteria
- [ ] The Report has a yes/no verdict with evidence, and the exact polyfill list
      (possibly "none").
- [ ] `pnpm typecheck`, `lint` and `test` pass.
- [ ] A committed screenshot shows a **successful** connection. A screenshot of
      an error is not acceptable evidence — keep fixing it, or report a genuine
      blocker.
- [ ] Only allowed files touched; no new dependency that is not justified.
- [ ] The spike code is isolated under `src/spike/` so the next task can delete it
      in one command.
- [ ] You stopped every process you started.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm build` is not required for a spike (it exports the app, which is slow and
not what you are testing), but `pnpm --filter @galena/mobile typecheck` and
`pnpm --filter @galena/mobile test` must pass.

### Out of scope
- Wiring the app to real data. That is the next task.
- Android.
- Push notifications (T-0005).
- Changes to `packages/xmpp-core` — describe them, do not make them.
- Making the spike screen pretty.

---

## Report (written by the worker when done)

### What I did
-

### The verdict
**Can `@galena/xmpp-core` run in Expo on iOS?** Yes / No / Yes with caveats
-

### Polyfills and dependencies actually needed
-

### Files changed
-

### Commands run and real results
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test`:

### Reconnect and background results
-

### Problems, deviations from the spec, open questions
-

### What the next task (mobile on real data) has to do
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
