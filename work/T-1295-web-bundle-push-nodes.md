---
id: T-1295
title: "Web bundle split (PERF-14): vendor chunks for effect, better-auth and radix so the main chunk shrinks; server: a device's notified-ids set is dropped when it unsubscribes (PERF-17)"
status: todo
milestone: M5
branch: task/T-1295-web-bundle-push-nodes
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1295: Web bundle split; push memory cleanup

## Spec (written by Claude, do not edit)

### Why
`docs/audit/performance-audit.md`:
- **PERF-14** (P3, `:144`, suspected): the routes and `MarkdownText` are lazy, but `apps/web/vite.config.ts` has no `manualChunks`. 142 files import `effect`, and the main chunk also carries `better-auth` and `radix-ui`.
- **PERF-17** (P3, `:220`): `recentlyNotified` (`apps/server/src/push/delivery.ts`) is capped per node, but nodes are never removed when a device unsubscribes.

**First recheck both findings on main.** If one is already fixed, say so with `file:line` and skip it.

### What to build
1. **PERF-14:**
   - run `pnpm --filter @zilar/web build` and record the chunk sizes before;
   - add `manualChunks` that put `effect`, `better-auth` and the radix packages in their own vendor chunks;
   - record the sizes after, and paste both tables in the Report;
   - if the main chunk doesn't get smaller, revert and say so.
2. **PERF-17:** when a push subscription or device is removed (cite the unsubscribe path and the T-1255 session-revoke cascade), delete its node from `recentlyNotified`.
3. **Test** (the message pipeline), 1 case in `apps/server/src/push/delivery.test.ts` (or the nearest): unsubscribe removes the node's set.

### Read first
`AGENTS.md`, `docs/audit/performance-audit.md` (`:144`, `:220`), `apps/web/vite.config.ts` and `apps/server/src/push/delivery.ts`.

### Allowed files
`apps/web/vite.config.ts`, `apps/server/src/push/*.ts`, `work/T-1295-web-bundle-push-nodes.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. The bundle report is in the Report.

---

## Report (written by the worker when done)

## Review (written by Claude)
