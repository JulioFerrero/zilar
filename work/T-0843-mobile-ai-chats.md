---
id: T-0843
title: "Mobile marks AI DMs as AI (isAi from /api/chats, as web does)"
status: merged
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

**What changed**
- `apps/mobile/src/lib/chat-api.ts`: `DmEntrySchema` gets `isAi: Schema.optional(Schema.Boolean)` (same as `apps/web/src/lib/api.ts:80`). The `ChatEntry` dm variant gets `isAi?: boolean`. The DM branch of `parseChatEntry` already passes the decoded fields through, so `isAi` reaches the entry.
- `apps/mobile/src/store/real-store.ts` (`summaryFor`): `isAI: entry.kind === 'dm' && entry.isAi === true`. The spec wrote `entry.isAi === true`; that does not typecheck on the union (groups have no `isAi`), so the `kind === 'dm'` guard was added. Web sets `isAI` for DMs only too (`chatRows.ts:57` sits in the dm branch), so behaviour matches.
- Tests first: `apps/mobile/src/store/real-store.test.ts` (new test: a DM with `isAi: true` gives `isAI: true`, a DM without it gives `false`), and `apps/mobile/src/lib/chat-api.test.ts` (new test: decodes `isAi` on DMs, absent on older payloads). Both failed before the change (2 failed, 92 passed in those two files) and pass after.

**Test counts** (Checks: `vitest run src/store src/lib/chat-api`)
- Before: 337 tests in the set (the 2 new ones were added to it), inferred from 339 minus the 2 added; I did not run the set before editing.
- After: 339 tests, 338 passed, 1 skipped (the skip was already there). 3 of 3 runs identical.
- `pnpm --filter @zilar/mobile typecheck`: clean (no output).
- `pnpm exec oxlint` on the 4 changed files: exit 0. Prettier run on the 4 files: unchanged.

**Measured numbers**: none asked for beyond the test counts.

**Behaviour differences**: a DM with `isAi: true` now shows as AI on mobile (AI badge, "writing…", working status). Human DMs and older servers without the field are unchanged (`false`). A non-boolean `isAi` on a DM now rejects that DM row (as on web, where the same schema applies); before, the field was ignored.

**Not done**: no live check on the phone (Julio's check per the Acceptance section). `pnpm gate` not run (wave mode).

**Unsure**: nothing in the code; the audit's line numbers were right (`real-store.ts:168`, `chat-api.ts` DM schema near line 18-33 of the old file, now at 158).

## Review (written by Claude)

**Lead, 2026-10-10: approved.** Mobile now takes `isAi` from `/api/chats`, as web does (`real-store.ts:168` hard-coded `isAI: false`). The UI reads it in 6+ places. The combined wave 3 check is clean and the phone smoke of the wave branch passes. Live check for Julio: an AI DM on mobile shows the AI marks.
