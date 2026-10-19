---
id: T-2156
title: "Phone finish-up: merge the text field into the text module, delete the last alias and shim modules (tools-api, approvals-api, topics-section, emoji-sheet), restore two lost comments and fix a stale one; no behaviour change"
status: merged
milestone: M5
branch: task/T-2156-phone-finish-up
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2156: Phone finish-up after tonight's clean-ups

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one name per thing. These are the leftovers the lead found while reviewing T-2149 and T-2153 (state at `85129ae55`).

### Steps (one commit each)
1. **Merge `apps/mobile/src/components/ui/text-field.tsx` (41 lines) into `apps/mobile/src/components/ui/text.tsx` (102 lines).** `text-field.tsx` already imports `Text` from `@/components/ui/text`. Every one of its 29 importers also imports from `ui/text`, so each pair of imports becomes one line.
   - In `apps/mobile/src/auth/AuthFlow.tsx`, change only the import line.
2. **Delete `apps/mobile/src/components/group-info/topics-section.tsx`.** It is the one-line shim `export { TopicsSection } from '@/components/group-info/root-page'`. Point `apps/mobile/src/mock/dev-topic-header-screen.tsx` at `@/components/group-info/root-page`.
3. **Delete `apps/mobile/src/components/chat/emoji-sheet.tsx`.** It holds only `export type EmojiSheetTab = 'emoji' | 'stickers' | 'gifs'`. Declare that type in `apps/mobile/src/components/chat/composer-sheet.ts`, and import it from there in `apps/mobile/src/components/chat/composer.tsx`.
4. **Delete `apps/mobile/src/lib/tools-api.ts` and `apps/mobile/src/lib/approvals-api.ts`,** as T-2153 did for seven other alias modules.
   - Importers take types from `@zilar/client-core` under their real names. Find them with `git grep -n "lib/tools-api'\|lib/approvals-api'" -- apps/mobile`; they include `apps/mobile/src/lib/routines-format.ts` and `apps/mobile/src/lib/approval-state.ts`.
   - `ToolsApi`, `ToolDetailsApi`, `ToolActionsApi`, `AiToolsApi` and `ApprovalsApi` become `ReturnType<typeof makeToolsApi>` / `ReturnType<typeof makeApprovalsApi>` (a `Pick` only where a prop needs the narrower type).
   - Derived types (`RoutinePausedReason`, `RoutineLastStatus`, `RoutineStatus`, `ApprovalRuleScope`): declare them in the one file that uses them, or write the expression at each use.
5. **Comments:**
   - `apps/mobile/src/app/(tabs)/ais.tsx` at the stop/resume call (about line 226): add the "why" T-2153 dropped: `// Stop and resume answer the fresh public AI, so the row is swapped from server truth without a second GET.`
   - `packages/client-core/src/directory-api.ts:15`: name the limit, `reads are rate limited (30 per 10 minutes)`. The server's `RATE_LIMITS.directory` is `{ max: 30, windowMs: 10 * MINUTE }` at `apps/server/src/rate-limit.ts:75`.
   - `apps/mobile/src/components/chat/markdown-decision.ts:9`: the header still says "The two Markdown wiring decisions". T-2149 deleted one, so reword it for the one that is left, keeping the "both apps cannot disagree" point.

### Rules
- No behaviour change: the same styles, labels, requests and types.
- Do not touch `apps/mobile/src/store/**`. In `apps/mobile/src/auth/AuthFlow.tsx`, change only the import line.
- **Tests.** Change only import lines; no new tests.

### Allowed files
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/app/ais/[id].tsx`
- `apps/mobile/src/app/chat/[id].tsx`
- `apps/mobile/src/app/group-info/[id].tsx`
- `apps/mobile/src/app/group/new.tsx`
- `apps/mobile/src/app/settings/integrations.tsx`
- `apps/mobile/src/app/settings/profile.tsx`
- `apps/mobile/src/app/settings/sticker-pack.tsx`
- `apps/mobile/src/app/welcome/handle.tsx`
- `apps/mobile/src/app/welcome/name.tsx`
- `apps/mobile/src/auth/AuthFlow.tsx`
- `apps/mobile/src/components/ais/limits-fields.tsx`
- `apps/mobile/src/components/ais/new-ai/key-step.tsx`
- `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`
- `apps/mobile/src/components/ais/new-ai/provider-step.tsx`
- `apps/mobile/src/components/ais/tool-detail-body.tsx`
- `apps/mobile/src/components/chat/channel-screen.tsx`
- `apps/mobile/src/components/chat/composer-sheet.ts`
- `apps/mobile/src/components/chat/composer.tsx`
- `apps/mobile/src/components/chat/emoji-sheet.tsx`
- `apps/mobile/src/components/chat/group-manage-section.tsx`
- `apps/mobile/src/components/chat/group-roles-sheet.tsx`
- `apps/mobile/src/components/chat/invite-links-sheet.tsx`
- `apps/mobile/src/components/chat/join-link.tsx`
- `apps/mobile/src/components/chat/markdown-decision.ts`
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/chat/new-topic-sheet.tsx`
- `apps/mobile/src/components/chat/topic-link-row.tsx`
- `apps/mobile/src/components/chat/visibility-fields.tsx`
- `apps/mobile/src/components/connections/connection-sheet.tsx`
- `apps/mobile/src/components/group-info/topics-section.tsx`
- `apps/mobile/src/components/integrations/card-fields.tsx`
- `apps/mobile/src/components/machines/approved-machines.tsx`
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`
- `apps/mobile/src/components/ui/text-field.tsx`
- `apps/mobile/src/components/ui/text.tsx`
- `apps/mobile/src/lib/approval-state.ts`
- `apps/mobile/src/lib/approvals-api.ts`
- `apps/mobile/src/lib/routines-format.ts`
- `apps/mobile/src/lib/tools-api.ts`
- `apps/mobile/src/mock/dev-kit-screen.tsx`
- `apps/mobile/src/mock/dev-topic-header-screen.tsx`
- `packages/client-core/src/directory-api.ts`
- `work/T-2156-phone-finish-up.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down (`git diff main --numstat -- apps packages`); give the net in the Report.
- **Lead check** (phone emulator smoke): sign-in screen fields, New AI (key step), Settings → Routines, Settings → Approvals, an AI's tools and routines sections, a tool detail, and the composer emoji / stickers / GIFs tabs.

---

## Report (written by the worker when done)

### What I did

- Merged `TextField` into `apps/mobile/src/components/ui/text.tsx` and deleted `text-field.tsx`. All 29 importers now take `Text, TextField` from `ui/text` in one line; `AuthFlow.tsx` changed only its import line.
- Deleted the `topics-section.tsx` shim and pointed `mock/dev-topic-header-screen.tsx` at `group-info/root-page`.
- Deleted `emoji-sheet.tsx`, declared `EmojiSheetTab` in `composer-sheet.ts`, and imported it from there in `composer.tsx`.
- Deleted `lib/tools-api.ts` and `lib/approvals-api.ts`. Only two importers existed: `routines-format.ts` now takes `Routine` and `ToolListItem` from `@zilar/client-core`, and `approval-state.ts` takes `ApprovalDecision` / `PublicApproval` from `@zilar/client-core` with `ReturnType<typeof makeApprovalsApi>` at each API parameter.
- Restored the stop/resume comment in `app/(tabs)/ais.tsx`, named the directory limit (30 per 10 minutes) in `client-core/src/directory-api.ts`, and reworded the one-decision header in `markdown-decision.ts`.

### Checks run

- `pnpm install`: done, all 17 workspace projects, 1155 packages, 13.6s.
- `pnpm gate`: first run failed `typecheck` on `join-link.tsx` (it imported `../ui/text-field` relatively, which my initial absolute-path grep missed). After fixing that import, the second run:
  - `PASS install (frozen) (1.4s)`
  - `PASS format (1.1s)`
  - `PASS lint (0.7s)`
  - `PASS typecheck (3.1s)`
  - `PASS effect (1.5s)`
  - `PASS build @zilar/server (0.5s)`
  - `PASS tests @zilar/client-core (4.2s)`
  - `PASS tests @zilar/mobile (3.9s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- I did not run single-file tests separately: the change is imports and type aliases only, and the gate ran the client-core and mobile tests.
- `git diff main --numstat -- apps packages`: added 82, deleted 162, **net -80 lines**.

### Notes for the lead

- `join-link.tsx` was the 29th `TextField` importer and used relative imports (`../../components/ui/text`); it keeps that relative style with one combined import line.
- The `ToolsApi`, `ToolDetailsApi`, `ToolActionsApi`, `AiToolsApi`, `RoutinePausedReason`, `RoutineLastStatus`, `RoutineStatus` and `ApprovalRuleScope` aliases had no consumers outside the deleted modules, so no replacement declarations were needed.
- Gate still prints the pre-existing soft size warnings for mobile screens; each touched file is one line shorter than on main.
- Stale references to the deleted modules remain in `docs/audit/*` and `docs/plan/*`; those files are outside this task's Allowed files and were left alone.

## Review (written by Claude)

Approved; the pre-review was clean (follow-up: only historical audit docs still name the deleted files). Net −80:
- `text-field` merged into `ui/text`, so each of the 29 importers now has one import line; `AuthFlow.tsx` changed only that line.
- The `topics-section` shim and the one-type `emoji-sheet` module are gone.
- `tools-api` and `approvals-api` are deleted; importers use the shared types.

**Comments:** restored the stop/resume "no second GET" why and the directory "30 per 10 minutes" limit (checked against `RATE_LIMITS.directory`), and fixed the stale `markdown-decision` header.

**Phone emulator:**
- The smoke passed: Ana's chat, sign-in, Routines, Approvals, Edit AI, the topic-header dev screen.
- Rechecked by hand: Edit Dev-1 with tools, routines (Pause, Resume, Delete) and activity; the composer Stickers and GIFs tabs.
