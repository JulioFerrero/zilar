---
id: T-0213
title: Mobile: the AI edit screen shows the AI's activity feed (audit log)
status: merged
milestone: M5
branch: task/T-0213-mobile-ai-activity
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0189]
estimate: 0.5 day
---

# T-0213: Activity on the phone's AI screen

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-03: "implement all the features we have in web into the mobile app". The web AI panel shows an Activity list (what the AI did, approvals, stop and resume); the phone does not. This is T-0189d of `docs/audit/mobile-parity-gaps.md` section 7.1.

### What the person sees
On the AI edit screen, under the Routines section (added by T-0189), an `Activity` section:
- Heading `Activity` (14 px, medium) with a refresh icon button on the right (`RefreshCw` from `lucide-react-native`, accessibility label `Refresh activity`), shown once loaded.
- Up to 20 rows: on the left the description, on the right the relative time (muted): `just now`, `N min ago`, `N hour(s) ago`, `N day(s) ago`.
- Descriptions exactly as web: `approval.decided` → `A request was approved` (decision `approve_once` or `approve_always`), `A request was denied` (`deny`), else `A request was decided`; `ai.stopped` → `Stopped`; `ai.resumed` → `Resumed`; anything else → the action with its first word capitalised and dots turned into spaces (`tool.run` → `Tool run`), empty action → `Activity`.
- `Load more` (button) when the page has a `next` cursor; it reads `Loading…` while it loads and appends the next 20.
- States: loading shows three grey placeholder bars; empty `No activity yet.`; first load failed: `Could not load activity.` (danger) and `Retry`; load more failed: the rows stay and `Could not load more activity.` shows under them. Never show server text.

### Verified facts (do not re-derive)
- Server: `GET /audit` in `apps/server/src/audit/routes.ts` (route line 29, query schema lines 17-24): exactly one of `aiId` or `groupId`, optional `limit` (1-200) and `before` (cursor). Answers `{ entries, next }`.
- Web client: `publicAuditEntrySchema` (`apps/web/src/lib/api.ts` lines 1851-1863: `id, at, aiId, groupId, action, subjectId, argsHash, cost ({currency, amount} or null, lines 1844-1849), result ('ok'|'denied'|'error'), detail (record or null), actorUserId`), `auditPageSchema` (lines 1867-1870), `listAudit` (lines 1889-1903).
- Web component: `apps/web/src/components/ais/AiActivity.tsx` (283 lines): `PAGE_LIMIT = 20` (line 9), `describeAuditEntry` (lines 11-29) with `readDecision` and `humaniseAction` (lines 31-48), `formatRelativeAudit` (lines 57-72), the section and its states (lines 174-228), the row (lines 245-260). Copy the three pure functions as they are.
- Mobile after T-0189: the AI edit screen `apps/mobile/src/app/ais/[id].tsx` mounts `<ToolsSection api={toolsApi} aiId={id} />` and `<RoutinesSection api={toolsApi} aiId={id} />`; follow the same shape (a section component taking `api` and `aiId`). API, mock and hook pattern: `apps/mobile/src/lib/tools-api.ts`, `apps/mobile/src/mock/tools.ts`, `apps/mobile/src/components/ais/use-tools-api.ts`.

### What to build
1. New `apps/mobile/src/lib/audit-api.ts`: `PublicAuditEntry`, `AuditPage { entries; next }`, `AuditApiError` (status, code), `AuditApi { listAiAudit(aiId: string, before?: string): Promise<AuditPage> }` calling `GET /audit?aiId=<id>&limit=20[&before=<cursor>]`, defensive parsing (a bad entry makes the page `invalid_response`), `createAuditApi(getToken, fetchImpl = fetch, apiUrl = API_URL)`.
2. New `apps/mobile/src/mock/audit.ts` (25 entries across the actions above, so `Load more` shows) and `apps/mobile/src/components/ais/use-audit-api.ts`.
3. New `apps/mobile/src/components/ais/activity-format.ts`: `describeAuditEntry`, `formatRelativeAudit` (and the helpers) copied from web.
4. New `apps/mobile/src/components/ais/ai-activity.tsx`: `AiActivity({ api, aiId })` with the states above. One request at a time; ignore results after unmount.
5. `apps/mobile/src/app/ais/[id].tsx`: mount `<AiActivity api={auditApi} aiId={id} />` under `RoutinesSection`. Nothing else changes.
6. Tests (Vitest): `apps/mobile/src/lib/audit-api.test.ts` (query string with and without `before`, bearer, parsing, bad entry, HTTP error); `apps/mobile/src/components/ais/activity-format.test.ts` (every description case and every relative-time step, singular and plural); `apps/mobile/src/components/ais/ai-activity.test.tsx` (rows, empty, first-load error with Retry, Load more appends and hides when `next` is null, load-more error keeps rows, Refresh reloads).

### Read first
`AGENTS.md`, `apps/web/src/components/ais/AiActivity.tsx`, `apps/web/src/lib/api.ts` (lines 1844-1903), `apps/mobile/src/lib/tools-api.ts`, `apps/mobile/src/mock/tools.ts`, `apps/mobile/src/components/ais/use-tools-api.ts`, `apps/mobile/src/components/ais/routines-section.tsx`, `apps/mobile/src/app/ais/[id].tsx`.

### Allowed files
`apps/mobile/src/lib/audit-api.ts` (new), `apps/mobile/src/lib/audit-api.test.ts` (new), `apps/mobile/src/mock/audit.ts` (new), `apps/mobile/src/components/ais/use-audit-api.ts` (new), `apps/mobile/src/components/ais/activity-format.ts` (new), `apps/mobile/src/components/ais/activity-format.test.ts` (new), `apps/mobile/src/components/ais/ai-activity.tsx` (new), `apps/mobile/src/components/ais/ai-activity.test.tsx` (new), `apps/mobile/src/app/ais/[id].tsx`, `work/T-0213-mobile-ai-activity.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot audit-api activity-format ai-activity
pnpm gate
```

### Acceptance
- The AI edit screen shows the Activity list with web's descriptions, relative times, Load more, Refresh and the fixed sentences; no server text.
- No server, web or package change; no new dependency; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Group activity (owner and admins on the group screen), cost display, filtering.

---

## Report (written by the worker when done)

Implemented the Activity section on the mobile AI edit screen, matching web's
`AiActivity.tsx` descriptions, relative times, Load more, Refresh and fixed
sentences.

What I did:
- `apps/mobile/src/lib/audit-api.ts` (new): `PublicAuditEntry`, `AuditPage`,
  `AuditApiError` (status, code), `AUDIT_PAGE_LIMIT = 20`, `AuditApi`
  (`listAiAudit(aiId, before?)`) calling
  `GET /api/audit?aiId=<id>&limit=20[&before=<cursor>]` with bearer auth,
  defensive type-guard parsing (a bad entry makes the page
  `invalid_response`), `createAuditApi(getToken, fetchImpl = fetch,
  apiUrl = API_URL)`.
- `apps/mobile/src/mock/audit.ts` (new): 25 entries newest-first across
  `approval.decided` (all decisions), `ai.stopped`, `ai.resumed`,
  `tool.run`, routine/message actions and an empty action; paginates by
  `before` cursor with limit 20, so Load more shows (20 + 5).
- `apps/mobile/src/components/ais/use-audit-api.ts` (new): same mock gate
  shape as `use-tools-api.ts`.
- `apps/mobile/src/components/ais/activity-format.ts` (new):
  `describeAuditEntry`, `formatRelativeAudit` (+ helpers) copied from web.
- `apps/mobile/src/components/ais/ai-activity.tsx` (new): `AiActivity({ api,
  aiId })` with heading `Activity` (14px medium) + `RefreshCw` refresh button
  (`Refresh activity` label, only when ready), three-bar loading skeleton,
  `No activity yet.` empty state, `Could not load activity.` + Retry on first
  failure, rows (description left, muted relative time right), `Load more` /
  `Loading…`, `Could not load more activity.` keeping rows on page failure.
  One request at a time (sync `loadingMoreRef` + flag); stale results ignored
  after unmount via the `active` flag. `AiActivityContent` and
  `AiActivityHeader` are exported for tests; no server text is ever shown.
- `apps/mobile/src/app/ais/[id].tsx`: mounts
  `<AiActivity api={auditApi} aiId={id} />` under `RoutinesSection` via the new
  `useAuditApi()` hook. Nothing else changed.
- Tests: `audit-api.test.ts` (8 tests: URL with/without `before`, bearer,
  full parse, bad entry, bad page shape, HTTP error code, no-token 401,
  network error); `activity-format.test.ts` (11 tests: every description case
  incl. all decisions/stop/resume/humanise/empty, every relative-time step
  incl. singular/plural/future clamp); `ai-activity.test.tsx` (17 tests: rows,
  empty, first-load error + Retry wiring, Load more show/hide/`Loading…`/
  wiring, load-more error keeps rows, header refresh show/hide/wiring,
  initial mount, first-page/append/dedupe/failure/reload helpers).

Commands and real results:
- `pnpm install`: ok (11.6s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot audit-api
  activity-format ai-activity`: 3 files, 36 tests, all passed.
- `pnpm gate` (final): PASS install, PASS format, PASS lint, PASS typecheck,
  PASS tests @zilar/mobile; "scope: every changed file is inside the Allowed
  files"; GATE PASS.

Problems / deviations:
- Mobile has no React Native async testing library, so the `.tsx` tests use
  the same pattern as `routines-section.test.tsx` (static markup of the
  content/header states + direct tests of `loadAiActivity`/`appendAiActivity`
  incl. deduplication and reload counting). Mounted tap-through of Load more
  / Refresh is not covered; the wired callbacks are.
- The lint rule `react(set-state-in-effect)` rejects resetting to loading
  inside the fetch effect, so `refresh` sets the loading state in the event
  handler instead (same visible behaviour).
- One process note: I fixed two test files' formatting with
  `prettier --write` on just those files after the first gate run flagged
  them; and I edited the test file once via a `python3 -c` replace instead of
  the edit tool — content is identical, no stray changes (gate scope clean).

Security checklist: no secrets/tokens in logs or errors (fixed sentences
only); no deletes/updates; no caps/uniqueness rules; no permission changes;
no new routes; audit entries carry ids only.

Open questions: none.

## Review (written by Claude)

**Verdict:** Approved, clean on the first pre-review (free Muse). New `audit-api.ts` (`GET /audit?aiId&limit=20&before`), its mock (25 entries) and hook, `activity-format.ts` (web's descriptions and relative times copied), and `AiActivity` mounted under Routines on the AI edit screen (4 added lines there); error messages are the fixed sentences, never server text (checked in `ai-activity.tsx`). Not seen on a device: the test account has no AI, like T-0189; Julio checks an AI screen on his phone after the next release. Accepted nits: three small ones.
