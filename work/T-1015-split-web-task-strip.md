---
id: T-1015
title: "Size split T99: apps/web/src/components/TaskStrip.tsx (442 lines) into components/topic/{stripModel,StatusMenu,OwnerMenu,LinkEditor}; one patchLocal"
status: merged
milestone: M5
branch: task/T-1015-split-web-task-strip
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1015: Split `TaskStrip.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/TaskStrip.tsx` is 442 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #95 (task T99). The new files go in a new `apps/web/src/components/topic/` folder: `stripModel.ts`, `StatusMenu.tsx`, `OwnerMenu.tsx` and `LinkEditor.tsx`. `TaskStrip.tsx` keeps the save wiring, the composition and every export it has today.

The in-file Dedup is in scope:
- the optimistic `setState(chats.map(...))` patch in `chooseStatus`, `chooseOwner` and `saveLink` becomes one `patchLocal(topic => …)`;
- the three "close all menus" lines become one helper.

The lead checks it in Chrome in mock mode: a topic's strip, changing its status and owner, and adding a link.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #95, and `apps/web/src/components/TaskStrip.tsx`.

### Allowed files
`apps/web/src/components/TaskStrip.tsx`, `apps/web/src/components/topic/stripModel.ts`, `apps/web/src/components/topic/StatusMenu.tsx`, `apps/web/src/components/topic/OwnerMenu.tsx`, `apps/web/src/components/topic/LinkEditor.tsx`, `work/T-1015-split-web-task-strip.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Followed `docs/audit/split-rules.md` and `size-plan.md` §2.2 #95. Split `apps/web/src/components/TaskStrip.tsx` (442 lines on main) into four files under the new `apps/web/src/components/topic/` folder, leaving `TaskStrip.tsx` as the thin barrel with the save wiring and the composition. Importers do not change: `ChatView.tsx` still does `import { TaskStrip } from '@/components/TaskStrip'`.

- `topic/stripModel.ts` — constants, labels, dots, `typeLabel`, `ownerLabel`, `httpsUrl`, `linkText`, and `ownerIdFor` (the last one moved here because only the owner picker used it; it is a pure helper).
- `topic/StatusMenu.tsx` — the status chip + menu, and the `chooseStatus` decision (close; no-op when the status is unchanged; otherwise call `onChange`).
- `topic/OwnerMenu.tsx` — the owner chip + picker, the `chooseOwner` decision, and the member/AI split (`isAiJid` filters, `ownerIdFor`).
- `topic/LinkEditor.tsx` — the link chip, the Edit/Add buttons, the URL + label form, and `saveLink` (https validation, trim, 40-char label cap).
- `TaskStrip.tsx` — state, `saveTopic`, the three `useAction`s, the link-form Escape effect, the optimistic patch/rollback and the composition.

**In-file dedup, both realized inside this task's files:**

- One `patchLocal(update)` replaces the three inline `storeApi.setState((state) => ({ chats: state.chats.map((entry) => entry.id === chat.id && entry.topic !== undefined ? {...entry, topic: ...} : entry) }))` patches. The main builds the patch; the menus call back with the new value (`applyStatus` / `applyOwner` / `applyLink` each build the `update` and go through one `commit(run, input, update)` that patches, clears the error and runs the save with `restore(previous)` as the rollback).
- One `toggleMenu(menu)` replaces the repeated `setStatusOpen(false)/setOwnerOpen(false)/setLinkOpen(false)` triples in the four open/close handlers: it toggles the named menu and closes the other two.
- The three `setError('')` before a save and the three `setStatusOpen(false)`/`setOwnerOpen(false)`/`setLinkOpen(false)` inside the choose/save handlers fold into `commit` and the per-menu `onClose`.

No behaviour change: same texts, same attributes, same optimistic-then-rollback order, same Esc handling for the link form (the status/owner menus still close through the kit `Menu`). No new dependency. `httpsUrl` is still exported from `TaskStrip.tsx` (re-export) so its public name is unchanged.

### Files changed (all inside Allowed files)

- `apps/web/src/components/TaskStrip.tsx` (edited)
- `apps/web/src/components/topic/stripModel.ts` (new)
- `apps/web/src/components/topic/StatusMenu.tsx` (new)
- `apps/web/src/components/topic/OwnerMenu.tsx` (new)
- `apps/web/src/components/topic/LinkEditor.tsx` (new)
- `work/T-1015-split-web-task-strip.md` (this report)

### Line counts (split-rules item 8)

```
main:  apps/web/src/components/TaskStrip.tsx           442
after: apps/web/src/components/TaskStrip.tsx           191
       apps/web/src/components/topic/stripModel.ts      95
       apps/web/src/components/topic/StatusMenu.tsx     64
       apps/web/src/components/topic/OwnerMenu.tsx      95
       apps/web/src/components/topic/LinkEditor.tsx    112
```

Every file is under the 400-line limit; no `max-lines` warning.

### Export list before and after

`grep -E "^export"` on the old file (main) vs the barrel plus the new files:

```
- export function httpsUrl(url: string | null | undefined): string | undefined {
- export function TaskStrip({ chat }: { chat: ChatSummary }) {

+ export function TaskStrip({ chat }: { chat: ChatSummary }) {
+ export { httpsUrl };
```

The barrel re-exports exactly the two names main exported (`TaskStrip`, value; `httpsUrl`, value). The new files export additional *internal* helpers (constants, `typeLabel`, `ownerLabel`, `linkText`, `ownerIdFor`, the three components) that main did not export before; that is additive and does not change any importer.

### Checks and commands actually run

- `pnpm install` → added 1172 packages, done in 19.8s (pre-existing peer warning on `@types/react-dom` in `apps/mobile`).
- `pnpm exec prettier --write` on the five changed source files (a targeted format of only my files, so the gate's `format` step would not fail).
- `pnpm --filter @zilar/web build` → `✓ built in 1.02s` (only the pre-existing >500 kB chunk-size warning).
- `pnpm gate` (from the repo root):

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.7s)
PASS  lint  (1.0s)
PASS  typecheck  (4.5s)
PASS  effect  (0.9s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

Single test files I ran while working: none. There is no `TaskStrip` test in `apps/web` (I checked), and the gate found no nearby test files, so it skipped the web tests. No test was added or edited.

### Effect ratchet (split-rules item 6)

No `// effect-plain:` marker was added and none is needed. `PASS effect` above. `stripModel.ts` imports `effect` as a value (Option/Schema), so the map classifies it `effect`; `StatusMenu.tsx`, `OwnerMenu.tsx` and `LinkEditor.tsx` carry no Effect/IO signal, so they classify `plain`; `TaskStrip.tsx` keeps its `effect` imports and stays `effect`. No marker appears in any new file.

### Deviations from the spec

- `ownerIdFor` moved to `stripModel.ts` instead of staying in the main. The plan's line ranges do not list it, but it is a pure helper that only the owner picker used, so it sits with the owner model; `OwnerMenu.tsx` imports it. Behaviour is unchanged.
- The plan lists `chooseStatus`/`chooseOwner`/`saveLink` with the menu/link files. I kept the decision logic (`StatusMenu.chooseStatus`, `OwnerMenu.chooseOwner`, `LinkEditor.saveLink`) in those files and left the optimistic patch, the `useAction` wiring and the rollback (`patchLocal`, `commit`, `restore`, `applyStatus`/`applyOwner`/`applyLink`) in the main, which is what "the main keeps save wiring" asks for. The dedup's single `patchLocal` and the single `toggleMenu` helper live in the main.
- `LinkEditor` receives the `linkUrl`/`linkLabel` input state as controlled props; the state itself stays in the main together with the save wiring, matching the original.

### Open questions / blocked

None. Nothing outside the Allowed files was touched; no decision needed.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `TaskStrip.tsx` (442 lines) is now 191 lines, plus `components/topic/{stripModel,StatusMenu,OwnerMenu,LinkEditor}`. One `patchLocal` replaces the three optimistic patches.
- **The nit:** `TopicOwner` is imported from two places. That is harmless.
- **The lead checked it in Chrome** (mock, Dev team › General):
  - Status › In progress updates the chip;
  - the owner menu lists No owner, You, Ana, Luis, Marco, Dev-1 (AI) and QA-1 (AI), and picking Dev-1 sets the owner;
  - Add link saves a URL, and the chip shows "github.com" with Edit.
- **Seen on main too:** after the owner save, the chip reads "Owner: An AI". It is the mock's label, not this split.
- **Check:** the gate passed, and so did the web build.
