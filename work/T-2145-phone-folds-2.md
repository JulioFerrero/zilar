---
id: T-2145
title: "Phone (AIs tab, New AI, AIs here, payload cards, line chart, link preview, new channel, topic join, add key, people rows, integrations, profile, share): fold single-use component and helper files back into their only importer — fewer props interfaces, imports and exports; no behaviour or visual change"
status: merged
milestone: M5
branch: task/T-2145-phone-folds-2
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2145: Fold single-use phone files (AIs tab, New AI, AIs here, payload cards, line chart, link preview, new channel, topic join, add key, people rows, integrations, profile, share)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the code map total must go down. 400 lines is a soft limit, and files an earlier task split only for size may be merged back when that saves lines. Only a file over 800 lines must split. A component that only one file renders costs its own imports, an exported props interface and the props plumbing; folding it into its host removes those.

The lead listed these at `2386ee84d`. Each mover has exactly one production importer, the host; the tests listed import it too. Each host stays at or below 650 lines.

| Mover (lines) | Host (lines) | Tests that import the mover |
| --- | --- | --- |
| `components/ais/ai-row.tsx` (134) | `app/(tabs)/ais.tsx` (402) | — |
| `components/ais/new-ai/use-new-ai-flow.ts` (90) | `components/ais/new-ai/new-ai-sheet.tsx` (467) | — |
| `components/ais/run-state.ts` (16) | `app/(tabs)/ais.tsx` (402) | — |
| `components/chat/ais-here-sheet.tsx` (144) | `components/chat/chat-header.tsx` (230) | — |
| `components/chat/approval-card.tsx` (208) | `components/chat/payload-card.tsx` (158) | — |
| `components/chat/blocks/line-block.tsx` (121) | `components/chat/blocks/chart-blocks.tsx` (205) | — |
| `components/chat/link-preview-card.tsx` (164) | `components/chat/plain-bubble-body.tsx` (350) | — |
| `components/chat/new-channel-sheet.tsx` (149) | `components/chat/new-chat-button.tsx` (350) | — |
| `components/chat/progress-card.tsx` (226) | `components/chat/payload-card.tsx` (158) | — |
| `components/chat/topic-join-view.tsx` (172) | `app/chat/[id].tsx` (383) | — |
| `components/connections/add-key-sheet.tsx` (89) | `app/settings/connections.tsx` (538) | — |
| `components/contacts/person-row.tsx` (48) | `components/chat/chat-search-results.tsx` (357) | — |
| `components/integrations/email-card.tsx` (126) | `app/settings/integrations.tsx` (136) | — |
| `components/integrations/telegram-card.tsx` (122) | `app/settings/integrations.tsx` (136) | — |
| `components/integrations/voice-card.tsx` (150) | `app/settings/integrations.tsx` (136) | — |
| `components/profile/profile-view.tsx` (223) | `app/me.tsx` (257) | — |
| `components/settings/use-profile-avatar.ts` (190) | `components/settings/use-profile-settings.ts` (412) | — |
| `lib/share-intent.ts` (106) | `app/share.tsx` (309) | lib/share-intent.test.ts |

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
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/app/chat/[id].tsx`
- `apps/mobile/src/app/me.tsx`
- `apps/mobile/src/app/settings/connections.tsx`
- `apps/mobile/src/app/settings/integrations.tsx`
- `apps/mobile/src/app/share.tsx`
- `apps/mobile/src/components/ais/ai-row.tsx`
- `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`
- `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts`
- `apps/mobile/src/components/ais/run-state.ts`
- `apps/mobile/src/components/chat/ais-here-sheet.tsx`
- `apps/mobile/src/components/chat/approval-card.tsx`
- `apps/mobile/src/components/chat/blocks/chart-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/line-block.tsx`
- `apps/mobile/src/components/chat/chat-header.tsx`
- `apps/mobile/src/components/chat/chat-search-results.tsx`
- `apps/mobile/src/components/chat/link-preview-card.tsx`
- `apps/mobile/src/components/chat/new-channel-sheet.tsx`
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/chat/payload-card.tsx`
- `apps/mobile/src/components/chat/plain-bubble-body.tsx`
- `apps/mobile/src/components/chat/progress-card.tsx`
- `apps/mobile/src/components/chat/topic-join-view.tsx`
- `apps/mobile/src/components/connections/add-key-sheet.tsx`
- `apps/mobile/src/components/contacts/person-row.tsx`
- `apps/mobile/src/components/integrations/email-card.tsx`
- `apps/mobile/src/components/integrations/telegram-card.tsx`
- `apps/mobile/src/components/integrations/voice-card.tsx`
- `apps/mobile/src/components/profile/profile-view.tsx`
- `apps/mobile/src/components/settings/use-profile-avatar.ts`
- `apps/mobile/src/components/settings/use-profile-settings.ts`
- `apps/mobile/src/lib/share-intent.test.ts`
- `apps/mobile/src/lib/share-intent.ts`
- `work/T-2145-phone-folds-2.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down by at least 60.
- The Report lists each row: folded (lines saved) or skipped (why).
- **Lead check** (phone emulator smoke): the AIs tab rows, the New AI sheet, a chat header's AIs-here sheet, an approval card and a progress card, a link preview, New chat → New channel, a topic you have not joined, Settings → Connections → Add key, the people rows in chat search, Settings → Integrations (email, Telegram, voice), /me, the profile avatar, the share screen.

---

## Report (written by the worker when done)

### What I did

Folded 17 of the 18 movers into their host; one row was skipped (see below). Every host stays under 650 lines; no logic, styles, labels, effects or gestures changed. Deleted the 17 mover files and removed the now-unused imports/exports. Net product lines: **-129** (`git diff --numstat HEAD -- apps/mobile/src` → +2287 / -2416).

| Mover | Result |
| --- | --- |
| `ais/ai-row.tsx` + `ais/run-state.ts` → `app/(tabs)/ais.tsx` | folded; host 402→542 (+140, movers 150) → **10 saved** for the pair |
| `ais/new-ai/use-new-ai-flow.ts` → `new-ai-sheet.tsx` | folded; host 467→549 (+82, mover 90) → **8 saved** |
| `chat/ais-here-sheet.tsx` → `chat-header.tsx` | folded; 230→373 (+143, mover 144) → **1 saved** |
| `chat/approval-card.tsx` + `chat/progress-card.tsx` → `payload-card.tsx` | folded; 158→577 (+419, movers 434) → **15 saved** for the pair |
| `chat/blocks/line-block.tsx` → `chart-blocks.tsx` | folded; 205→319 (+114, mover 121) → **7 saved** |
| `chat/link-preview-card.tsx` → `plain-bubble-body.tsx` | folded; 350→509 (+159, mover 164) → **5 saved** |
| `chat/new-channel-sheet.tsx` → `new-chat-button.tsx` | folded; 350→492 (+142, mover 149) → **7 saved** |
| `chat/topic-join-view.tsx` → `app/chat/[id].tsx` | folded; 383→545 (+162, mover 172) → **10 saved** |
| `connections/add-key-sheet.tsx` → `app/settings/connections.tsx` | folded; 538→621 (+83, mover 89) → **6 saved** |
| `contacts/person-row.tsx` → `chat-search-results.tsx` | folded; 357→400 (+43, mover 48) → **5 saved** |
| `integrations/{email,telegram,voice}-card.tsx` → `app/settings/integrations.tsx` | folded; 136→495 (+359, movers 398) → **39 saved** for the three |
| `profile/profile-view.tsx` → `app/me.tsx` | folded; 257→472 (+215, mover 223) → **8 saved** |
| `settings/use-profile-avatar.ts` → `use-profile-settings.ts` | folded; 412→594 (+182, mover 190) → **8 saved** |
| `lib/share-intent.ts` → `app/share.tsx` | **skipped** — see Notes |

### Checks run

- `pnpm install` — completed, no errors.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/share-intent.test.ts` — 1 file passed, 4 tests passed.
- `pnpm gate` — GATE PASS:

```
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (0.6s)
PASS  typecheck  (3.0s)
PASS  effect  (0.7s)
SKIP build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/mobile  (1.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
GATE PASS
```

### Notes for the lead

- **Skipped: `lib/share-intent.ts` → `app/share.tsx`.** I folded it, changed `share-intent.test.ts` to import `../app/share`, and the test failed: Vitest/Rolldown cannot parse `react-native/index.js` (`RolldownError: Flow is not supported`) because the screen imports `expo-file-system`, `expo-share-intent` and React Native at module load. The spec allows only the import-path change in that test, so there is no in-scope fix; the fold would read worse and break the test. I restored `lib/share-intent.ts` and the test unchanged. Its 106 lines are the only mover not removed.
- In `new-ai-sheet.tsx` the moved `// effect-plain:` tool directive now sits on line 1: the effect ratchet only reads the first 15 lines, and the host now holds the wizard's promise-based `.then`.
- `apps/mobile/src/components/chat/blocks/block-card.tsx` has a comment that names `link-preview-card.tsx` as an example; that file no longer exists. It is outside the Allowed files, so I left it untouched.
- No other file imported the deleted movers (checked with grep across `apps/mobile/src` and `packages`).

## Review (written by Claude)

Approved; the pre-review was clean (follow-up: the stale `link-preview-card.tsx` mention in `block-card.tsx:382`). Net −129: 17 of 18 movers folded.

**Skip:** `share-intent` was skipped correctly. Its test cannot import the screen, because Vitest cannot parse react-native.

**Comments:** none were lost (the lead diffed the comment lines).

**Phone emulator:**
- The smoke passed: `/ais`, `/settings/connections`, `/settings/integrations`, `/me`, the dev-team chat, `/settings/contacts`.
- Add key and New AI sheets open on the Provider step.
- New chat → New channel opens with Private/Public.
- The Ideas topic shows "Join Ideas".
- The blocks catalog draws the chart line.

No mock topic has an AI working, so the AIs-here sheet rests on the gate and the pre-review.
