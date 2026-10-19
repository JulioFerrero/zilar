---
id: T-2150
title: "Phone (chat row, media frame, contacts, version row, orb upload, integration actions, invite sheet): fold single-use component and helper files back into their only importer — fewer props interfaces, imports and exports; no behaviour or visual change"
status: merged
milestone: M5
branch: task/T-2150-phone-folds-3
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2150: Fold single-use phone files (chat row, media frame, contacts, version row, orb upload, integration actions, invite sheet)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the code map total must go down. 400 lines is a soft limit, and files an earlier task split only for size may be merged back when that saves lines. Only a file over 800 lines must split. A component that only one file renders costs its own imports, an exported props interface and the props plumbing; folding it into its host removes those.

The lead listed these at `db209d184`. Each mover has exactly one production importer, the host; the tests listed import it too. Each host stays at or below 650 lines.

| Mover (lines) | Host (lines) | Tests that import the mover |
| --- | --- | --- |
| `components/chat/chat-list-item.tsx` (151) | `components/chat/chat-rows.tsx` (300) | — |
| `components/chat/media-frame.ts` (13) | `components/chat/media-bubble.tsx` (372) | — |
| `components/contacts/contact-list.tsx` (185) | `app/settings/contacts.tsx` (224) | — |
| `components/settings/app-version-row.tsx` (221) | `app/(tabs)/settings.tsx` (333) | — |
| `components/ais/new-ai/orb-upload.ts` (88) | `components/ais/new-ai/new-ai-sheet.tsx` (549) | — |
| `components/integrations/use-card-actions.ts` (139) | `app/settings/integrations.tsx` (495) | — |
| `components/chat/invite-sheet.tsx` (152) | `components/chat/new-chat-button.tsx` (492) | — |

All paths are under `apps/mobile/src/`.

### Steps
For each row, read both files.
1. **Fold:**
   - move the mover's code into the host, below the host's main export, and delete the mover;
   - carry the mover's header comment above the moved code when it says a "why" (docs/COMMENTS.md "Keep");
   - a moved component becomes a non-exported function in the host;
   - keep its props type only if it still needs a name, and drop props the host can now pass more simply only when the result is identical;
   - remove `export`s nothing else uses.
2. **Duplicates.** Drop any declaration that becomes a duplicate (two copies of the same type, constant or helper).
3. **Skip** a fold when the result would read worse. For example, the host would mix two unrelated screens, or exceed 650 lines. Say why in the Report.
4. **Stale comment.** `apps/mobile/src/components/chat/blocks/block-card.tsx:382` says "(as `link-preview-card.tsx` does)", but T-2145 folded that file into `components/chat/plain-bubble-body.tsx`. Change the comment to name `plain-bubble-body.tsx`.

### Rules
- No behaviour change and no visual change: the same styles, accessibility labels, gestures, animations and effects.
- The diff only moves code and removes import/export/props plumbing. It changes no logic.
- Do not touch:
  - `apps/mobile/src/store/**`;
  - `apps/mobile/src/auth/**`;
  - any `apps/mobile/src/lib/*-api.ts`;
  - any `use-*-api.ts` hook.
- **Tests.** Update the import path, or the `jest.mock`/`vi.mock` path, in each listed test; change nothing else in it. No new tests.
- Product lines go down by at least 60.

### Allowed files
- `apps/mobile/src/app/(tabs)/settings.tsx`
- `apps/mobile/src/app/settings/contacts.tsx`
- `apps/mobile/src/app/settings/integrations.tsx`
- `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`
- `apps/mobile/src/components/ais/new-ai/orb-upload.ts`
- `apps/mobile/src/components/chat/blocks/block-card.tsx`
- `apps/mobile/src/components/chat/chat-list-item.tsx`
- `apps/mobile/src/components/chat/chat-rows.tsx`
- `apps/mobile/src/components/chat/invite-sheet.tsx`
- `apps/mobile/src/components/chat/media-bubble.tsx`
- `apps/mobile/src/components/chat/media-frame.ts`
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/contacts/contact-list.tsx`
- `apps/mobile/src/components/integrations/use-card-actions.ts`
- `apps/mobile/src/components/settings/app-version-row.tsx`
- `work/T-2150-phone-folds-3.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down by at least 60.
- The Report lists each row: folded (lines saved) or skipped (why).
- **Lead check** (phone emulator smoke): the chat list rows, an image and a video bubble, Settings → Contacts, Settings (the version row and its update check), New AI → the orb photo step, Settings → Integrations (save, test), New chat → Invite.

---

## Report (written by the worker when done)

### What I did

Folded every mover into its host, deleting the mover file. Moved components are now non-exported functions with inline props types (no named props interface and no export). Imports were merged with the host's existing ones, and the stale comment in `block-card.tsx` now names `plain-bubble-body.tsx`.

| Row | Result | Net product lines |
| --- | --- | --- |
| `components/chat/chat-list-item.tsx` → `components/chat/chat-rows.tsx` | folded | −13 |
| `components/chat/media-frame.ts` → `components/chat/media-bubble.tsx` | folded | 0 (13 moved, import plumbing removed) |
| `components/contacts/contact-list.tsx` → `app/settings/contacts.tsx` | folded | −10 |
| `components/settings/app-version-row.tsx` → `app/(tabs)/settings.tsx` | folded | −5 |
| `components/ais/new-ai/orb-upload.ts` → `components/ais/new-ai/new-ai-sheet.tsx` | folded | −8 |
| `components/integrations/use-card-actions.ts` → `app/settings/integrations.tsx` | folded | −6 |
| `components/chat/invite-sheet.tsx` → `components/chat/new-chat-button.tsx` | folded (also inlined `InviteSheetBody`, which had no other user) | −25 |

Total: 900 added / 967 deleted = **−67 product lines** (`git diff --numstat -- apps/mobile`). No row was skipped. Every host is under 650 lines; the largest is `new-ai-sheet.tsx` at 629.

Files changed: the 7 hosts above, `components/chat/blocks/block-card.tsx` (stale comment), and the 7 deleted movers.

### Checks run

- `pnpm install` → `Done in 16.7s`.
- `pnpm gate` (first run) → `FAIL format` on `chat-rows.tsx`; fixed with `pnpm exec prettier --write` on that one file. All other checks passed on that run.
- `pnpm gate` (final) → summary:

```
PASS  install (frozen)  (1.6s)
PASS  format  (1.1s)
PASS  lint  (0.8s)
PASS  typecheck  (3.8s)
PASS  effect  (0.9s)
SKIP build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/mobile  (1.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

Soft-limit warnings were reported for `settings.tsx` (549), `integrations.tsx` (628), `new-ai-sheet.tsx` (629), `block-card.tsx` (727, unchanged), `chat-rows.tsx` (438) and `new-chat-button.tsx` (619); all are below 650 and none over 800.

No single test file was run: the listed tests column was empty for every row and no test imports a mover.

### Notes for the lead

- `orb-upload.ts` began with an `// effect-plain:` marker. Markers are only read from the first 15 lines, so I did not copy it mid-file; the host already starts with its own `effect-plain` marker, and `pnpm gate`'s effect check passes.
- `InviteSheetBody` had no importer outside `invite-sheet.tsx`; after the fold it was a single-use component in the host, so its JSX was inlined into `InviteSheet` and its props type removed. Markup and props are otherwise unchanged.
- No behaviour, style, accessibility, gesture or effect logic was changed. The test gate passes, but I did not run the phone emulator smoke (lead check).

## Review (written by Claude)

Approved; the pre-review was clean. Net −67, all seven rows folded (chat row, media frame, contact list, version row, orb upload, integration card actions, invite sheet). The stale `link-preview-card.tsx` comment in `block-card.tsx` now names `plain-bubble-body.tsx`.

**Comments:** the only dropped comment is an `effect-plain:` directive whose file is gone, and the gate's Effect check passes.

**Phone emulator:**
- The smoke passed: `/`, `/settings`, `/settings/contacts`, `/settings/integrations`, the dev-team chat.
- The first screenshots caught the app mid-load (rows without previews and an Android "isn't responding" dialog). A relaunch showed:
  - the chat list with previews and times;
  - Contacts with every row;
  - Settings down to "Zilar 0.1.0 · Local build" and Sign out;
  - the New AI sheet on the Provider step.

The Settings profile card shows its loading bars in mock. T-2150 does not touch that code.
