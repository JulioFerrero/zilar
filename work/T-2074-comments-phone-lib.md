---
id: T-2074
title: "Cut comments (phone lib): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2074-comments-phone-lib
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2074: Comment cut — phone lib

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **2496 comment lines in 115 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

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
3. The target is to remove at least **1248** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `apps/mobile/src/lib/agent-tasks-api.ts`
- `apps/mobile/src/lib/ai-memory-api.ts`
- `apps/mobile/src/lib/ais-api.ts`
- `apps/mobile/src/lib/api-error-body.ts`
- `apps/mobile/src/lib/app-update-native.ts`
- `apps/mobile/src/lib/app-update.ts`
- `apps/mobile/src/lib/approval-state.ts`
- `apps/mobile/src/lib/approvals-api.ts`
- `apps/mobile/src/lib/attachment-common.ts`
- `apps/mobile/src/lib/attachment-downscale.ts`
- `apps/mobile/src/lib/attachment-native.ts`
- `apps/mobile/src/lib/attachment-opener.ts`
- `apps/mobile/src/lib/attachment-picker.ts`
- `apps/mobile/src/lib/attachment-ports.ts`
- `apps/mobile/src/lib/attachment-uploader.ts`
- `apps/mobile/src/lib/attachments.ts`
- `apps/mobile/src/lib/audit-api.ts`
- `apps/mobile/src/lib/auth-api.ts`
- `apps/mobile/src/lib/auth.ts`
- `apps/mobile/src/lib/blocked-users.ts`
- `apps/mobile/src/lib/blocks-api.ts`
- `apps/mobile/src/lib/channels.ts`
- `apps/mobile/src/lib/chat-api-schemas.ts`
- `apps/mobile/src/lib/chat-api.ts`
- `apps/mobile/src/lib/chat-folders-api.ts`
- `apps/mobile/src/lib/chat-list-cache.ts`
- `apps/mobile/src/lib/chat-list.ts`
- `apps/mobile/src/lib/chat-prefs-api.ts`
- `apps/mobile/src/lib/chat-prefs.ts`
- `apps/mobile/src/lib/colors.ts`
- `apps/mobile/src/lib/composer-drafts.ts`
- `apps/mobile/src/lib/connection.ts`
- `apps/mobile/src/lib/connections-api.ts`
- `apps/mobile/src/lib/contacts-api.ts`
- `apps/mobile/src/lib/depth.ts`
- `apps/mobile/src/lib/directory-api.ts`
- `apps/mobile/src/lib/drafts.ts`
- `apps/mobile/src/lib/effect/api-client.ts`
- `apps/mobile/src/lib/effect/fetch-timeout.ts`
- `apps/mobile/src/lib/effect/raw-request.ts`
- `apps/mobile/src/lib/effect/run-in-background.ts`
- `apps/mobile/src/lib/effect/runtime.ts`
- `apps/mobile/src/lib/effect/use-action.ts`
- `apps/mobile/src/lib/effect/use-query.ts`
- `apps/mobile/src/lib/emoji-data.ts`
- `apps/mobile/src/lib/filter.ts`
- `apps/mobile/src/lib/foreground.ts`
- `apps/mobile/src/lib/gif-downloader.ts`
- `apps/mobile/src/lib/gifs-api.ts`
- `apps/mobile/src/lib/gifs.ts`
- `apps/mobile/src/lib/groups-api.ts`
- `apps/mobile/src/lib/image-presets.ts`
- `apps/mobile/src/lib/integrations-api.ts`
- `apps/mobile/src/lib/invite-links-api.ts`
- `apps/mobile/src/lib/invites-api.ts`
- `apps/mobile/src/lib/link-preview-image.ts`
- `apps/mobile/src/lib/links.ts`
- `apps/mobile/src/lib/machines-api.ts`
- `apps/mobile/src/lib/media-api.ts`
- `apps/mobile/src/lib/media-retry.ts`
- `apps/mobile/src/lib/media-source.ts`
- `apps/mobile/src/lib/message-a11y.ts`
- `apps/mobile/src/lib/navigation.ts`
- `apps/mobile/src/lib/person-link.ts`
- `apps/mobile/src/lib/pin-snapshot.ts`
- `apps/mobile/src/lib/pins-api.ts`
- `apps/mobile/src/lib/polyfills.ts`
- `apps/mobile/src/lib/profile-api.ts`
- `apps/mobile/src/lib/push/actions.ts`
- `apps/mobile/src/lib/push/active-chat.ts`
- `apps/mobile/src/lib/push/background.ts`
- `apps/mobile/src/lib/push/badge.ts`
- `apps/mobile/src/lib/push/channels.ts`
- `apps/mobile/src/lib/push/last-received.ts`
- `apps/mobile/src/lib/push/native.ts`
- `apps/mobile/src/lib/push/tap.ts`
- `apps/mobile/src/lib/roles-api.ts`
- `apps/mobile/src/lib/roles.ts`
- `apps/mobile/src/lib/routines-format.ts`
- `apps/mobile/src/lib/save-photo.ts`
- `apps/mobile/src/lib/search-api.ts`
- `apps/mobile/src/lib/selection.ts`
- `apps/mobile/src/lib/session-token.ts`
- `apps/mobile/src/lib/settings-items.ts`
- `apps/mobile/src/lib/share-intent.ts`
- `apps/mobile/src/lib/share-photo.ts`
- `apps/mobile/src/lib/share-send.ts`
- `apps/mobile/src/lib/startup-paint.ts`
- `apps/mobile/src/lib/startup-timing.ts`
- `apps/mobile/src/lib/stickers-api.ts`
- `apps/mobile/src/lib/stickers-storage.ts`
- `apps/mobile/src/lib/stickers.ts`
- `apps/mobile/src/lib/tab-reselect.ts`
- `apps/mobile/src/lib/tools-api.ts`
- `apps/mobile/src/lib/topics-api.ts`
- `apps/mobile/src/lib/topics.ts`
- `apps/mobile/src/lib/types.ts`
- `apps/mobile/src/lib/use-app-update.ts`
- `apps/mobile/src/lib/use-client-version.ts`
- `apps/mobile/src/lib/use-contact-requests.ts`
- `apps/mobile/src/lib/use-mockable-api.ts`
- `apps/mobile/src/lib/use-smooth-text.ts`
- `apps/mobile/src/lib/voice-failure.ts`
- `apps/mobile/src/lib/voice-native.ts`
- `apps/mobile/src/lib/voice-playback.ts`
- `apps/mobile/src/lib/voice-recorder.ts`
- `apps/mobile/src/lib/voice-transcribe-flow.ts`
- `apps/mobile/src/lib/voice-transcripts.ts`
- `apps/mobile/src/lib/voice.ts`
- `apps/mobile/src/lib/web-host.ts`
- `apps/mobile/src/lib/web-link.ts`
- `apps/mobile/src/lib/whistle-last-note.ts`
- `apps/mobile/src/lib/whistle-port-types.ts`
- `apps/mobile/src/lib/whistle-port.ts`
- `apps/mobile/src/lib/xmpp-node-stubs/empty.js`
- `work/T-2074-comments-phone-lib.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 1248 lines are removed.

---

## Report (written by the worker when done)

### What I did

Read `docs/COMMENTS.md` and went through every Allowed file. Deleted task IDs and
history, narration that restated the code, JSDoc that only repeated parameters,
references to gone files/old names, and section banners; shortened every
multi-line block with one real "why" to one or two lines. Kept and shortened the
WHY comments: security/permission/privacy notes (bearer only to the API origin,
nothing fetched without a tap, sanitized cache names, no raw server text), data
invariants (unknown size is not empty, fresh roles list wins, one AbortController
per message, parse-entry-by-entry so one bad row does not wipe the cache),
platform workarounds (Hermes lacks `AbortSignal.timeout`/`TextDecoder`, Metro
folds `__DEV__`, SDK 57 triggers, Android recorder preset), units/limits (2048 px,
1.5 MB, 300 chars, 1..64 handle, 1..50 origin ids) and tool directives.

Only comment lines changed, plus blank lines that a removed block left leading
or doubled. I verified this mechanically: every non-comment changed line is
blank, and no directive (`eslint-disable`, `@ts-expect-error`, `effect-plain`,
`<reference>`) was removed.

- 114 of the 115 source files changed. `apps/mobile/src/lib/composer-drafts.ts`
  is the one untouched file: its two comments both say WHY (best-effort disk
  writes; read-before-write keeps other users' entries) and already meet the
  rules.
- No test files touched, and no tests written (spec says none).

### Checks run

`pnpm gate` (from the repo root):
- `PASS  install (frozen)`
- `PASS  format`
- `PASS  lint`
- `PASS  typecheck`
- `PASS  effect`
- `SKIP build @zilar/server (no server, package or manifest change)`
- `PASS  tests @zilar/mobile`
- `scope: every changed file is inside the Allowed files`
- `GATE PASS`

The first gate run failed `format` on 11 files (a leading blank line left by a
deleted header, one JSDoc line missing its indent, one `catch` block left empty
by a deleted comment). I fixed those with comment/blank-line edits only; the
second run passed every step. I did not run any single test file: no test or
non-comment file changed.

`git diff main...HEAD --shortstat`:

```
 115 files changed, 596 insertions(+), 2014 deletions(-)
```

Across `apps/mobile/src/lib` alone: 351 insertions, 2014 deletions, i.e. **net
1663 lines removed** (the rest of the shortstat is this task file).

### Comments kept that are longer than 3 lines

- `apps/mobile/src/lib/app-update-native.ts:1` — `// effect-plain:` tool
  directive, kept verbatim.
- `apps/mobile/src/lib/use-app-update.ts:1` — `// effect-plain:` tool
  directive, kept verbatim.
- `apps/mobile/src/lib/use-app-update.ts:2` — 5-line JSDoc kept for two WHYs:
  one check or download at a time (module-level state), and off unless a real
  Android release (dev builds have no `versionCode`).

### Round

Fix round for the five should-fix findings in `PREREVIEW.md`. Each is a leftover
task ID in a comment; no code, string, import or type changed, and no behaviour
changed, so no tests were added (the findings name none).

- Finding 1 (`effect/fetch-timeout.ts:1`): dropped `per T-1224,`; kept the
  Hermes `AbortSignal.timeout` note.
- Finding 2 (`message-a11y.ts:17`): dropped `(T-1318)`; kept "never the emoji as
  text".
- Finding 3 (`push/background.ts:118`): deleted the whole badge narration line.
- Finding 4 (`tools-api.ts:91`): dropped `T-1651:`; kept the old-server compat
  note.
- Finding 5 (`topics-api.ts:42`): deleted the whole JSDoc line.
- Finding 6 (nit): only updated this Report's ">3 lines kept" list; the code line
  was not touched.

Five commits, one per finding: `bc5d8e9e3`, `1ab96ee2f`, `d450d57a2`,
`335e89af1`, `59c234351`.

`pnpm gate` (from the repo root) after the fixes:
- `PASS  install (frozen)`
- `PASS  format`
- `PASS  lint`
- `PASS  typecheck`
- `PASS  effect`
- `SKIP build @zilar/server (no server, package or manifest change)`
- `PASS  tests @zilar/mobile`
- `scope: every changed file is inside the Allowed files`
- `GATE PASS`

I ran no single test file: only comment lines changed.

### Notes for the lead

- Acceptance target was 1248 removed lines; the branch removes 1663 net across
  `apps/mobile/src/lib` (2014 comment lines out, 351 shortened ones in).
- `apps/mobile/src/lib/settings-items.ts`: only its header comment was deleted;
  no entry, order or format changed (registry-file pitfall).
- Nothing outside the Allowed files was edited. No dependencies, code, strings,
  imports or types changed; the gate's scope check and the comment-only diff
  scan both pass.

## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +354 -2019 net -1665; non-comment changed lines: 0. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
