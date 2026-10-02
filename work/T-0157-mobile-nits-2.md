---
id: T-0157
title: Mobile nits bundle 2 (attachments, GIFs, roles load error)
status: planned
milestone: M5
branch: task/T-0157-mobile-nits-2
model: meta/muse-spark-1.3-contributor
effort: medium
estimate: 0.5 day
---

# T-0157: Mobile nits bundle 2 (attachments, GIFs, roles load error)

## Spec (written by Claude, do not edit)

### Why
Deferred small items from the mobile reviews of T-0140, T-0143, T-0144, T-0148 and T-0150.

### What to build
1. `attachment-native.ts` and `real-store.ts`: an unknown picker size is reported as "That file is empty". Distinguish unknown from zero: unknown size means read the real size from the file (`expo-file-system`) before the cap check, and only a real zero says "That file is empty".
2. Tap-to-open file download has no size cap: cap it at the same 50 MiB, refuse with a plain message, and stop the download early (abort) when the cap is exceeded.
3. GIF panel infinite scroll can fire overlapping page loads: guard with a ref set synchronously, and test it.
4. `gifs-api.test.ts` "sends no session token cross-origin" is tautological: replace it with a test that fails if the Authorization header reaches a non-API origin (inspect the actual fetch call).
5. Caption edit for attachment messages (web has it): the mobile edit path only sends text corrections; let a long-press Edit on an attachment message edit its caption through the same correction path web uses, keeping the attachment payload, with a test.
6. A mounted-route test for the group roles load error (the screen shows the error state and a working Retry), using the existing mounted-route test pattern.
7. Search jump retries: add a test that the jump-to-message retry stops after its cap and leaves the list at the bottom instead of looping.
Report each item as done or not done.

### Read first
`AGENTS.md`, the Reviews of `work/T-0140-*.md`, `T-0147-*.md`, `T-0148-*.md`, `T-0150-*.md`.

### Allowed files
`apps/mobile/**`, `work/T-0157-mobile-nits-2.md`. Not allowed: server, web, packages, new dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/mobile test --maxWorkers=2 attachment gifs gif-panel real-store chat-store hooks-guard roles
```

### Acceptance
- Each item is done with a test, or listed as not done with the reason.
- hooks-guard and the neighbouring suites pass.

## Report (written by the worker when done)

## Review (written by Claude)
