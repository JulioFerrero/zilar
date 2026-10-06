---
id: T-0411
title: "Web kit: the tool Run input, the sign-in email field and two empty lines use TextArea, TextInput and StateMessage"
status: merged
milestone: M5
branch: task/T-0411-web-fields-empty-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0411: last web fields and empty lines on the kit

## Spec (written by Claude, do not edit)

### Why
These rows come from `docs/audit/ui-kit-leftovers.md` (batches 8 and 10). The lead checked the other rows of those batches and keeps them raw:
- the folder-name row, which has an inline counter in a card;
- the chat SearchBar, which has a scope chip and a ⌘K hint inside the well;
- the PinsPanel subtitle, which is a count line, not an empty state;
- EmptyState, which has two actions.

### Verified facts (do not re-derive)
- **`apps/web/src/components/tools/ToolDetailPanel.tsx:312-319`:** `<textarea aria-label="Run input (JSON)" rows={3} value={runInput} onChange={(event) => setRunInput(event.target.value)} placeholder='e.g. {"city": "Madrid"}' className="well-surface min-w-0 rounded-[10px] px-3 py-2 font-mono text-[13px] …" />`. It sits inside a `<label>` whose visible span reads "Optional JSON input (max 4 KB)" (lines 308-311).
- **`apps/web/src/components/auth/AuthFlow.tsx:133-145`:** `<label className="text-[14px] font-medium" htmlFor="auth-email">Email</label>` followed by `<input id="auth-email" type="email" autoComplete="email" value={email} onChange=… placeholder="you@example.com" className="rounded-lg border border-input bg-background px-3 py-2 …" />`.
- **`apps/web/src/components/MessageList.tsx:200-204`:** `<div className="chat-background flex h-full items-center justify-center p-8 text-center"><p className="text-[15px] text-muted-foreground">No messages yet</p></div>`.
- **`apps/web/src/components/MessageSearchResults.tsx:97-101`:** under the "Messages" heading, `<p className="px-[10px] pb-2 text-[13px] text-muted-foreground">No messages found</p>`.
- **`apps/web/src/components/ui/text-input.tsx`:**
  - `TextInput` (with `label`, `hint`, `id`, `className`) and `TextArea` (line 152; the same props; base `FIELD_INPUT` + `min-h-20`; `cn` merges `className`);
  - with a `label`, both render a `Field` (a label above the input) and use the given `id`.
- **`apps/web/src/components/ui/state-message.tsx`:** `StateMessage({ kind: 'empty' | 'loading' | 'error', title, hint?, icon?, action?, size?: 'block' | 'inline' })`. `empty` uses the `Inbox` icon.
- **Tests:**
  - `apps/web/src/components/tools/tools.test.tsx` (it types into "Run input (JSON)");
  - `apps/web/src/components/auth/AuthFlow.test.tsx`;
  - `apps/web/src/routes/SetupPage.test.tsx`;
  - `apps/web/src/components/MessageList.test.tsx`;
  - `apps/web/src/routes/ChatView.test.tsx`;
  - `apps/web/src/components/MessageSearch.test.tsx`.

### What to build
1. **ToolDetailPanel:** replace the `<textarea>` with `<TextArea aria-label="Run input (JSON)" rows={3} … className="min-h-0 font-mono text-[13px]" />`. Keep the outer `<label>` and its visible span, and keep the value, handler and placeholder.
2. **AuthFlow:**
   - replace the `<label>` + `<input>` pair with `<TextInput id="auth-email" label="Email" type="email" autoComplete="email" value={email} onChange=… placeholder="you@example.com" />`;
   - if a test finds the field by its label text "Email", it keeps working, because `Field` renders a real `<label for>`;
   - keep the `gap-3` form layout.
3. **MessageList:** inside the same `chat-background` wrapper, replace the `<p>` with `<StateMessage kind="empty" title="No messages yet" />`.
4. **MessageSearchResults:** replace the `<p>` with `<StateMessage kind="empty" size="inline" title="No messages found" />`, keeping the "Messages" heading.
5. Import the kit pieces where they are missing.
6. Change no assertion. If a test matched the old exact markup, update only the query, and say so in the Report.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/text-input.tsx`, `apps/web/src/components/ui/state-message.tsx`, and each file around its lines.

### Allowed files
`apps/web/src/components/tools/ToolDetailPanel.tsx`, `apps/web/src/components/auth/AuthFlow.tsx`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/MessageSearchResults.tsx`, `apps/web/src/components/tools/tools.test.tsx`, `apps/web/src/components/auth/AuthFlow.test.tsx`, `apps/web/src/routes/SetupPage.test.tsx`, `apps/web/src/components/MessageList.test.tsx`, `apps/web/src/routes/ChatView.test.tsx`, `apps/web/src/components/MessageSearch.test.tsx`, `work/T-0411-web-fields-empty-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot tools AuthFlow SetupPage MessageList ChatView MessageSearch
pnpm gate
```

### Acceptance
- The four places use the kit, with the same labels, texts and handlers.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- **`ToolDetailPanel.tsx`:** replaced the raw `<textarea>` in the "Run now" label with `<TextArea aria-label="Run input (JSON)" rows={3} … className="min-h-0 font-mono text-[13px]" />`. Kept the outer `<label>` and its visible span, and kept value, handler and placeholder. Added `import { TextArea } from '@/components/ui/text-input';`.
- **`AuthFlow.tsx`:** replaced the `<label htmlFor="auth-email">` + `<input>` pair with `<TextInput id="auth-email" label="Email" type="email" autoComplete="email" value={email} onChange=… placeholder="you@example.com" />`. The `gap-3` form layout is unchanged. Added `import { TextInput } from '@/components/ui/text-input';`.
- **`MessageList.tsx`:** inside the same `chat-background` wrapper, replaced `<p>No messages yet</p>` with `<StateMessage kind="empty" title="No messages yet" />`. `StateMessage` was already imported.
- **`MessageSearchResults.tsx`:** kept the "Messages" heading and replaced `<p>No messages found</p>` with `<StateMessage kind="empty" size="inline" title="No messages found" />`. `StateMessage` was already imported.
- No test assertion was changed. All existing queries still resolve because the kit preserves the accessible names: `getByLabelText('Run input (JSON)')` (aria-label kept), `getByLabelText('Email')` (`Field` renders a real `<label htmlFor>` linked to `id="auth-email"`), and `getByText('No messages yet')` / `getByText('No messages found')` (the title text is still rendered).

### Files changed
- `apps/web/src/components/tools/ToolDetailPanel.tsx`
- `apps/web/src/components/auth/AuthFlow.tsx`
- `apps/web/src/components/MessageList.tsx`
- `apps/web/src/components/MessageSearchResults.tsx`
- `work/T-0411-web-fields-empty-kit.md`

### Commands and real results
- `pnpm install`: Done in 13.2s (1170 packages, no changes to the lockfile; pre-existing peer-dependency warning for `apps/mobile`).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot tools AuthFlow SetupPage MessageList ChatView MessageSearch`: 9 test files passed, 94 tests passed, 6.66s.
- `pnpm gate` (repo root): summary lines —
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)  (1.1s)`
  - `PASS  format  (21.5s)`
  - `PASS  lint  (1.2s)`
  - `PASS  typecheck  (12.2s)`
  - `PASS  tests @zilar/web  (46.5s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Deviations / open questions
- None. Every place uses the kit with the same labels, texts and handlers.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean.
- The Run input is `TextArea` (mono).
- The sign-in email is `TextInput` with the label "Email", keeping `id="auth-email"`.
- The two empty lines are `StateMessage`s.
