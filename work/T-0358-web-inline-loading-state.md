---
id: T-0358
title: "Web kit: StateMessage gets an inline size; the panel \"Loading…\" lines use it"
status: todo
milestone: M5
branch: task/T-0358-web-inline-loading-state
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0358: inline loading state

## Spec (written by Claude, do not edit)

### Why
The kit `StateMessage` is a large centred block (`py-10`). Side panels and small lists still write a plain `<p>Loading…</p>`. That text has no `role="status"` and no spinner, and each copy is styled differently.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/state-message.tsx`:**
  - props `kind: 'empty' | 'loading' | 'error'`, `title`, `hint?`, `icon?`, `action?`;
  - it renders `role="status"` for loading (`role="alert"` for error);
  - the wrapper is `flex flex-col items-center gap-2 px-6 py-10 text-center`;
  - loading shows a `Loader2` spinner (`size-5 animate-spin`).
- **The plain loading lines to migrate:**
  - `apps/web/src/components/GroupPanel.tsx:295`: `{info === undefined && <p className="text-[15px] text-muted-foreground">Loading…</p>}`
  - `apps/web/src/components/GroupPanel.tsx:675`: `<p className="px-2 text-[13px] text-muted-foreground">Loading…</p>`
  - `apps/web/src/components/TopicPanel.tsx:423`, `:592` and `:968`: the same `px-2 text-[13px]` line
  - `apps/web/src/components/ChannelPanel.tsx:298`: the same as GroupPanel 295
  - `apps/web/src/components/ChannelPanel.tsx:358`: the `px-2 text-[13px]` line
  - `apps/web/src/components/tools/ToolsSection.tsx:117`: the `px-2 text-[13px]` line

  The two lines in `StickersPage.tsx` (549, 606) are left for later, because T-0357 edits that file in parallel.
- **Tests:** they may query the text "Loading…". Keep that exact title so `getByText('Loading…')` still matches.

### What to build
1. **Add `size?: 'block' | 'inline'` to `StateMessage`** (default `'block'`, unchanged). `inline` renders:
   - a left-aligned row: `flex items-center gap-2 px-2 py-1.5 text-[13px] text-muted-foreground`;
   - the same spinner at `size-3.5` for loading, and the same role;
   - the title only (no hint or action).
2. Add an `Inline` state to `apps/web/src/components/ui/state-message.fixture.tsx`.
3. Add a test in a new file `apps/web/src/components/ui/state-message.test.tsx` (not `kit.test.tsx`, which T-0357 edits in parallel): `size="inline"` loading has `role="status"`, shows the title and keeps no `py-10`.
4. Replace the eight lines above with `<StateMessage kind="loading" size="inline" title="Loading…" />`. Keep the surrounding conditions (`info === undefined && …`).
5. If a test fails only because of the new markup, update the query and keep the assertion.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/state-message.tsx`, `apps/web/src/components/ui/state-message.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx` (for the test style) and the eight lines above in context.

### Allowed files
`apps/web/src/components/ui/state-message.tsx`, `apps/web/src/components/ui/state-message.fixture.tsx`, `apps/web/src/components/ui/state-message.test.tsx`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/TopicPanel.tsx`, `apps/web/src/components/ChannelPanel.tsx`, `apps/web/src/components/tools/ToolsSection.tsx`, `apps/web/src/components/GroupPanel.test.tsx`, `apps/web/src/components/TopicPanel.test.tsx`, `apps/web/src/components/Channels.test.tsx`, `work/T-0358-web-inline-loading-state.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot state-message GroupPanel TopicPanel Channels ToolsSection
pnpm gate
```

### Acceptance
- The eight lines use `StateMessage` `size="inline"`.
- The block size is unchanged.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
