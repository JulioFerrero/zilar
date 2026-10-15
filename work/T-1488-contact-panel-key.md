---
id: T-1488
title: "Web: opening a DM's Contact info logs React's duplicate-key error: MessageList and ContactPanel are siblings keyed by the same chat id; prefix the panel's key"
status: merged
milestone: M5
branch: task/T-1488-contact-panel-key
model: auto
effort: default
depends_on: []
estimate: 0.02 day
---

# T-1488: Unique key for the contact panel

## Spec (written by Claude, do not edit)

### Why
In the lead's headless check (web mock, 1280 and 390 px, 2026-10-15), opening Marta's Contact info logs this at once:

"Encountered two children with the same key, `marta@zilar.test`"

Duplicate sibling keys can make React keep or drop the wrong element.

### Facts (the lead read them on main, 2026-10-15)
In `apps/web/src/routes/ChatView.tsx`, inside the same parent:
- `<MessageList key={chat.id} …>` (`:279-280`);
- `<ContactPanel key={contactChat.id} …>` (`:319-320`);
- `contactChat` is `chat` itself for a human DM (`:234`), so both keys are the chat id.

### What to build
1. Give the panel a distinct key, `` key={`contact:${contactChat.id}`} ``. It still remounts when the contact changes, which is why the key exists.
2. Nothing else changes.

### Tests
None.

### Allowed files
`apps/web/src/routes/ChatView.tsx`, `work/T-1488-contact-panel-key.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- In the lead's headless check, opening Marta's Contact info logs no duplicate-key error.

---

## Report (written by the worker when done)

### What I did
- `apps/web/src/routes/ChatView.tsx`: changed the `ContactPanel` key from `contactChat.id` to `` `contact:${contactChat.id}` `` (`:320`) so it no longer collides with the sibling `MessageList`'s `key={chat.id}` (`:280`). The panel still remounts when the contact changes. Nothing else changed.

### Files changed
- `apps/web/src/routes/ChatView.tsx`
- `work/T-1488-contact-panel-key.md`

### Commands and results
- `pnpm install`: done, 1137 packages resolved (10.7s).
- `pnpm gate` (from repo root), summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.8s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.4s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the spec says "Tests: None" and the change is UI-only, so the task's `Tests` section asked for none.

### Deviations / problems
None. Allowed files respected; the gate lists no files outside scope.

### Open questions
None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- **Headless check:** opening Marta's Contact info logs no duplicate-key error (main logs `marta@zilar.test` twice), and the sidebar still has one Marta row.
- **Also carried:** a lead note in `docs/LEAD_HANDOFF.md`. A merge deploys only after CI on main is green, so check CI when `/health` doesn't move.
