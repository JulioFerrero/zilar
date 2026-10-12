---
id: T-1240
title: "Link previews follow-up, server: send a bot User-Agent and Accept header, and parse the first 512 KB of a big page instead of failing — github.com and wikipedia.org answer 204 today"
status: merged
milestone: M5
branch: task/T-1240-link-preview-ua-partial
model: auto
effort: default
depends_on: [T-1234]
estimate: 0.2 day
---

# T-1240: Link previews for big pages and strict sites

## Spec (written by Claude, do not edit)

### Why
The lead's live check of T-1234 (`work/T-1234-link-previews-server-web.md`, Review) gave:
- **200 with a title** for example.com, news.ycombinator.com, bbc.com/news and effect.website;
- **204** for `https://github.com` and `https://www.wikipedia.org/`.

Two likely causes, both in the fetch:
- **No `User-Agent` header.** `apps/server/src/link-preview/fetch.ts:121-126` passes no `headers` to `guardedGet`, and Wikimedia refuses requests without one.
- **The 512 KB cap.** A page over `LINK_PREVIEW_MAX_BYTES` fails as `too-large` (`apps/server/src/web-tools/guarded-fetch.ts:262,285`) instead of being read up to the cap; the `<head>` is in the first few KB.

### What to build
1. **Headers** (`fetch.ts`): pass `headers: { 'user-agent': 'Mozilla/5.0 (compatible; ZilarBot/1.0; +https://chat.zilar.app)', accept: 'text/html,application/xhtml+xml' }`.
2. **Partial read** (`guarded-fetch.ts`): add an option `truncateAtMax?: boolean` to `GuardedGetOptions`. When it's true, hitting `maxResponseBytes` ends the read and returns the bytes so far as a successful body, instead of `too-large`. Every other check stays. Link previews pass `truncateAtMax: true`; the AI web tools don't change.
   - **`guarded-fetch.ts` is 396 lines and must stay at most 400.** Move a helper (`classifyFetchError` / `mediaTypeOf` / `decodeCapped`) into a new `apps/server/src/web-tools/guarded-fetch-helpers.ts` if needed, and cite what moved.
3. **Check by hand which cause it was.** From a worktree, with real network, call the unfurl function for both URLs (a small `tsx` one-off you delete after), and write the outcome per URL in the Report. If either still gives `null`, report why (a status, a redirect, the content type).
4. **Test** (fetch guard), 1, in `apps/server/src/link-preview/link-preview.test.ts`: with a fake fetcher returning 600 KB of HTML whose head has `og:title`, the unfurl returns that title.

### Read first
`AGENTS.md`, `work/T-1234-link-previews-server-web.md` (the Report and the Review), `apps/server/src/link-preview/fetch.ts`, `apps/server/src/web-tools/guarded-fetch.ts` and `apps/server/src/link-preview/link-preview.test.ts`.

### Allowed files
`apps/server/src/link-preview/**`, `apps/server/src/web-tools/guarded-fetch.ts`, `apps/server/src/web-tools/guarded-fetch-helpers.ts`, `work/T-1240-link-preview-ua-partial.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/link-preview/link-preview.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- **The lead's live check after deploy, once the 1 h `null` cache has expired:** github.com and wikipedia.org answer 200 with a title.

---

## Report (written by the worker when done)

### What I did

- **`apps/server/src/link-preview/fetch.ts`:** `defaultFetcher` now sends
  `headers: { 'user-agent': 'Mozilla/5.0 (compatible; ZilarBot/1.0; +https://chat.zilar.app)', accept: 'text/html,application/xhtml+xml' }`
  and passes `truncateAtMax: true`.
- **`apps/server/src/web-tools/guarded-fetch.ts`:** added `truncateAtMax?: boolean`
  to `GuardedGetOptions` and threaded it into the pinned fetch. When it is
  `true`, a chunk that would push the body over `maxResponseBytes` is trimmed to
  the cap and returned as a successful body (`ok: true`) instead of `too-large`;
  when it is `false`/absent, the old `response too large` failure is unchanged.
  Everything else is unchanged: https only, port 443, no credentials, the DNS
  pin, the private/loopback/link-local refusal, no redirects, the content-type
  allowlist, the idle timeout and the overall deadline. The AI web tools pass no
  `truncateAtMax`, so they are untouched.
  - The file is **390 lines** (was 396, cap 400).
  - The `resume` path in `fetchPinned` was made single-shot (`settled` plus
    `succeed`/`failWith` helpers), because truncation, the stream `end`, a
    stream error and the request error now race; the old code could already be
    reached twice.
- **`apps/server/src/web-tools/guarded-fetch-helpers.ts` (new):** moved out of
  `guarded-fetch.ts` unchanged: `WEB_MAX_DECODE_CHARS`, `mediaTypeOf`,
  `decodeCapped`, `badUrlSummary`, `fetchFailedSummary`, the `BadUrlReason` and
  `FetchFailureReason` types, and the body of `classifyFetchError` as
  `classifyFetchFailureReason`. `classifyFetchError` stays as a 3-line wrapper
  because the `FetchFailed` tagged error stays in `guarded-fetch.ts`.
  `WEB_MAX_DECODE_CHARS` is no longer exported from `guarded-fetch.ts` (it is now
  exported from the helper); no other module imported it.
- **`apps/server/src/link-preview/link-preview.test.ts`:** the one new test from
  the spec.

### Files changed

- `apps/server/src/link-preview/fetch.ts`
- `apps/server/src/link-preview/link-preview.test.ts`
- `apps/server/src/web-tools/guarded-fetch.ts`
- `apps/server/src/web-tools/guarded-fetch-helpers.ts` (new)
- `work/T-1240-link-preview-ua-partial.md` (status + this Report)

All inside the task's Allowed files.

### Commands run and real results

- `pnpm install`: PASS ("Done in 9.9s", resolved 1270).
- `pnpm --filter @zilar/server exec vitest run src/link-preview/link-preview.test.ts --reporter=dot`
  (the task's Checks command): PASS — `Test Files 1 passed (1)`, `Tests 6 passed (6)`
  (the 5 existing tests plus the new one).
- `pnpm gate` (from the repo root, run once at the end): **GATE PASS**. Summary lines:
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)  (1.1s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (1.0s)`
  - `PASS  typecheck  (3.1s)`
  - `PASS  effect  (0.7s)`
  - `PASS  tests @zilar/server  (3.7s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`

### Live check by hand (real network, worktree)

A throwaway `tsx` one-off under `apps/server/src/link-preview/` (deleted after;
`git status` shows only the files above) called the real `fetchLinkPreview` and
`guardedGet` for both URLs.

- **`https://github.com/`** -> `{ title: "GitHub · Change is constant. GitHub keeps you ahead. · GitHub", description: "Join the world's most widely adopted, AI-powered developer platform…", siteName: "GitHub" }`.
- **`https://www.wikipedia.org/`** -> `{ title: "Wikipedia, the free encyclopedia", description: "Wikipedia is a free online encyclopedia, created and edited by volunteers around the world…" }`.

Which cause it was, probed by running `guardedGet` with each option turned on and
off (same 512 KB cap and 8 s timeout):

- **github.com: the 512 KB cap.** `ua+truncate` ok (200, text/html, 524 215 bytes);
  `ua+no-truncate` -> `response too large`; `no-ua+truncate` ok. The page is
  ~524 KB, just over the cap, so before this change it always failed as
  `too-large`. The User-Agent was irrelevant here.
- **wikipedia.org: the missing User-Agent.** `ua+truncate` ok (200, text/html,
  120 085 bytes); `ua+no-truncate` ok (same, so the cap was not the cause);
  `no-ua+truncate` -> `fetch failed with status 403`. Wikimedia refuses a request
  with no User-Agent.

Both causes were real and both are fixed by the combined change; each URL now
answers 200 with a title.

### Problems, deviations from the spec, open questions

1. **Test reach.** The injected `LinkPreviewFetcher` returns a whole
   `GuardedGetResult`, so the new test exercises `fetch.ts` + `parse.ts` (a
   600 KB body still parses its `og:title`) but does **not** execute the byte cap
   itself, which lives in the real `fetchPinned`. The truncation behaviour was
   verified by the live probe above (`ua+no-truncate` fails, `ua+truncate`
   succeeds); there is no unit test for `fetchPinned` because the guard has no
   seam that returns more than the cap.
2. **More helpers moved than the spec named.** The spec listed
   `classifyFetchError` / `mediaTypeOf` / `decodeCapped`. Moving only those left
   the file at 417 lines, so I also moved `badUrlSummary`, `fetchFailedSummary`
   and the two reason types into the helper (listed above). The summary text is
   byte-for-byte the same, so callers and the fixed-word summaries are
   unchanged.
3. **`settled` refactor in `fetchPinned`.** Truncating means answering success
   before the socket is torn down, which races the existing `end`/`error`
   handlers. The refactor is inside the task's file and keeps the same failure
   outcomes. Worth a look in review.
4. **`WEB_MAX_DECODE_CHARS` no longer re-exported from `guarded-fetch.ts`.** It
   was exported but imported nowhere else in the repo; if the lead wants the
   public surface unchanged I can add a re-export.
5. Nothing else was out of scope; no new dependency, no `any`, no `@ts-ignore`.

## Review (written by Claude)


**Lead, 2026-10-12: approved. Pre-review clean (1 nit).**
- **Both causes were real, according to the worker's probe:** github.com is 524 KB, just over the cap, and wikipedia.org returns 403 with no User-Agent. Both now answer with a title.
- **The change:**
  - link previews send a bot User-Agent and Accept header;
  - `truncateAtMax` returns the first 512 KB instead of failing, for link previews only;
  - helpers moved to `guarded-fetch-helpers.ts`, so `guarded-fetch.ts` is 390 lines.
- **After rebasing onto main:** the web-tools, link-preview and sandbox tests pass (4 files, 114 tests), and server tsc gives 0 errors. The AI web tools aren't affected.
- **After deploy:** live-check github.com once the 1 h `null` cache has expired.
