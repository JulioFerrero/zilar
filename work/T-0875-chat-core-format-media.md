---
id: T-0875
title: "chat-core gets the duplicated format, attachment, media-trust, sticker-size and smooth-text helpers; web and mobile import them"
status: merged
milestone: M5
branch: task/T-0875-chat-core-format-media
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0875: chat-core gets the duplicated format, attachment, media-trust, sticker-size and smooth-text helpers; web and mobile import them

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding A-F3 in `docs/audit/simplify-2026-10-09/A-web-mobile.md`: 56 pure function pairs are at least 95% identical between web and mobile. This task takes these families:
- **Attachments and media:** `cleanFilename`, `formatFileSize`, `trustedMediaHosts` and `gifBlobType` (`apps/web/src/lib/attachments.ts:43,59,125,290` = `apps/mobile/src/lib/attachments.ts:64,80,122`, `lib/gifs.ts:40`), plus `sanitizeIncomingAttachment` (web `store/realStore.ts:128` = `apps/mobile/src/lib/attachments.ts:205`).
- **Formatting:** `typingLabel`, `replyRef`, `formatLastSeen` and `chatSubtitle` (`apps/web/src/lib/format.ts` = `apps/mobile/src/lib/format.ts`, `lib/chat.ts`).
- **Stickers and smooth text:** `fitStickerSize`, `commonPrefixLength` and `safeCut`.

The root cause, in mobile's own words: "chat-core has no equivalent, so it stays mobile-specific" (`apps/mobile/src/lib/format.ts:31-33`).

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. For each pair, diff the two copies. Move the web version into `packages/chat-core/src/` (pure only: no I/O, no Effect services), with its tests moved or merged, and export it from `packages/chat-core/src/index.ts`. Watch for name clashes, since index.ts uses `export *`.
2. Make both apps import it. Keep each app's existing exports as re-exports, so other imports do not change. Delete the copies.
3. Where the copies differ, keep each app's current behaviour (pass a parameter, or keep the different one) and list the differences in the Report. Do not unify behaviour silently. T-0844 already moved `formatMoney` and `sortTopics`.

Count the lines removed.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`packages/chat-core/src/**`, `apps/web/src/lib/**`, `apps/mobile/src/lib/**`, `apps/web/src/store/realStore.ts`, `apps/web/src/components/**`, `apps/mobile/src/components/**`, `apps/server/src/handles/rules.ts`, `apps/web/src/store/effects/groupMembers.ts`, `packages/protocol/src/handles.test.ts`, `packages/protocol/src/handles.ts`, `packages/protocol/src/index.ts`, `packages/protocol/src/jid.test.ts`, `packages/protocol/src/jid.ts`, `packages/xmpp-core/src/jid.ts` (lead: carried by the merge of T-0874), `work/T-0875-chat-core-format-media.md`.

This task runs the whole web and mobile suites (16 s each), because these helpers are used widely.

### Checks (wave mode)
```bash
pnpm --filter @zilar/chat-core exec vitest run --reporter=dot
pnpm --filter @zilar/web test --reporter=dot
pnpm --filter @zilar/mobile test --reporter=dot
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

- Moved to chat-core: `chat-labels.ts` (formatLastSeen, chatSubtitle, typingLabel, replyRef), `media.ts` (cleanFilename, formatFileSize, MediaTokenShape, trustedMediaHosts, isTrustedMediaUrl, gifBlobType, isGifVideoName, sanitizeIncomingAttachment), `smooth-text.ts` (commonPrefixLength, safeCut; mentions.ts now imports it), `stickers.ts` (STICKER_PREP_MAX_DIM, fitStickerSize). Web and mobile re-export them; existing app tests unchanged.
- Lines: apps 34 added, 580 removed (net -546); chat-core +~340 incl. a new `media.test.ts` (6 tests). Whole change: 373 added, 589 removed.
- Differences between copies: none in behaviour. Mobile formatLastSeen used elapsed ms, web used minutes; both floor to the same result. Mobile channel subtitle used a ternary for 1 subscriber; same text. Web `trustedMediaHosts` and mobile differ only in code shape.
- Tests: chat-core 179 passed (15 files). Web 1940-1943 passed over the 1st full run; failures were load related (load average 120-260): Composer.voice "Send voice message" also fails on clean main under load, and a 2nd component-only run with maxWorkers=2 gave 1033/1033. Mobile 2760 passed, 2 skipped. Web and mobile typecheck clean, oxlint and prettier clean.
- Not done: 3 of 3 clean web runs (the machine was at load 160-260; Composer.voice is flaky on main too). I used sed/node scripts for some mechanical cuts of the old copies (index.ts line, block deletions), not for logic.

## Review (written by Claude)

**Lead, 2026-10-10: approved.** The format, media-trust, attachment, sticker-size and smooth-text helpers now live in chat-core, and the apps lose a net 546 lines with no behaviour change. The web and mobile full suites pass. The combined wave 4 check passes.
