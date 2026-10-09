---
id: T-0843
title: "Mobile marks AI DMs as AI (isAi from /api/chats, as web does)"
status: todo
milestone: M5
branch: task/T-0843-mobile-ai-chats
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0843: Mobile marks AI DMs as AI (isAi from /api/chats, as web does)

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Drift bug A-F1a in `docs/audit/simplify-2026-10-09/A-web-mobile.md`, verified by the lead.
- **Mobile:** `apps/mobile/src/store/real-store.ts:168` (`summaryFor`) always sets `isAI: false`, and `ChatEntry` in `apps/mobile/src/lib/chat-api.ts` (about line 18-33) has no `isAi` field.
- **Web:** reads `isAI: entry.isAi === true` (`apps/web/src/store/effects/chatRows.ts:57`), and its schema has `isAi` (`apps/web/src/lib/api.ts`, about line 80).
- **Effect:** mobile UI reads `chat.isAI` in `chat-header.tsx`, `topic-row.tsx`, `chat-list-item.tsx` and `forward-sheet.tsx`, so on real data AI chats show no AI badge, no "writing…" line and no working status.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Add the optional `isAi` field to the mobile `ChatEntry` schema/interface, exactly as the web schema declares it (optional, so older servers still decode).
2. In `summaryFor`, set `isAI: entry.isAi === true`.
3. **Tests first:** in the existing `apps/mobile/src/store/real-store.test.ts` (or the nearest store test that seeds `/api/chats` entries), add a test that a roster entry with `isAi: true` gives a chat summary with `isAI: true`, and one without the field gives `false`. Add a decode test in the chat-api test for the new field.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/mobile/src/lib/chat-api.ts`, `apps/mobile/src/lib/chat-api.test.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/real-store*.test.ts`, `apps/mobile/src/store/effects/*.test.ts`, `work/T-0843-mobile-ai-chats.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store src/lib/chat-api
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: Julio sees the AI badge and "writing…" on an AI chat on the phone.

---

## Report (written by the worker when done)

## Review (written by Claude)
