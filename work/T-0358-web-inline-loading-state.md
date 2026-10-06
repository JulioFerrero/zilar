---
id: T-0358
title: "Web kit: StateMessage gets an inline size; the panel \"Loading…\" lines use it"
status: merged
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

Did it: added `size?: 'block' | 'inline'` to `StateMessage` (default `'block'`, block markup unchanged). `inline` renders a left-aligned row (`flex items-center gap-2 px-2 py-1.5 text-[13px] text-muted-foreground`), title only, same `role` mapping (`status` for loading, `alert` for error), spinner at `size-3.5` for loading. Added `Inline` fixture and new `state-message.test.tsx` (inline loading has `role="status"`, shows the title, wrapper has no `py-10`). Replaced all eight plain `<p>Loading…</p>` lines (GroupPanel x2, TopicPanel x3, ChannelPanel x2, ToolsSection x1) with `<StateMessage kind="loading" size="inline" title="Loading…" />`, keeping the surrounding conditions; added the `StateMessage` import to each of the four files.

Files changed: `apps/web/src/components/ui/state-message.tsx`, `apps/web/src/components/ui/state-message.fixture.tsx`, `apps/web/src/components/ui/state-message.test.tsx` (new), `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/TopicPanel.tsx`, `apps/web/src/components/ChannelPanel.tsx`, `apps/web/src/components/tools/ToolsSection.tsx`, plus this task file.

Commands (real results):
- `pnpm install`: exit 0, done in 12.7s.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot state-message GroupPanel TopicPanel Channels ToolsSection`: 4 files, 58 tests, all passed.
- `pnpm gate` (first run): FAIL on format (prettier flagged ToolsSection.tsx, state-message.test.tsx, state-message.tsx); fixed with `pnpm exec prettier --write` on those three files only.
- `pnpm gate` (final): `PASS install`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/web`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

Deviations: none. The inline branch renders non-loading kinds with the same row layout (spinner slot swaps to the kind icon); only loading is used by the spec. No test queries needed updating (`getByText('Loading…')` still matches; GroupPanel/TopicPanel/Channels test files contain no `Loading` assertions).
Security checklist: no secrets, no deletes/updates, no caps, no permissions, no new routes, no audit entries; change is presentational only.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). `StateMessage` has `size="inline"`: a left-aligned row with a `size-3.5` spinner and the same `role`. The block size is unchanged. The eight panel lines use it, and the lead grep found no plain `Loading…</p>` left in those four files. It has a new test and fixture. The two StickersPage lines stay for a later task.
