---
id: T-1165
title: "AI-6: the AI's context applies edits and deletes before it is cut to 50 — a correction replaces its target's text, a retracted message is dropped, and the AI's own progress messages are not turns"
status: merged
milestone: M5
branch: task/T-1165-ai-context-edits
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1165: Edits and deletes leave the AI's context

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ai-features-audit.md` AI-6 (P1, confirmed). It's a privacy bug: someone pastes a secret in a group, deletes it, then mentions the AI, and the AI can quote the secret back.
- **What happens:** `toTurn` and `toGroupTurn` (`apps/server/src/agents/context.ts:172-207`) map every history item with a body.
  - DM context is built at `:268-276`, group context at `:222-230` (`history.slice(-DM_HISTORY_MESSAGE_LIMIT)`).
  - A correction keeps its new body, so an edited message appears twice.
  - A retracted original stays: only the retraction's own fallback body is dropped.
  - The AI's own progress messages (`apps/server/src/agents/gateway/live.ts:88`, payload `type: 'progress'`) come back as assistant turns.
- **How the indexer already does it:** it applies both edits (`apps/server/src/agents/memory/indexer.ts:229-254`).
- **The message shape** (`packages/xmpp-core/src/types.ts:43-112`):
  - `id` is the stanza-id when known, else the message id;
  - `originId` is the sender's id;
  - `correction?.targetId` is the target's **origin id**;
  - `retraction?.targetId` is the origin id in DMs and the **stanza-id** in groups;
  - `payload?.type` holds the payload type.

### What to build
1. **A new `apps/server/src/agents/context-edits.ts`** exporting `applyEdits(history: ChatMessage[]): ChatMessage[]`. It is pure, keeps the order, and makes these changes:
   - **a correction:** replace the body of the item whose `originId` (or `id`) equals `correction.targetId` with the correction's body, then drop the correction item itself. A correction with no target in the list is dropped;
   - **a retraction:** drop the item whose `id` or `originId` equals `retraction.targetId`, and drop the retraction item;
   - **a progress payload:** drop any item whose `payload?.type === 'progress'`.
2. **In `context.ts`,** call `applyEdits(input.history)` **before** both `slice(-DM_HISTORY_MESSAGE_LIMIT)` calls (`:222` and `:268`). That is the only change in that file (it is 293 lines).
3. **Tests** (the message pipeline; this is a privacy rule), at most 3, in a new `apps/server/src/agents/context-edits.test.ts`:
   - a corrected message appears once, with the new text;
   - a retracted message is gone, in both DM (origin-id target) and group (stanza-id target) shape;
   - a progress message is gone.

### Read first
`AGENTS.md`, `docs/audit/ai-features-audit.md` (AI-6), `apps/server/src/agents/context.ts`, `packages/xmpp-core/src/types.ts:43-112` and `apps/server/src/agents/memory/indexer.ts:220-256`.

### Allowed files
`apps/server/src/agents/context-edits.ts`, `apps/server/src/agents/context-edits.test.ts`, `apps/server/src/agents/context.ts`, `work/T-1165-ai-context-edits.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/context-edits.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- `context.ts` stays at most 400 lines.

---

## Report (written by the worker when done)

### What I did
- Added `apps/server/src/agents/context-edits.ts` with a pure, order-preserving `applyEdits(history: ChatMessage[]): ChatMessage[]`:
  - a correction replaces the body of the item matched by `originId` (falling back to `id`) against `correction.targetId`, then the correction item is dropped; a correction with no target is dropped too (the whole loop drops every item carrying `correction`);
  - a retraction drops the item matched by `id` or `originId` against `retraction.targetId`, and drops the retraction item; this covers both shapes named in the spec (origin id in DMs, stanza-id in groups);
  - any item whose `payload?.type === 'progress'` is dropped.
- In `apps/server/src/agents/context.ts` I imported `applyEdits` and called it once per builder, immediately before each `slice(-DM_HISTORY_MESSAGE_LIMIT)`: line 222 in `buildGroupMessages` and line 268 in `buildDmMessages`. That is the only change to that file (294 lines, under the 400 limit).
- Added `apps/server/src/agents/context-edits.test.ts` with 3 tests (the message pipeline / privacy rule).

### Files changed
- `apps/server/src/agents/context-edits.ts` (new)
- `apps/server/src/agents/context-edits.test.ts` (new)
- `apps/server/src/agents/context.ts` (import + 2 call sites)
- `work/T-1165-ai-context-edits.md` (status + this report)

### Commands and results
- `pnpm --filter @zilar/server exec vitest run src/agents/context-edits.test.ts --maxWorkers=2 --reporter=dot`: `Test Files 1 passed (1)`, `Tests 3 passed (3)`.
- `pnpm gate` (first run): `FAIL format` on `context-edits.ts` (Prettier style), everything before it passed. I ran `pnpm exec prettier --write apps/server/src/agents/context-edits.ts` to fix the style.
- `pnpm gate` (second run):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.9s)
  PASS  effect  (1.6s)
  PASS  tests @zilar/server  (3.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The 4 changed files are the ones listed above; none is outside the Allowed files.

### Deviations from the spec
None. `applyEdits` is pure and keeps order; the correction/retraction/progress rules match the spec exactly.

### Notes
- The task lists "Read first" including `docs/audit/ai-features-audit.md` AI-6 and the message shape; both were read. The indexer's treatment (`memory/indexer.ts:231-254`) was read as the reference for matching semantics (correction by origin id, retraction by origin id in DMs / stanza-id in groups).
- Security checklist: this change only removes text from in-memory AI context; it adds no route, no write, no log line and no secret. It reduces the chance that a retracted secret reaches a model.
- Open questions: none.

### Round: pre-review fix (should-fix 1)
- **Findings fixed:**
  - PREREVIEW finding 1 (should-fix): a correction with a valid target but no usable `body` used to be dropped while its target kept the pre-edit text (e.g. the secret `o-1`). `applyEdits` now collects every correction target separately (`correctionTargets`) and, when a target's correction carries no usable body, drops the target instead of keeping it verbatim.
- **Tests added/changed:** extended the existing correction test in `apps/server/src/agents/context-edits.test.ts` with a bodiless-correction scenario (`s-3` corrects `o-1` with no body → `s-1` is dropped; only `s-2` survives). Test count stays at the spec's 3.
- **Gate result:** `pnpm gate` → GATE PASS (install, format, lint, typecheck, effect, tests @zilar/server); 4 changed files, all in Allowed files.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Clean after 1 auto round.**
- **`applyEdits`** (pure, order kept):
  - a correction replaces its target's body, matching on the origin id or the id; the correction item itself is dropped;
  - a retraction drops its target, matching on the origin id or the id (stanza-id), and the retraction item itself;
  - `progress` payloads are dropped.
- **`context.ts`:** applied before both `slice(-50)` calls.
- **Edge case, accepted:** a correction with no string body drops its target. That's the safer side.
- **Tests:** 3 of 3 in the branch, run by the lead.
