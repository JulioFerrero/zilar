---
id: T-0876
title: "chat-core gets chat prefs, routines formatting and the AI form logic (limits, templates, models, errors, activity format)"
status: todo
milestone: M5
branch: task/T-0876-chat-core-prefs-routines-ai
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0876: chat-core gets chat prefs, routines formatting and the AI form logic (limits, templates, models, errors, activity format)

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Findings A-F3 and G-F4 in `docs/audit/simplify-2026-10-09/`. Whole files are copied between the apps:
- **Chat prefs:** `applyChatPrefs` and `mutedUntilFor` (`apps/web/src/lib/chatPrefs.ts:53,19` = `apps/mobile/src/lib/chat-prefs.ts:61,27`).
- **Routines:** routines formatting (`apps/web/src/lib/routines.ts:25-130` = `apps/mobile/src/lib/routines-format.ts:26-131`).
- **AI form logic:** `apps/web/src/components/ais/{limits,aiForm,templates,models,errors}.ts` = `apps/mobile/src/components/ais/{limits,form,templates,models,errors}.ts`, and `activity-format.ts` (39 of 39 lines copied from `AiActivity.tsx`).

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
Same method as T-0875:
1. Move the web version of each into `packages/chat-core/src/` (pure only), export it, and move or merge its tests.
2. Make both apps import it, keeping re-exports so other imports do not change, and delete the copies.
3. Keep any per-app difference explicit, and list each one.

Count the lines removed. Leave the chat-list model (`visibleChats`/`groupChats` vs mobile `chat-list.ts`) alone: the two apps use different rules, and that is a product decision.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`packages/chat-core/src/**`, `apps/web/src/lib/**`, `apps/mobile/src/lib/**`, `apps/web/src/components/ais/**`, `apps/mobile/src/components/ais/**`, `apps/web/src/components/AiActivity.tsx`, `work/T-0876-chat-core-prefs-routines-ai.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/chat-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/lib src/components/ais src/components/AiActivity
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib src/components/ais
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.

---

## Report (written by the worker when done)

## Review (written by Claude)
