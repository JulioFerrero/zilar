---
id: T-1491
title: "Mock seed: the AI DM with ai-dev-1 is titled 'Dev-1' (the AI's name, as a real AI DM is) instead of 'Dev AI'"
status: merged
milestone: M5
branch: task/T-1491-mock-dev-ai-title
model: auto
effort: default
depends_on: []
estimate: 0.02 day
---

# T-1491: Mock AI DM uses the AI's name

## Spec (written by Claude, do not edit)

### Why
In mock mode (web `?mock=1` and the mobile mock build), the DM with the AI `ai-dev-1` is titled "Dev AI", but the AI is named "Dev-1" everywhere else: topic owners, sender names, the AI list. A real AI DM shows the AI's own name, so the mock disagrees with itself and with production.

### Facts (the lead read them on main, 2026-10-15)
- `packages/mock-backend/src/domains/chats/seed.ts:48`: `{ kind: 'dm', chatJid: 'ai-dev-1@zilar.test', title: 'Dev AI', isAi: true },`
- `packages/mock-backend/src/data/people.ts:26`: `{ id: 'ai-dev-1', name: 'Dev-1', jid: 'ai-dev-1@zilar.test', kind: 'ai' },`
- No test or script matches the title "Dev AI". The only other hits are comments.

### What to build
1. In `packages/mock-backend/src/domains/chats/seed.ts:48`, change `title: 'Dev AI'` to `title: 'Dev-1'`. Nothing else changes.

### Tests
None (mock data).

### Allowed files
`packages/mock-backend/src/domains/chats/seed.ts`, `work/T-1491-mock-dev-ai-title.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Lead:** web `?mock=1` lists and opens the AI DM as "Dev-1".

---

## Report (written by the worker when done)

### What I did
Changed the mock seed so the AI DM with `ai-dev-1@zilar.test` is titled `Dev-1` (the AI's own name) instead of `Dev AI`.
- `packages/mock-backend/src/domains/chats/seed.ts:48`: `title: 'Dev AI'` → `title: 'Dev-1'`. No other change.

I grepped the repo for `Dev AI` to confirm nothing else is affected: the remaining hits are comments, docs, and other task files (none are the seed title, a test, or a script).

### Checks run
- `pnpm install` — succeeded (17 workspace projects, done in 11.4s).
- `pnpm gate` — `GATE PASS`. Summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS install (frozen) (1.1s)`, `PASS format (0.6s)`, `PASS lint (1.1s)`, `PASS typecheck (2.8s)`, `PASS effect (0.8s)`, `PASS tests @zilar/mock-backend (1.7s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: ...`, `size: ...`
  - `GATE PASS`
- No single test files were run; the spec says no tests (mock data), and the change touches no test file.

### Notes for the lead
- The two files the gate reports are `packages/mock-backend/src/domains/chats/seed.ts` and this task file (status/Docs edit), both under Allowed files.
- The AI's name and JID are unchanged (`packages/mock-backend/src/data/people.ts`: `ai-dev-1` / `Dev-1`); only the DM title now matches.
- Acceptance check (web `?mock=1` shows/opens the AI DM as "Dev-1") is the lead's; I did not run a browser.

### Blocked / needs a decision
None.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **The diff:** the one title at `packages/mock-backend/src/domains/chats/seed.ts:48`. The packet was clean (nit 0) for head `51add4bf4`.
- **Headless web `?mock=1`** (vite from this worktree): the sidebar has one "Dev-1" row and no "Dev AI"; the chat header reads "Dev-1"; the composer placeholder is "Message Dev-1"; there were no page errors.
