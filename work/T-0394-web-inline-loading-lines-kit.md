---
id: T-0394
title: "Web kit: eight hand-written \"Loading…\" and \"Searching…\" lines use StateMessage"
status: merged
milestone: M5
branch: task/T-0394-web-inline-loading-lines-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0394: loading lines on the kit

## Spec (written by Claude, do not edit)

### Why
These are the last plain-text loading lines on web outside the kit.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/state-message.tsx`:**
  - `size="inline"` renders `<div role="status" className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-muted-foreground">` with a spinner and the title;
  - `size="block"` (the default) is a centered column.
- **The lines:**

| File | Line | Today | Use |
| --- | --- | --- | --- |
| `apps/web/src/components/PeopleSearchResult.tsx` | 19 | `<p className="px-[10px] pb-2 text-[13px] text-muted-foreground">Searching…</p>` | inline |
| `apps/web/src/components/MessageSearchResults.tsx` | 78 | the same "Searching…" | inline |
| `apps/web/src/components/tools/RoutinesSection.tsx` | 170 | `<p className="px-2 text-[13px] text-muted-foreground">Loading…</p>` | inline |
| `apps/web/src/components/tools/ToolDetailPanel.tsx` | 188 | `return <p className="px-2 …">Loading…</p>;` | inline |
| `apps/web/src/components/ais/NewAiDialog.tsx` | 181 | `{status === 'loading' && <p className="text-[15px] text-muted-foreground">Loading…</p>}` | inline |
| `apps/web/src/components/ais/AiPanel.tsx` | 524 | the same pattern | inline |
| `apps/web/src/routes/IntegrationsPage.tsx` | 114 | `<p className="text-[14px] text-muted-foreground">Loading integrations…</p>` | block |
| `apps/web/src/routes/NotificationsPage.tsx` | 369 | `<p …>Loading notification settings…</p>` | block |

- **Tests:**
  - `apps/web/src/components/PeopleSearchResult.test.tsx`;
  - `apps/web/src/components/MessageSearch.test.tsx`;
  - `apps/web/src/components/tools/tools.test.tsx`;
  - `apps/web/src/components/ais/NewAiDialog.test.tsx`;
  - `apps/web/src/components/ais/AiPanel.test.tsx`;
  - `apps/web/src/routes/IntegrationsPage.test.tsx`;
  - `apps/web/src/routes/NotificationsPage.test.tsx`.

  Keep the same visible texts.

### What to build
1. Replace each line with `<StateMessage kind="loading" size=… title="<same text>" />`. For the two search results, wrap it in `<div className="px-[10px] pb-2">` if the padding must stay.
2. Import `StateMessage` from `@/components/ui/state-message` where missing.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/state-message.tsx` and each file around its line.

### Allowed files
`apps/web/src/components/PeopleSearchResult.tsx`, `apps/web/src/components/MessageSearchResults.tsx`, `apps/web/src/components/tools/RoutinesSection.tsx`, `apps/web/src/components/tools/ToolDetailPanel.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`, `apps/web/src/components/ais/AiPanel.tsx`, `apps/web/src/routes/IntegrationsPage.tsx`, `apps/web/src/routes/NotificationsPage.tsx`, `apps/web/src/components/PeopleSearchResult.test.tsx`, `apps/web/src/components/MessageSearch.test.tsx`, `apps/web/src/components/tools/tools.test.tsx`, `apps/web/src/components/ais/NewAiDialog.test.tsx`, `apps/web/src/components/ais/AiPanel.test.tsx`, `apps/web/src/routes/IntegrationsPage.test.tsx`, `apps/web/src/routes/NotificationsPage.test.tsx`, `work/T-0394-web-inline-loading-lines-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot PeopleSearchResult MessageSearch tools NewAiDialog AiPanel IntegrationsPage NotificationsPage
pnpm gate
```

### Acceptance
- None of the eight plain lines remains.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: done.

### What I did
Replaced the eight plain-text loading lines with `StateMessage kind="loading"` and kept the
visible text identical:
- Six inline lines use `size="inline"`: `PeopleSearchResult.tsx`, `MessageSearchResults.tsx`,
  `tools/RoutinesSection.tsx`, `tools/ToolDetailPanel.tsx`, `ais/NewAiDialog.tsx`, `ais/AiPanel.tsx`.
- The two settings lines use the default block size: `routes/IntegrationsPage.tsx`,
  `routes/NotificationsPage.tsx`.
- For the two search results I wrapped the message in `<div className="px-[10px] pb-2">` as the
  spec suggests, so the original left/bottom padding around the line stays.
- Added `import { StateMessage } from '@/components/ui/state-message';` in each of the eight files.

Files changed:
- `apps/web/src/components/PeopleSearchResult.tsx`
- `apps/web/src/components/MessageSearchResults.tsx`
- `apps/web/src/components/tools/RoutinesSection.tsx`
- `apps/web/src/components/tools/ToolDetailPanel.tsx`
- `apps/web/src/components/ais/NewAiDialog.tsx`
- `apps/web/src/components/ais/AiPanel.tsx`
- `apps/web/src/routes/IntegrationsPage.tsx`
- `apps/web/src/routes/NotificationsPage.tsx`
- `work/T-0394-web-inline-loading-lines-kit.md`

No test file needed changes: the listed tests do not assert the removed markup, and every visible
string is unchanged. I ran them to confirm.

### Commands and results
- `pnpm install`: done, 0 errors (peer-dependency warning for `@types/react-dom` in mobile, unrelated).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot PeopleSearchResult MessageSearch tools NewAiDialog AiPanel IntegrationsPage NotificationsPage`:
  `Test Files 10 passed (10)`, `Tests 131 passed (131)`.
- `pnpm gate` (repo root): final output
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (2.4s)
  PASS  format  (29.8s)
  PASS  lint  (2.1s)
  PASS  typecheck  (18.9s)
  PASS  tests @zilar/web  (54.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
None. All eight lines replaced; no files outside the Allowed list were touched.

## Review (written by Claude)

Approved (lead, 2026-10-06). All eight lines are StateMessage loading (six inline, two block) with the same texts. The follow-up (`approvals/AlwaysAllowedList.tsx:183` still has a plain Loading… line) goes into the next batch. Pre-review clean otherwise.
