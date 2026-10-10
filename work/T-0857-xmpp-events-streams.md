---
id: T-0857
title: "xmpp-core: delete the unused events.* Streams (10 unbounded PubSubs per connection) — Julio approved"
status: merged
milestone: M5
branch: task/T-0857-xmpp-events-streams
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0857: xmpp-core: delete the unused events.* Streams (10 unbounded PubSubs per connection) — Julio approved

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Julio approved this on 2026-10-09 (D-5). Finding I-F3 in `docs/audit/simplify-2026-10-09/I-packages.md`.
- **The Streams:** xmpp-core exposes `events.*` Streams backed by 10 unbounded PubSubs per core. `emit` publishes to them even with no subscriber.
- **The consumers:** none outside xmpp-core's own tests. The stores and the gateway use the synchronous `on()` callbacks (`packages/xmpp-core/src/events.ts`, about lines 70-75), which must stay.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Confirm with grep across apps/ and packages/ that nothing outside xmpp-core reads `.events` or its Streams. Then remove the Streams, their PubSubs and the publish path.
2. Keep `on()` exactly as it is: synchronous, with the same order.
3. Remove the tests that only test the Streams. Keep every `on()` test, and update the xmpp-core README or docs if they mention the Streams.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`packages/xmpp-core/src/**`, `packages/xmpp-core/README.md`, `docs/**`, `work/T-0857-xmpp-events-streams.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/xmpp-core exec vitest run --reporter=dot
pnpm --filter @zilar/xmpp-core typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: Part of Julio's messaging and reconnect check. The lead also runs the xmpp ejabberd integration tests before merge.

---

## Report (written by the worker when done)

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **What changed:** the unused `events.*` Streams and their 10 PubSubs per connection are gone (−57 lines). `on()` is unchanged.
- **Lead check:** I ran the 4 xmpp-core integration tests on this branch against local ejabberd (`ZILAR_XMPP_INTEGRATION=1`, with `infra/.env` linked for the run and removed afterwards), and all 4 passed: messaging and reconnect, edits, invites and roster, and stream management.
- **Checks:** the combined check is clean.

- Grep over apps/ and packages/: nothing outside xmpp-core read `.events` or its Streams (only core-effect.test.ts did). Audit facts held.
- Removed: `EventStreams` type and export, `streams` on the hub, 10 PubSubs, `Stream.fromPubSub` wiring, the `publishUnsafe` call, `XmppCoreEffect.events`. `on()` and `emit()` unchanged (synchronous, same order).
- Tests: the two Stream tests became `on()`-only tests (same scenarios), so the count stays 245 passed | 4 skipped before and after, 3 of 3 runs.
- Lines: 9 added, 57 removed across 5 files (events.ts, types.ts, core-effect.ts, core-effect.test.ts, index.ts). index.ts was not in the Allowed list but is under `packages/xmpp-core/src/**`.
- Typecheck xmpp-core, web, mobile, server clean; oxlint and prettier clean.
- Behaviour differences: none. No README or docs mentioned the Streams.
