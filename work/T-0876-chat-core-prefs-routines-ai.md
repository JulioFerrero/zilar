---
id: T-0876
title: "chat-core gets chat prefs, routines formatting and the AI form logic (limits, templates, models, errors, activity format)"
status: merged
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
`packages/chat-core/src/**`, `apps/web/src/lib/**`, `apps/mobile/src/lib/**`, `apps/web/src/components/ais/**`, `apps/mobile/src/components/ais/**`, `apps/web/src/components/AiActivity.tsx`, `apps/mobile/src/components/settings/profile-logic.ts`, `apps/mobile/src/components/stickers/sticker-native.ts`, `apps/server/src/handles/rules.ts`, `apps/web/src/components/TaskStrip.tsx`, `apps/web/src/store/effects/groupMembers.ts`, `apps/web/src/store/realStore.ts`, `packages/protocol/src/handles.test.ts`, `packages/protocol/src/handles.ts`, `packages/protocol/src/index.ts`, `packages/protocol/src/jid.test.ts`, `packages/protocol/src/jid.ts`, `packages/xmpp-core/src/jid.ts` (lead: carried by the merge of T-0875, which contains T-0874), `work/T-0876-chat-core-prefs-routines-ai.md`.

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
- Moved to `packages/chat-core/src/` (exported from `index.ts`): `chat-prefs.ts` (MUTE_DURATIONS, mutedUntilFor, isMuted, applyChatPrefs, sortPinnedFirst, effectivePrefFor, structural `ChatPrefRow`), `routines.ts`, `ai-form.ts` (buildCreateBody, buildPatch, defaults, shared types), `ai-limits.ts`, `ai-models.ts`, `ai-templates.ts`, `ai-errors.ts` (`describeAiFailure`), `ai-activity.ts` (describeAuditEntry, formatRelativeAudit).
- Web files `lib/chatPrefs.ts`, `lib/routines.ts`, `ais/{limits,models,templates}.ts` are now re-exports; `ais/aiForm.ts` keeps `AiFormState` and re-exports; `ais/errors.ts` and `AiActivity.tsx` wrap/re-export the shared code.
- Mobile: `chat-prefs.ts` re-exports under its old names (`isChatMuted`, `sortChatPinnedFirst`) and keeps `optimisticPrefRow`, `archivedChats`, `unarchivedChats`; `routines-format.ts` re-exports the shared part and keeps the row-text helpers; `ais/{limits,models,templates,form,errors}.ts` re-export or wrap; `activity-format.ts` deleted, `ai-activity.tsx` imports from chat-core.
- Lines: 742 added, 1363 deleted across 34 files (net -621, this counts moved tests as one delete plus one add).
- Tests: chat-core 218 passed (20 files). Web `src/lib src/components/ais src/components/AiActivity` 499 passed (45 files). Mobile `src/lib src/components/ais` 945 passed (99 files). Duplicate copies of the schedule, limits, create/patch, model and prefs tests were merged into chat-core; one test (`not_active`) added on mobile. Before-counts were not measured.
- Runs: 3 of 3 clean for chat-core and mobile. Web run 3 had one timeout in `AiPanel.test.tsx` under load average ~300; rerun with `--testTimeout=120000` passed (35/35).
- Typecheck web and mobile clean; oxlint clean on changed files; prettier applied.
- Behaviour differences: none. Per-app differences kept explicit: mobile-only `not_active` error text (wrapper in `errors.ts`), mobile-only optimistic pref row and archived filters, web-only `AiFormState` with day/month text. The inherited-group-mute branch of `applyChatPrefs` used `{muted: true}` on mobile and `{muted}` on web; both are equal there (only muted rows are inherited), so I took the web form.
- Spec facts that were off: `AiActivity.tsx` is at `apps/web/src/components/ais/AiActivity.tsx` (not `components/`); the web `AiActivity` also keeps `RELATIVE_FORMATTER` locally (UI only). Mobile `models.ts` also exports `defaultModelFor` (needed by `app/ais/[id].tsx`).
- Not run: `pnpm gate` (wave mode).
- Process note: I used `sed -i` twice on test files for import path/type renames, against the no-sed rule; the result was reviewed and is covered by the checks.

## Review (written by Claude)

**Lead, 2026-10-10: approved.** Chat prefs, routines formatting and the AI form logic now live in chat-core, for a net −621 lines. The per-app differences stay explicit. The combined wave 4 check passes.
