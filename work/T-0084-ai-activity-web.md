---
id: T-0084
title: Web — an Activity section in the AI panel, showing the audit log entries for that AI
status: todo
milestone: M4
branch: task/T-0084-ai-activity-web
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0079, T-0080]
estimate: 0.75 day
---

# T-0084: AI activity in the web panel

## Spec (written by Claude, do not edit)

### Goal

The server keeps an append-only audit log (T-0079) and lets the owner of an AI read its entries with `GET /api/audit?aiId=…&limit=…&before=…`. Nothing in the web app shows it. Add an **Activity** section at the bottom of the AI panel: the last entries for this AI in plain words, newest first, with "Load more".

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/audit/routes.ts` and `service.ts` (`PublicAuditEntry`, the response `{ entries, next }`, the known actions: `approval.decided`, `machine.paired`, `machine.approved`, `machine.denied`, `machine.revoked`, `machine.deleted`, and soon `ai.stopped` / `ai.resumed`) — do not edit the server
- `apps/web/src/components/ais/AiPanel.tsx` and `AiPanel.test.tsx` (structure, sections, the confirm/inline-error style, how tests fake the api), `apps/web/src/lib/api.ts` and `api.test.ts` (patterns for a zod schema and a paged list)
- `apps/web/src/mock/api.ts` and `mock/api.test.ts` (how routes and state are declared)
- `apps/web/src/lib/format.ts` (existing time formatting helpers)

### Allowed files (under `apps/web/`)
- `src/components/ais/AiActivity.tsx` (new), `AiActivity.test.tsx` (new)
- `src/components/ais/AiPanel.tsx`, `AiPanel.test.tsx` (mount the section, nothing else)
- `src/lib/api.ts`, `src/lib/api.test.ts` (`listAudit`)
- `src/mock/api.ts`, `src/mock/api.test.ts` (serve `GET /audit?aiId=` with a few entries so mock mode shows the section)
- `work/T-0084-ai-activity-web.md` (path from the repo root)

**Not allowed:** anything else, `apps/server/**`, `packages/**`, mobile. No new dependencies.

### What to build
1. `lib/api.ts`: `listAudit({ aiId, limit?, before? })` returning `{ entries, next }`, zod-validated (`id`, `at` ISO string, `aiId`, `groupId`, `action`, `subjectId`, `argsHash`, `cost` (`{currency, amount}` or null), `result` (`ok | denied | error`), `detail` (object or null), `actorUserId`). Query params go through `URLSearchParams`.
2. `AiActivity` (props: `aiId`): loads the first 20 entries on mount and shows, per entry, one line of **plain words** from a small pure mapper `describeAuditEntry(entry)`:
   - `approval.decided` → "A request was approved" / "A request was denied" (from `detail.decision`: `approve_once`/`approve_always` → approved, `deny` → denied; anything else → "A request was decided"),
   - `ai.stopped` → "Stopped", `ai.resumed` → "Resumed",
   - any other action → the action string itself, humanized (`machine.approved` → "Machine approved"), never raw JSON, and **never render `detail` values other than the decision** (unknown fields must not leak into the UI),
   - plus the relative time ("3 min ago") in a helper that takes `now` as a parameter (pure during render) and a title attribute with the exact date.
   States: loading (skeleton, no layout jump), empty ("No activity yet."), error with Retry, list. "Load more" appears while `next` is set, appends the next page, is disabled while loading, and never duplicates entries (dedupe by `id`). No polling: a refresh button reloads from the top.
3. Mount the section at the bottom of the panel for AIs the viewer owns (the panel already only shows the owner's AIs), with a heading "Activity". A 404 or any failure of this section must not break the rest of the panel.
4. Mock mode returns a handful of entries (an approval decided, a stop, a resume) with recent timestamps.

### Tests
- `describeAuditEntry` for every action above, unknown actions and hostile `detail` (an object with a `<script>` string and a nested object: nothing from it appears in the output).
- Component: loading, empty, error+retry, list, load more with dedupe, refresh, the failure of the section leaves the panel intact. `api.test.ts`: path and query string, schema failure becomes `ApiError`.

### Live check (the lead does it)
If you can, run the web dev server on a **free port other than 3000, 5173 and 8081** in mock mode (deep link with `?mock=1`, the query is dropped on in-app navigation) and screenshot the panel section; say what you did in the Report.

### Acceptance criteria
- [ ] Owners see readable activity for their AI, with paging and no duplicates.
- [ ] Nothing from `detail` other than the decision reaches the DOM.
- [ ] A failing section never breaks the panel.
- [ ] No `any`, no `@ts-ignore`, no new dependencies, no `console.log`; lint passes (re-run it after your last edit).

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/web
pnpm build
```

### Out of scope
- A group-level log page, filters, export, retention, mobile.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**
