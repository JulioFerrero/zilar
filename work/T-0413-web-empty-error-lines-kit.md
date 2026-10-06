---
id: T-0413
title: "Web kit: the Tools, Always-allowed and Approvals empty lines and the people search errors use StateMessage"
status: todo
milestone: M5
branch: task/T-0413-web-empty-error-lines-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0413: empty and error lines on StateMessage

## Spec (written by Claude, do not edit)

### Why
This is batch 9 of `docs/audit/ui-kit-leftovers.md`. `MessageSearchResults.tsx:149` is left out, because T-0411 is editing that file.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/state-message.tsx`:**
  - `StateMessage({ kind, title, hint?, icon?, action?, size? })`; `empty` uses `Inbox` by default, and `icon` overrides it;
  - `inline` renders `<div role={role} className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-muted-foreground">` with an icon and `<span>{title}</span>`, and its role is `alert` for `error`;
  - `block` is centred, with an icon, a title (`text-[14px] font-medium text-foreground`) and an optional hint.
- **The places:**
  - `apps/web/src/components/tools/ToolsSection.tsx:131-136`: `<p className="px-2 text-[13px] text-muted-foreground">No tools here yet. An AI can write small tools that run on a schedule — ask it in the chat.</p>`;
  - `apps/web/src/components/approvals/AlwaysAllowedList.tsx:194-196`: `<p className="text-[13px] text-muted-foreground">Nothing is always allowed here.</p>`;
  - `apps/web/src/routes/ApprovalsPage.tsx:266-269`: `<div className="flex flex-col items-center gap-3 py-10 text-center"><ShieldCheck className="size-8 …"/><p className="text-[15px] text-muted-foreground">Nothing is waiting for you.</p></div>`;
  - `apps/web/src/components/PeopleSearchResult.tsx:40-42`: `<p role="alert" className="px-[10px] pb-2 text-[13px] text-muted-foreground">Too many searches, try again in a few minutes.</p>`;
  - `apps/web/src/components/PeopleSearchResult.tsx:50-52`: the same, with "Could not search for that username.". Both sit under a "People" heading `<p>`.
- **Tests:**
  - `apps/web/src/components/tools/tools.test.tsx`;
  - `apps/web/src/components/approvals/AlwaysAllowedList.test.tsx`;
  - `apps/web/src/routes/ApprovalsPage.test.tsx`;
  - `apps/web/src/components/PeopleSearchResult.test.tsx`.

  Keep every text, and keep the alert role on the two errors.

### What to build
1. **ToolsSection:** `<StateMessage kind="empty" size="inline" title="No tools here yet. An AI can write small tools that run on a schedule — ask it in the chat." />`.
2. **AlwaysAllowedList:** `<StateMessage kind="empty" size="inline" title="Nothing is always allowed here." />`.
3. **ApprovalsPage:** `<StateMessage kind="empty" icon={ShieldCheck} title="Nothing is waiting for you." />`, replacing the whole centred div.
4. **PeopleSearchResult:** replace the two `<p role="alert">` lines with `<StateMessage kind="error" size="inline" title="…" />`, keeping the "People" headings.
5. Import `StateMessage` where it is missing. Drop imports only if they become unused.
6. Change no assertion. If a test matched the old exact markup, update only the query, and say so in the Report.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/state-message.tsx` and each file around its lines.

### Allowed files
`apps/web/src/components/tools/ToolsSection.tsx`, `apps/web/src/components/approvals/AlwaysAllowedList.tsx`, `apps/web/src/routes/ApprovalsPage.tsx`, `apps/web/src/components/PeopleSearchResult.tsx`, `apps/web/src/components/tools/tools.test.tsx`, `apps/web/src/components/approvals/AlwaysAllowedList.test.tsx`, `apps/web/src/routes/ApprovalsPage.test.tsx`, `apps/web/src/components/PeopleSearchResult.test.tsx`, `work/T-0413-web-empty-error-lines-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot tools AlwaysAllowedList ApprovalsPage PeopleSearchResult
pnpm gate
```

### Acceptance
- The five lines are `StateMessage`s with the same texts; the errors keep the alert role.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
