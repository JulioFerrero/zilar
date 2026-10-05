---
id: T-0213
title: Mobile: the AI edit screen shows the AI's activity feed (audit log)
status: planned
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

## Review (written by Claude)
