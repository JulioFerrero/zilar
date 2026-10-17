---
id: T-1881
title: "fetch_media: send a descriptive User-Agent (Wikimedia answers 403 without one) and log the fixed refusal reason with the fetch_media outcome line"
status: merged
milestone: M5
branch: task/T-1881-fetch-media-user-agent
model: auto
effort: default
depends_on: [T-1873]
estimate: 15 min
---

# T-1881: `fetch_media` sends a User-Agent

## Spec (written by Claude, do not edit)

### Why
**The live test on 2026-10-17:** in "cards test", Deepseek called `fetch_media` five times for a Wikimedia photo and every call was refused. Two of those refusals were correct: one URL was 14 MB, and another thumb size gives 400 even to curl. **But the lead measured** that `upload.wikimedia.org` answers **403 to a request with no User-Agent**, and 200 with any UA (`curl`, `node`, `Mozilla/5.0 (compatible; Zilar)`).
- **The UA gap:** `fetchCardMedia` passes no `headers` to `guardedGet`, which defaults to `{}` (`apps/server/src/web-tools/guarded-fetch.ts:72`, `:212-217`).
- **The log gap:** the outcome log line has no reason, so a refusal can't be told apart in the logs.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/card-media/fetch.ts:147-152`** builds `GuardedGetOptions` without `headers`.
- **The existing UAs:** `wikipediaUserAgent()` returns `Zilar/<version> (self-hosted; contact via server admin)` (`apps/server/src/web-tools/shared.ts:96-98`), and the price adapter sends `Mozilla/5.0 (compatible; Zilar)` (`apps/server/src/web-tools/price-adapter.ts:105`).
- **`apps/server/src/agents/gateway/fetch-media.ts:75`:** `logOutcome(logger, aiId, ok)` logs `{ aiId, tool, ok }`. The refusal `reason` values are fixed sentences from `fetch.ts:33-41`, with no URL or remote text.

### Steps
1. **`fetch.ts`:** set `headers: { 'user-agent': wikipediaUserAgent(), accept: isImage ? 'image/*' : '*/*' }` in the options.
2. **`fetch-media.ts`:** give `logOutcome` an optional `reason`. Pass the fixed refusal reason (or `not available` / `store failed`), and log it as `reason`. Still never the URL.
3. **No new test.** Run the existing `apps/server/src/card-media/fetch.test.ts`.

### Allowed files
- `apps/server/src/card-media/fetch.ts`
- `apps/server/src/agents/gateway/fetch-media.ts`
- `work/T-1881-fetch-media-user-agent.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/card-media/fetch.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`fetch_media` requests carry the Zilar User-Agent.**
- **A refused call** logs its fixed reason.
- The test passes, and so does the gate.

---

## Report (written by the worker when done)

### What I did

- **`apps/server/src/card-media/fetch.ts`:** the `GuardedGetOptions` built in
  `fetchCardMediaEffect` now sends `headers: { 'user-agent': wikipediaUserAgent(),
  accept: isImage ? 'image/*' : '*/*' }`. The UA is the existing
  `Zilar/<version> (self-hosted; contact via server admin)` from
  `apps/server/src/web-tools/shared.ts`; `accept` matches the requested kind.
- **`apps/server/src/agents/gateway/fetch-media.ts`:** `logOutcome` takes an
  optional `reason` and adds it to the structured log object only when present.
  It is passed for all three failures: the fixed refusal `result.reason`, the
  caught store failure (`the file could not be stored`) and the missing
  `cardMediaDir` case (`media is not available`). The success line keeps
  `{ aiId, tool, ok }` with no reason. The URL is still never logged.
- Updated the file header comment to say the log carries the fixed reason.
- No new test, as the spec asks.

### Checks run

- `pnpm install --silent`: no output, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/card-media/fetch.test.ts`:
  1 test file passed, 4 tests passed (7.99s).
- `pnpm gate` (repo root), run twice (before and after filling this report);
  the final run:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.7s)
  PASS  lint  (0.8s)
  PASS  typecheck  (1.0s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/server  (15.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- I did not run a live request against `upload.wikimedia.org`: tests must not
  call real external services. The change is the header reaching `guardedGet`
  through the existing `headers` option (`guarded-fetch.ts:72`, `:217`).
- `accept` is set as the spec says. For files it is `*/*`; the content-type
  allowlist in the options still does the real filtering.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `dc8baa374`.
- **Every `fetch_media` request** now sends `wikipediaUserAgent()` plus an `accept` header.
- **The outcome log line** carries the fixed refusal reason, never the URL.
- **The lead measured the cause** with curl: `upload.wikimedia.org` answers 403 with no UA and 200 with any UA. After the deploy, a Wikimedia photo should fetch; the live retry is listed in NOW.md.
