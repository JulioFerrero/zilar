---
id: T-1620
title: "Desk agent: a jail that exists but this agent process never provisioned (left from a crash) is removed and recreated on provision, so it never keeps a stale egress proxy secret or proxy IP"
status: merged
milestone: M5
branch: task/T-1620-recreate-unknown-jails
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1620: Recreate a jail this agent didn't make

## Spec (written by Claude, do not edit)

### Why
The T-1612 worker found this (Report, step 6), and the lead confirmed it on 2026-10-16:
- `provisionNew` registers egress on every provision, which returns a proxy URL with a per-process secret, but it creates the jail **only when it doesn't exist**.
- **What goes wrong after a restart:** after an agent restart, the in-memory secret map is empty, so a new secret is registered. A jail that survived (an agent crash skips `stopAll`) still carries the old secret in its `HTTPS_PROXY`, so the proxy rejects it, and that AI's computer silently has no web. Its `/etc/hosts` proxy IP (T-1612) can be stale too.
- **Normal shutdown is fine:** idle jails are removed (`lifecycle.ts:268-280`), and `stopAll` removes every jail on a normal shutdown.

### Facts (the lead read them on 2026-10-16, main after T-1615)
- **`packages/desk/src/agent/lifecycle.ts`** (307 lines):
  - `records` (`:54`) holds only what this process provisioned;
  - `provision` checks `records` at `:129`, then dedupes in-flight calls (`:136-144`);
  - `provisionNew` (`:147-180`) calls `registerEgress` (`:155`), then `if (!(await this.deps.docker.inspect(name))) { ensure; create; start }` (`:157-161`), then `records.set` (`:162`); on error it unregisters, removes and releases.
- **`packages/desk/src/agent/egress.ts:28-40`:** `createEgressRegistrar` keeps one secret per desk in a `Map` that lives as long as the process.
- **The lifecycle tests:** `packages/desk/src/agent/lifecycle.test.ts`.

### Steps
1. **In `provisionNew`,** when `docker.inspect(name)` is true, the jail is from an earlier agent process: `records` has no entry for it, since `provision` returned early for known ones.
   - Remove it first (`docker.remove(name)`), and log one line: `desk <name>: removed a jail left from an earlier agent run`.
   - Then go on to `ensure`, `create` and `start` as for a new jail.
   - The workspace survives: it's the image and folder, not the container.
2. **Test** in `lifecycle.test.ts`: a fake docker whose `inspect` reports the jail exists, with no record. `provision` calls `remove`, then `create` with the **new** proxy URL, then `start`.
3. **Change nothing else.**

### Allowed files
- `packages/desk/src/agent/lifecycle.ts`
- `packages/desk/src/agent/lifecycle.test.ts`
- `work/T-1620-recreate-unknown-jails.md`

### Checks
```bash
pnpm --filter @zilar/desk exec vitest run src/agent/lifecycle.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **After an agent restart, the first provision of an existing jail recreates it** with the current proxy URL.
- **`lifecycle.ts` stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did
- `packages/desk/src/agent/lifecycle.ts`: in `provisionNew`, when `docker.inspect(name)`
  reports the jail already exists, it is a leftover from an earlier agent process
  (`provision` returns early for known keys, so `records` has no entry). It is now
  removed first with one log line, then `ensure`/`create`/`start` run as for a new
  jail, so the recreate carries the current proxy secret and proxy IP.
- `packages/desk/src/agent/lifecycle.test.ts`: added one test that models an agent
  restart — a first `Lifecycle` provisions the jail with secret `old-secret`, then a
  second `Lifecycle` (fresh records + fresh egress secret) provisions the same key,
  and it must `remove`, then `create` with `new-secret`, then `start`, logging the
  remove line.
- Nothing else changed.

### Checks run
- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/lifecycle.test.ts`
  → 1 file passed, 14 tests passed.
- `pnpm gate` (from repo root) → GATE PASS. Summary lines:
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`, `PASS  effect`, `PASS  tests @zilar/desk`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
- Changed files: `packages/desk/src/agent/lifecycle.ts`, `packages/desk/src/agent/lifecycle.test.ts`, `work/T-1620-recreate-unknown-jails.md`.

### Notes for the lead
- `lifecycle.ts` is 313 lines, within the 400-line limit.
- The test uses a fake `EgressRegistrar` (two secrets) rather than the real proxy,
  so no external service is called.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 1 nit.
- **The change:** a jail that `inspect` finds but `records` doesn't know is now removed (with one log line), then ensured, created and started with the current proxy URL. The workspace survives.
- **The test** covers the two-secret case. `lifecycle.ts` is 313 lines.
