---
id: T-1671
title: "Size split: move GroupHeaderRow (the collapsible group header with its nested topics) out of apps/web/src/components/TopicRow.tsx (398 lines) into apps/web/src/components/chatList/GroupHeaderRow.tsx — a pure move, no logic or markup change"
status: merged
milestone: M5
branch: task/T-1671-split-topic-row
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1671: Split GroupHeaderRow out of TopicRow.tsx

## Spec (written by Claude, do not edit)

### Why
`apps/web/src/components/TopicRow.tsx` is 398 of the 400 allowed lines, so the next change to a topic row can't land. It holds two components; the second one moves out.

### Facts (the lead read them on 2026-10-16)
- **`apps/web/src/components/TopicRow.tsx`** (398 lines): `rowPreview` (`:56`), `export function TopicRow` (`:74-221`), then the doc comment (`:223-229`) and `export const GroupHeaderRow = memo(function GroupHeaderRow({…` (`:231-…`) to the end of the file.
- **The only outside importer of `GroupHeaderRow`** is `apps/web/src/components/chatList/ChatListBody.tsx:6` (`import { GroupHeaderRow } from '../TopicRow';`).
- **The folder `apps/web/src/components/chatList/`** holds `ChatListBody.tsx`, `ChatListMenu.tsx`, `ContactRequestsRow.tsx`, `RequestRows.tsx` and `rowsSelector.ts`. There's no `GroupHeaderRow.tsx`.

### Steps
1. **Create `apps/web/src/components/chatList/GroupHeaderRow.tsx`** and move the doc comment plus `GroupHeaderRow` there **word for word**, with the imports it needs. Fix relative paths (it now lives one folder down). If it uses `TopicRow`, import it from `../TopicRow`.
2. **In `TopicRow.tsx`:** remove the moved code and drop the imports that are no longer used.
3. **`ChatListBody.tsx`** imports `GroupHeaderRow` from `./GroupHeaderRow`.
4. **No other change, no tests.**

### Allowed files
- `apps/web/src/components/chatList/GroupHeaderRow.tsx`
- `apps/web/src/components/TopicRow.tsx`
- `apps/web/src/components/chatList/ChatListBody.tsx`
- `work/T-1671-split-topic-row.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`TopicRow.tsx` is about 230 lines,** and the new file holds `GroupHeaderRow` unchanged.
- **The web build and typecheck pass.**

---

## Report (written by the worker when done)

### What I did

- Created `apps/web/src/components/chatList/GroupHeaderRow.tsx` with the doc comment and
  `GroupHeaderRow` moved word for word from `TopicRow.tsx`, plus only the imports it needs:
  `formatListTime`/`ChatSummary` (`@zilar/chat-core`), `ChevronDown`/`ChevronRight`/`Plus`
  (`lucide-react`), `memo` (`react`), `cn` (`@/lib/utils`), `EntityAvatar` (`../EntityAvatar`),
  `TopicRow` (`../TopicRow`), `Badge`/`Button` (`../ui/…`). Relative paths fixed for the
  one-folder-down location.
- In `apps/web/src/components/TopicRow.tsx` removed the moved comment + component and the
  imports that became unused (`ChevronDown`, `ChevronRight`, `Plus`, `memo`, `EntityAvatar`).
  File went from 398 to 218 lines.
- In `apps/web/src/components/chatList/ChatListBody.tsx` changed the import to
  `import { GroupHeaderRow } from './GroupHeaderRow';`.
- No logic or markup change; no other files touched.

### Checks run

- `pnpm install` — Done in 16.7s (frozen lockfile install succeeded).
- `pnpm gate` (from repo root), summary lines:

  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (1.4s)
  PASS  lint  (1.3s)
  PASS  typecheck  (6.3s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- No single test file was run: this is UI-only code with no nearby test files (the gate also
  skipped `@zilar/web` tests for the same reason).

### Notes for the lead

- `TopicRow.tsx` is 218 lines (spec said "about 230"); the new `GroupHeaderRow.tsx` is 184.
- The only outside importer, `ChatListBody.tsx`, was updated as specified; no other importer
  of `GroupHeaderRow` exists (grepped the repo).
- Gate lists only the 4 files in the Allowed set, so no worker outside this task's scope is
  affected.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the removed block and the new `chatList/GroupHeaderRow.tsx` body are identical apart from imports.
- **Result:** `TopicRow.tsx` drops from 398 to 218 lines.
