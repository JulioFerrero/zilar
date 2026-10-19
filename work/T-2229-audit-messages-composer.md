---
id: T-2229
title: "Rewrite map (no code change), messages core C: the composer on web and phone. Behaviour list, twin logic, slop with file:line, and a lean target structure with line budgets"
status: merged
milestone: M5
branch: task/T-2229-audit-messages-composer
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2229: Rewrite map, the composer

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-19: the code base is 240k lines of "slop", and trimming a few lines per task does not help. We will **rewrite** the messages core feature by feature, to a line budget, following `docs/LEAN_CODE.md` (read it first). This task is the map a rewrite is written from. It writes one document and changes no code.

### Scope (4,454 lines, counted 2026-10-19)
- `apps/mobile/src/components/chat/chat-composer-dock.tsx` (676)
- `apps/mobile/src/components/chat/composer.tsx` (643)
- `apps/web/src/components/composer/ComposerControls.tsx` (579)
- `apps/web/src/components/Composer.tsx` (563)
- `apps/mobile/src/lib/drafts.ts` (242)
- `apps/web/src/components/composer/useMentions.ts` (224)
- `apps/mobile/src/components/chat/composer-picked-strip.tsx` (208)
- `apps/mobile/src/components/chat/composer-sheet.ts` (199)
- `packages/chat-core/src/mentions.ts` (193)
- `packages/client-core/src/composer-drafts.ts` (180)
- `apps/server/src/drafts/hub.ts` (172)
- `apps/mobile/src/components/chat/composer-mentions.ts` (152)
- `apps/web/src/components/composer/useRecordingLifecycle.ts` (148)
- `apps/mobile/src/lib/composer-drafts.ts` (84)
- `apps/web/src/components/composer/useComposerFocus.ts` (78)
- `apps/web/src/components/composer/composerShared.ts` (50)
- `apps/web/src/lib/composer-drafts.ts` (39)
- `apps/server/src/drafts/events.ts` (24)

Read every file in scope fully. Read a file outside scope only to learn how the scope is used, for example the callers and the store actions it calls.

### Write `docs/audit/messages-composer.md`
1. **Behaviour list.** Number every behaviour a user sees or relies on, for example:
   - typing, sending, Enter vs Shift+Enter;
   - replies, edits, mentions and the picker;
   - attachments strip, voice, drafts (saved, restored, synced across devices);
   - focus rules, disabled states, errors.

   For each, give where web does it (`file:line`), where the phone does it, and whether shared code does it. Mark platform-only behaviours as such.
2. **Twin logic.** Every piece that web and phone implement separately but that is the same rule (state, derived values, validation, draft handling, mention parsing). Give both locations and line counts.
3. **Slop by rule.** For each rule in `docs/LEAN_CODE.md`, the places in scope that break it, with `file:line` and the lines it costs.
4. **Dead code:** exports, props and branches nothing reaches (prove it with `git grep`).
5. **Lean target structure:**
   - the new files, each with its home (`client-core` or `chat-core` for shared logic; the app for markup and platform code), what it owns, and a line budget;
   - the files to delete;
   - the total budget against today's 4,454. Aim for at least 40% fewer lines with every behaviour from part 1 kept.

   Be concrete: someone must be able to write the rewrite spec from this part alone.
6. **Risks:** behaviours that are easy to lose in a rewrite, and how the lead should check each one (web mock, the phone emulator, or live).

Every number traces to a `file:line` you read. Change no code.

### Allowed files
- `docs/audit/messages-composer.md`
- `work/T-2229-audit-messages-composer.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The doc has all six parts.
- The target structure has budgets per file and a total.

---

## Report (written by the worker when done)

### What I did

Read all 18 files in scope fully (4,454 lines measured with `wc -l` in this worktree), plus the adjacent callers needed to follow behaviour: `useComposerAttachments.ts`, `useVoiceRecorder.ts`, `composer-media.ts`, `voice-recorder.tsx`, `attach-sheet.tsx`, `web/src/lib/voice/recorder.ts`, `client-core/store/draft-stream.ts` and `draft-events.ts`, and the web/phone draft-stream ports.

Wrote `docs/audit/messages-composer.md` with the six requested parts:

1. **Behaviour list** — 32 numbered behaviours, each with web `file:line`, phone `file:line`, and whether shared code owns it; web-only and phone-only items are marked.
2. **Twin logic** — 17 duplicated rules with both locations and line counts, including the mention state machine (148 web / 220 phone lines), topic-not-in derivation, Add-row state, channel role rule, draft adapters, SSE framing, draft schemas and the edit-draft stash.
3. **Slop by rule** — the rule headings in `docs/LEAN_CODE.md` (on `main`, commit `354a0f19f`) with `file:line` and line costs. Findings total about 720 named lines.
4. **Dead code** — 13 proven items with the exact `git grep` query and result, including `DraftHub.listenerCount` (no caller, no test), the phone `Composer.picker`/`gifDownloader` props (no caller passes them), `PickedStrip.onRemove`'s unreachable optional branches, `Mentions.pickerActive`, `focusComposer`'s ignored return, and dead exports.
5. **Lean target structure** — 28 target files with home, ownership and per-file budgets; 3 files deleted; a file-by-file old→new budget table. Total **2,665 lines against 4,454, −1,789 (−40.2%)**, with every behaviour from part 1 retained.
6. **Risks** — 20 behaviours easy to lose, each with a web-mock, phone-emulator or live check.

No source code was changed.

### Files changed

- `docs/audit/messages-composer.md` (new)
- `work/T-2229-audit-messages-composer.md` (Report and status only)

### Round

- **Finding 1 (should-fix) fixed.** Part 3 no longer uses the reconstructed R1–R10 labels. It now walks the real headings in `docs/LEAN_CODE.md` (on `main`, commit `354a0f19f`) in order: One home per piece of logic; Trust the types and the contract; No layers that do nothing; Data over branches; Use the platform and the libraries we have; No speculative code; Comments; Tests; Smells a reviewer rejects. Every finding and line cost is unchanged, and the cross-references in parts 2 and 4 now name the rules.
- **Finding 2 (nit) fixed** because the row was already changed for finding 1: it now names only `ComposerControls.tsx:484`; `:100` uses `optionId()`.
- **Finding 3 (nit) not touched:** the merged behaviour rows 28/29 are not in a line this round changes.
- **Tests:** none added or adjusted. This round changes the audit document only, so there is no behaviour fix to test.
- **Gate:** `pnpm gate` — **GATE PASS** (`gate: 2 changed file(s) against main`; PASS install/format/lint/typecheck; SKIP effect/build; scope, migration, images, size and comments checks pass).

### Commands and real results

- `pnpm install` — completed: 1,155 packages added/reused, done in 26.3 s. One existing peer warning in `apps/mobile` (`@types/react-dom 19.3.0` wants `@types/react ^19.3.0`, found 19.2.18); unrelated to this task.
- `pnpm gate` — **GATE PASS**. Summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS install (frozen) (1.9s)`
  - `PASS format (0.7s)`
  - `PASS lint (1.3s)`
  - `PASS typecheck (1.3s)`
  - `SKIP effect (no source files changed)`
  - `SKIP build @zilar/server (no server, package or manifest change)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
- No single test file was run: the task changes documentation only, and AGENTS.md says to run only tests near a code change.

### Problems and deviations

- **`docs/LEAN_CODE.md` is on `main` but not on this task branch.** Round 0 could not find it and stated its own R1–R10 rule set. Round 1 read the file from `main` (commit `354a0f19f`) and remapped part 3 onto its headings; no finding or line cost changed.
- The spec's mention of drafts "synced across devices" is not what the code does: composer drafts are per device (`localStorage` on web, one JSON file on phone). The server draft stream is separate: live AI turn text shown in the chat. The doc records both and states the distinction.

### Open questions

- None. The rule-label question from round 0 is resolved by finding 1.

### Notes against the checklists

- No security surface changed: the document only describes existing behaviour; it records that draft hub events are per-owner and never cross users/servers, and that drafts are text only (no tool arguments).
- No migrations, routes, permissions or writes were added.


## Review (written by Claude)

Approved; clean after 1 auto round (1 nit). The map:
- a behaviour list with web, phone and shared `file:line` for each;
- 17 twin rules (about 450 web lines and 600 phone lines of duplicated logic);
- a target of 2,665 lines against 4,454 (−40.2%), with a write order of 7 steps and 20 risks, each with a check.

**Lead note for the rewrite specs:** part 5 splits the web controls into four new one-caller files (`ComposerBars`, `AttachmentStrip`, `AttachMenu`, `MentionPicker`). `docs/LEAN_CODE.md` rejects a file whose exports have one caller, so the specs keep them inside `ComposerControls.tsx` within the same total budget.
