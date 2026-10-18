---
id: T-2076
title: "Cut comments (phone store, routes and AI components): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2076-comments-phone-store-app-ais
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2076: Comment cut — phone store, routes and AI components

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **2224 comment lines in 113 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

### Rules
Read `docs/COMMENTS.md` first and follow it exactly. In short:
- **Keep only WHY comments:**
  - security, permission, money and privacy notes;
  - protocol and data invariants;
  - platform and library workarounds, with the bug they work around;
  - units and limits;
  - tool directives (`eslint-disable…`, `@ts-expect-error`, `// effect-plain:`, `/// <reference>`).
- **Delete:**
  - task IDs and history ("T-1234", "moved unchanged", "size split", "replaces the old…", "during the transition");
  - narration that restates the code or the name;
  - JSDoc that repeats the parameters;
  - references to things that no longer exist;
  - commented-out code and banners.
- **Shorten** a multi-line block with one real "why" to one or two lines.

### Steps
1. Go through EVERY file in Allowed files; each has comments. Edit comments only.
2. Change NO code, string, import, type or formatting. The only allowed changes are:
   - removed or shortened comment lines;
   - removing a blank line left doubled by a removed block.
3. The target is to remove at least **1112** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `apps/mobile/src/app/(tabs)/_layout.tsx`
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/app/(tabs)/index.tsx`
- `apps/mobile/src/app/(tabs)/settings.tsx`
- `apps/mobile/src/app/+native-intent.tsx`
- `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/app/ais/[id].tsx`
- `apps/mobile/src/app/at/[handle].tsx`
- `apps/mobile/src/app/chat/[id].tsx`
- `apps/mobile/src/app/dev/blocks.tsx`
- `apps/mobile/src/app/dev/kit.tsx`
- `apps/mobile/src/app/dev/topic-header.tsx`
- `apps/mobile/src/app/dev/whistle.tsx`
- `apps/mobile/src/app/explore.tsx`
- `apps/mobile/src/app/group-info/[id].tsx`
- `apps/mobile/src/app/group/[id].tsx`
- `apps/mobile/src/app/group/new.tsx`
- `apps/mobile/src/app/invite/[code].tsx`
- `apps/mobile/src/app/join/[token].tsx`
- `apps/mobile/src/app/me.tsx`
- `apps/mobile/src/app/profile.tsx`
- `apps/mobile/src/app/settings/blocked.tsx`
- `apps/mobile/src/app/settings/connections.tsx`
- `apps/mobile/src/app/settings/contacts.tsx`
- `apps/mobile/src/app/settings/devices.tsx`
- `apps/mobile/src/app/settings/folder/[id].tsx`
- `apps/mobile/src/app/settings/folders.tsx`
- `apps/mobile/src/app/settings/integrations.tsx`
- `apps/mobile/src/app/settings/machines.tsx`
- `apps/mobile/src/app/settings/notifications.tsx`
- `apps/mobile/src/app/settings/profile.tsx`
- `apps/mobile/src/app/settings/requests.tsx`
- `apps/mobile/src/app/settings/routines.tsx`
- `apps/mobile/src/app/settings/sticker-pack.tsx`
- `apps/mobile/src/app/settings/stickers.tsx`
- `apps/mobile/src/app/share.tsx`
- `apps/mobile/src/app/stickers/[packId].tsx`
- `apps/mobile/src/app/topic-tools/[id].tsx`
- `apps/mobile/src/app/u/[handle].tsx`
- `apps/mobile/src/app/welcome/handle.tsx`
- `apps/mobile/src/components/ais/ai-actions-sheet.tsx`
- `apps/mobile/src/components/ais/ai-activity.tsx`
- `apps/mobile/src/components/ais/ai-memory-logic.ts`
- `apps/mobile/src/components/ais/ai-memory-section.tsx`
- `apps/mobile/src/components/ais/ai-memory-sheet.tsx`
- `apps/mobile/src/components/ais/ai-row.tsx`
- `apps/mobile/src/components/ais/computer-picker.tsx`
- `apps/mobile/src/components/ais/delete-confirm.tsx`
- `apps/mobile/src/components/ais/errors.ts`
- `apps/mobile/src/components/ais/form.ts`
- `apps/mobile/src/components/ais/limits-fields.tsx`
- `apps/mobile/src/components/ais/limits.ts`
- `apps/mobile/src/components/ais/machine-picker.tsx`
- `apps/mobile/src/components/ais/model-picker.tsx`
- `apps/mobile/src/components/ais/models.ts`
- `apps/mobile/src/components/ais/new-ai/key-step.tsx`
- `apps/mobile/src/components/ais/new-ai/model-step.tsx`
- `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`
- `apps/mobile/src/components/ais/new-ai/orb-upload.ts`
- `apps/mobile/src/components/ais/new-ai/orb-view.tsx`
- `apps/mobile/src/components/ais/new-ai/provider-step.tsx`
- `apps/mobile/src/components/ais/new-ai/setup-step.tsx`
- `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts`
- `apps/mobile/src/components/ais/option-row.tsx`
- `apps/mobile/src/components/ais/provider-picker.tsx`
- `apps/mobile/src/components/ais/providers.ts`
- `apps/mobile/src/components/ais/require-ais-auth.tsx`
- `apps/mobile/src/components/ais/routines-section.tsx`
- `apps/mobile/src/components/ais/run-state.ts`
- `apps/mobile/src/components/ais/screen-shell.tsx`
- `apps/mobile/src/components/ais/templates.ts`
- `apps/mobile/src/components/ais/tool-actions.ts`
- `apps/mobile/src/components/ais/tool-detail-body.tsx`
- `apps/mobile/src/components/ais/tool-detail-format.ts`
- `apps/mobile/src/components/ais/tool-detail-loader.tsx`
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx`
- `apps/mobile/src/components/ais/tool-run-blocks.tsx`
- `apps/mobile/src/components/ais/tools-section.tsx`
- `apps/mobile/src/components/ais/use-ai-memory-api.ts`
- `apps/mobile/src/components/ais/use-ais-api.ts`
- `apps/mobile/src/components/ais/use-audit-api.ts`
- `apps/mobile/src/components/ais/use-computer-mode.ts`
- `apps/mobile/src/components/ais/use-routine-actions.ts`
- `apps/mobile/src/components/ais/use-tools-api.ts`
- `apps/mobile/src/store/chat-store-provider.tsx`
- `apps/mobile/src/store/effects/chat-rows.ts`
- `apps/mobile/src/store/effects/events.ts`
- `apps/mobile/src/store/effects/group-actions.ts`
- `apps/mobile/src/store/effects/group-membership-actions.ts`
- `apps/mobile/src/store/effects/group-roles-actions.ts`
- `apps/mobile/src/store/effects/group-settings-actions.ts`
- `apps/mobile/src/store/effects/groups.ts`
- `apps/mobile/src/store/effects/helpers.ts`
- `apps/mobile/src/store/effects/history-ctx.ts`
- `apps/mobile/src/store/effects/history.ts`
- `apps/mobile/src/store/effects/lifecycle.ts`
- `apps/mobile/src/store/effects/locals.ts`
- `apps/mobile/src/store/effects/pins.ts`
- `apps/mobile/src/store/effects/polling.ts`
- `apps/mobile/src/store/effects/ports-media.ts`
- `apps/mobile/src/store/effects/ports.ts`
- `apps/mobile/src/store/effects/push-pair.ts`
- `apps/mobile/src/store/effects/runtime.ts`
- `apps/mobile/src/store/effects/send.ts`
- `apps/mobile/src/store/effects/session-check.ts`
- `apps/mobile/src/store/effects/user-state.ts`
- `apps/mobile/src/store/list-views.ts`
- `apps/mobile/src/store/offline-cache-sync.ts`
- `apps/mobile/src/store/offline-cache.ts`
- `apps/mobile/src/store/real-store.ts`
- `apps/mobile/src/store/send-types.ts`
- `apps/mobile/src/store/types-groups.ts`
- `apps/mobile/src/store/types.ts`
- `work/T-2076-comments-phone-store-app-ais.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 1112 lines are removed.

---

## Report (written by the worker when done)

### What I did

Went through all 113 source files in Allowed files and edited comments only, following `docs/COMMENTS.md`:

- Deleted task IDs (`T-1095`, `T-1313`, …), history ("moved to", "split out of", "used to"), narration that restates the code or the name, JSDoc that repeats parameters, stale references and section banners.
- Kept and shortened to at most 3 lines only WHY comments: security/privacy (tokens never in invite lists, write-only keys, per-user caches cleared on sign-out), permissions (owner/admin gates, last-admin rules), data and protocol invariants (alias maps, inclusive cursors, dedupe keys, draft keys), platform/library workarounds (Metro folding, Hermes/Vitest dynamic imports, relative media URLs, AppState `inactive`), units/limits (`10 s` grace, `4 KB` run input, `256×256`, `120 s`/`28 s` chunks).
- Kept every tool directive: `// effect-plain:`, `eslint-disable-next-line`.

Result: 113 files changed, **287 comment lines inserted, 2141 deleted — net 1854 lines removed** (target was 1112). No code, string, import, type or formatting change.

Two `catch` blocks in `offline-cache.ts` keep one short comment each ("Messaging must not depend on the cache", "Ignore the failure on the way out") so Prettier keeps the multi-line `catch { … }`; without them Prettier collapses them to `catch {}`, which would be a code change.

No comment longer than 3 lines was kept (verified across all allowed files), so the requested `file:line` list is empty.

### Checks run

- `pnpm gate` (from the repo root):
  ```
  gate: 114 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP  build @zilar/server (no server, package or manifest change)
  PASS  tests @zilar/mobile
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- `git diff main...HEAD --shortstat -- 'apps/mobile/src'`: `113 files changed, 287 insertions(+), 2141 deletions(-)`.
- No single test files were run: the change is comment-only and the spec says "No tests"; the gate ran `@zilar/mobile` tests and they passed.
- Mechanical self-check with `git diff -U0`: every removed/added non-blank line is a comment line, plus the task file's `status:` line.

### Notes for the lead

- `pnpm gate` ends with `GATE PASS` and lists no file outside Allowed files.
- The gate's format check initially flagged three files where a removed comment left an empty `catch`; fixed by keeping the two short WHY comments above, not by reformatting code.
- No deviations from the spec, no open questions.

## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +287 -2141 net -1854; non-comment changed lines: 0. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
