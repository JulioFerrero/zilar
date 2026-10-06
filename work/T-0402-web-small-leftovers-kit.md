---
id: T-0402
title: "Web kit: Always-allowed loading, folder editor Remove chat, channel Mute and code block Show all use the kit"
status: merged
milestone: M5
branch: task/T-0402-web-small-leftovers-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0402: small web leftovers on the kit

## Spec (written by Claude, do not edit)

### Why
These are the last scattered hand-rolled pieces. The first was found by the T-0394 pre-review.

### Verified facts (do not re-derive)
- **Kit:**
  - `apps/web/src/components/ui/state-message.tsx`: `size="inline"`, `kind="loading"`;
  - `apps/web/src/components/ui/button.tsx`: `ghost`, sizes `sm` and `icon-sm`, and `cn` merges `className`.
- **The pieces:**

| File | Line | Today | Kit |
| --- | --- | --- | --- |
| `apps/web/src/components/approvals/AlwaysAllowedList.tsx` | 182-186 | `<p role="status" className="text-[13px] text-muted-foreground">Loading…</p>` | `<StateMessage kind="loading" size="inline" title="Loading…" />` |
| `apps/web/src/components/FolderEditorDialog.tsx` | 376 | `<button aria-label={`Remove ${chat.title}`} title=… onClick={() => onToggle(chat.id)} className="flex shrink-0 … rounded-full p-1 hover:bg-list-hover hover:text-foreground">` with an `X` (h-4 w-4) | `<Button type="button" variant="ghost" size="icon-sm" className="shrink-0 rounded-full" …>` |
| `apps/web/src/components/ChannelComposerBar.tsx` | 65 | `<button disabled={busy} onClick={() => void toggleMute()} className="shrink-0 rounded-full px-4 py-1.5 text-[14px] font-medium text-foreground hover:bg-list-hover disabled:opacity-60">{chat.muted ? 'Unmute' : 'Mute'}</button>` | `<Button type="button" variant="ghost" className="shrink-0" …>` |
| `apps/web/src/components/tools/CodeBlock.tsx` | 55 | `<button onClick={() => setExpanded(...)} className="self-start rounded-full px-2 py-1 text-[13px] text-muted-foreground hover:bg-list-hover …">{expanded ? 'Show less' : 'Show all'}</button>` | `<Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground" …>` |

- **Imports:**
  - `AlwaysAllowedList.tsx:11` imports `Button, FieldError` from `@/components/ais/AiPageShell`;
  - `ChannelComposerBar.tsx` and `CodeBlock.tsx` do not import `Button` (CodeBlock imports only `useState`);
  - `FolderEditorDialog.tsx` imports `Button` (since T-0365).
- **Tests:**
  - `apps/web/src/components/approvals/AlwaysAllowedList.test.tsx`;
  - `apps/web/src/components/FolderEditorDialog.test.tsx`;
  - `apps/web/src/components/tools/tools.test.tsx`;
  - `apps/web/src/routes/ChatView.test.tsx` (it renders `ChannelComposerBar`).

  Keep every text, label and handler.

### What to build
1. Apply the table.
2. Import `StateMessage` and `Button` (from `@/components/ui/…`) where missing.

### Read first
`AGENTS.md`, the two kit files and each file around its line.

### Allowed files
`apps/web/src/components/approvals/AlwaysAllowedList.tsx`, `apps/web/src/components/FolderEditorDialog.tsx`, `apps/web/src/components/ChannelComposerBar.tsx`, `apps/web/src/components/tools/CodeBlock.tsx`, `apps/web/src/components/approvals/AlwaysAllowedList.test.tsx`, `apps/web/src/components/FolderEditorDialog.test.tsx`, `apps/web/src/components/tools/tools.test.tsx`, `apps/web/src/routes/ChatView.test.tsx`, `work/T-0402-web-small-leftovers-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AlwaysAllowedList FolderEditorDialog tools ChatView
pnpm gate
```

### Acceptance
- The four pieces are on the kit.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Applied the four kit swaps exactly as in the spec table, keeping every text, label and handler:

1. `AlwaysAllowedList.tsx`: the loading `<p role="status" …>Loading…</p>` is now `<StateMessage kind="loading" size="inline" title="Loading…" />`. Added `import { StateMessage } from '@/components/ui/state-message';`. The existing `Button` (re-exported from `@/components/ais/AiPageShell`, which re-exports `@/components/ui/button`) was left as is; only `StateMessage` was missing.
2. `FolderEditorDialog.tsx`: the hand-rolled Remove button is now `<Button type="button" variant="ghost" size="icon-sm" className="shrink-0 rounded-full" …>` keeping `aria-label`, `title`, `onClick` and the `X` icon. `Button` was already imported from `./ui/button`.
3. `ChannelComposerBar.tsx`: the Mute/Unmute `<button>` is now `<Button type="button" variant="ghost" className="shrink-0" disabled={busy} onClick={() => void toggleMute()}>`. Added `import { Button } from '@/components/ui/button';`. Label text and `disabled` behaviour kept.
4. `CodeBlock.tsx` (`TruncatedText`): the Show all/Show less `<button>` is now `<Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground" …>`. Added `import { Button } from '@/components/ui/button';`.

### Files changed (5)
- `apps/web/src/components/approvals/AlwaysAllowedList.tsx`
- `apps/web/src/components/FolderEditorDialog.tsx`
- `apps/web/src/components/ChannelComposerBar.tsx`
- `apps/web/src/components/tools/CodeBlock.tsx`
- `work/T-0402-web-small-leftovers-kit.md`

No test files needed changes: all assertions query by role/accessible name, which the kit components preserve.

### Commands and real results
- `pnpm install`: exit 0, "Done in 15.1s". One pre-existing peer-dependency warning in `apps/mobile` (`@types/react-dom 19.3.0` wants `@types/react ^19.3.0`, found `19.2.18`) — unrelated to this task and outside scope.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AlwaysAllowedList FolderEditorDialog tools ChatView`: exit 0 — `Test Files 6 passed (6)`, `Tests 60 passed (60)` (6.68s).
- `pnpm gate` (repo root): exit 0. Summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (20.4s)
  PASS  lint  (2.0s)
  PASS  typecheck  (28.2s)
  PASS  tests @zilar/web  (109.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec
None.

### Problems
None.

### Blocked / needs a decision
None.

### Open questions
None.

### Security checklist
Not applicable: presentation-only refactor, no data, logging, auth, routes or deletes touched.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean. All four pieces are on the kit, as the table asked:
- the inline loading line is a StateMessage;
- the Remove chat button is ghost `icon-sm`;
- Mute is a ghost Button;
- Show all is ghost `sm`.

The texts, labels and handlers are kept.
