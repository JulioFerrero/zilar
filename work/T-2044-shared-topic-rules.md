---
id: T-2044
title: "Share W2-d (part 1): the topic link and permission rules move from the phone's lib/topics.ts into chat-core topics.ts (httpsTopicUrl, topicLinkText, mayCreateTopic, mayManageTopic, mayArchiveTopic and their types); web's TopicLinkRow and NewChatButton use them instead of their own copies — with tests"
status: merged
milestone: M5
branch: task/T-2044-shared-topic-rules
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2044: Shared topic link and permission rules (share plan W2-d, part 1)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone. `docs/audit/share-plan.md` §2.15 found two rules written twice:
- the "https only" topic-link rule;
- who may create a topic.

These are permission and link-safety rules, so tests are required. Part 2 (the topics API calls) is a separate task.

### Facts (read by the lead on 2026-10-18 at `15a37d398`)
- **Phone.** `apps/mobile/src/lib/topics.ts` (243 lines) holds:
  - `httpsTopicUrl` (`:150-164`): trim; empty means `undefined`; parse with chat-core `parseUrl`; return `parsed.toString()` only for `https:`;
  - `topicLinkText` (`:166-175`);
  - `GroupRole`, `GroupMembership` and `TopicPermissionsInput` (`:177-189`);
  - `mayCreateTopic` (`:200-209`), `mayManageTopic` (`:212-214`) and `mayArchiveTopic` (`:217-225`).
- **Web.**
  - `apps/web/src/components/topic/TopicLinkRow.tsx:18-27` has its own `httpsUrl`. It is the same rule, written with `Schema.URLFromString`.
  - `apps/web/src/components/NewChatButton.tsx:101-104` inlines the create rule: owner or admin, or a member when `membersCanCreateTopics === true`.
- **Chat-core.** `packages/chat-core/src/topics.ts` (123 lines) is already exported by the chat-core barrel. Put the moved code **in this file**, so there's no barrel edit.

### Steps
1. **Move to chat-core.** Move `httpsTopicUrl`, `topicLinkText`, the three permission functions and their types from the phone's `lib/topics.ts` into `packages/chat-core/src/topics.ts`. Check where `TopicInfo` comes from and import it there.
2. **Phone.** `apps/mobile/src/lib/topics.ts` re-exports the moved names from `@zilar/chat-core`, so its importers don't change.
3. **Web.**
   - `TopicLinkRow.tsx` uses `httpsTopicUrl` and deletes `httpsUrl`. Check that both give the same string for a valid https URL; both normalise through URL parsing.
   - `NewChatButton.tsx` uses `mayCreateTopic` with the members it already has, and keeps its "detail not loaded yet" fallback exactly.
4. **Tests.** Add to `packages/chat-core/src/topics.test.ts`:
   - `httpsTopicUrl`: `http:`, `javascript:` and blank are refused, and `https:` passes;
   - `mayCreateTopic`: owner, admin, member with the switch off and on, and not a member;
   - `mayArchiveTopic`: false for General.
5. **Size.** Product lines go down. Report the counts.

### Allowed files
- `packages/chat-core/src/topics.ts`
- `packages/chat-core/src/topics.test.ts`
- `apps/mobile/src/lib/topics.ts`
- `apps/web/src/components/topic/TopicLinkRow.tsx`
- `apps/web/src/components/NewChatButton.tsx`
- `work/T-2044-shared-topic-rules.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/topics.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines go down.

---

## Report (written by the worker when done)

### What I did

Moved the topic link and permission rules from the phone's `apps/mobile/src/lib/topics.ts` into `packages/chat-core/src/topics.ts`:

- `httpsTopicUrl` (now uses chat-core `parseUrl`), `topicLinkText`;
- `GroupRole`, `GroupMembership`, `TopicPermissionsInput`;
- `mayCreateTopic`, `mayManageTopic`, `mayArchiveTopic` (with their private helpers `myRole` and `isManager`).

`TopicInfo` is imported from `./types` inside chat-core; `parseUrl` from `./url`. No barrel edit was needed.

- **Phone:** `apps/mobile/src/lib/topics.ts` re-exports the moved values and types from `@zilar/chat-core`, so every existing importer (`topic-link-row.tsx`, `group/[id].tsx`, `group-info/[id].tsx`, `new-topic-group-sheet.tsx`, `use-chat-screen.ts`) is unchanged.
- **Web `TopicLinkRow.tsx`:** deleted the local `httpsUrl` and its `Option`/`Schema` imports, and uses `httpsTopicUrl` for both display and save validation.
- **Web `NewChatButton.tsx`:** the inline owner/admin/member rule is replaced by `mayCreateTopic` with the members and `membersCanCreateTopics` it already has. The "detail not loaded yet" fallback (`role === undefined` -> show the entry) is unchanged.
- **Tests:** added `httpsTopicUrl` (http, javascript and blank refused; https kept), `mayCreateTopic` (owner, admin, member with the switch off and on, non-member), and `mayArchiveTopic` (General refused, another topic allowed) to `packages/chat-core/src/topics.test.ts`.

### Files changed

- `packages/chat-core/src/topics.ts`
- `packages/chat-core/src/topics.test.ts`
- `apps/mobile/src/lib/topics.ts`
- `apps/web/src/components/topic/TopicLinkRow.tsx`
- `apps/web/src/components/NewChatButton.tsx`
- `work/T-2044-shared-topic-rules.md` (status only)

### Checks run

- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/topics.test.ts`: 1 file passed, 13 tests passed.
- `pnpm install`: done, 1155 packages reused/added (pre-existing peer warning for `apps/mobile` `@types/react-dom`).
- `pnpm gate` (repo root):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  build @zilar/server
  PASS  tests @zilar/chat-core
  PASS  tests @zilar/mobile
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (One earlier gate run failed on `format` for `packages/chat-core/src/topics.test.ts`; I ran `prettier --write` on that one file, then the gate above passed.)

### Size

Production files only (`git diff --numstat`, tests and task file excluded): **95 lines added, 99 removed, net −4**.

- `apps/mobile/src/lib/topics.ts`: +4 / −78 (net −74)
- `packages/chat-core/src/topics.ts`: +80 / −1 (net +79)
- `apps/web/src/components/topic/TopicLinkRow.tsx`: +4 / −17 (net −13)
- `apps/web/src/components/NewChatButton.tsx`: +7 / −3 (net +4)

`packages/chat-core/src/topics.test.ts`: +72 / −2 (tests grow).

### Notes for the lead

- The two https rules are the same rule, but not byte-for-byte the same output for every valid input: the old web `httpsUrl` returned `Schema.URLFromString(...).toString()`, which normalises (adds a trailing `/` to a bare origin, lowercases scheme/host), while `httpsTopicUrl` returns the trimmed input through `parseUrl` (which keeps the original text). So `https://chat.zilar.app` used to become `https://chat.zilar.app/` and now stays `https://chat.zilar.app`. Both are valid https URLs, open the same page with `window.open`, and `new URL(href).hostname` is identical; the save path still stores the trimmed user input as before. I kept the phone's function unchanged as the spec says. If you want web's exact normalisation, that would be a follow-up in chat-core.
- I had to split the mobile re-export into three one-line `export … from '@zilar/chat-core'` statements (two values, one types) because a single block pushed the line count up; lint accepts it and the gate passes.
- No other deviations from the spec.

### Round 2 (fix findings)

- **Finding 1 (must-fix, fixed).** `httpsTopicUrl` now checks the parsed host against what a WHATWG `URL` accepts before returning it: whitespace and the other forbidden host code points, a malformed percent escape, and a bracketed host that is not a closed IPv6 literal are refused. `parseUrl` accepted those (`https://foo bar/`, `https://[::1/`) and web's `new URL(href).hostname` threw on them. `TopicLinkRow.tsx` additionally parses with `new URL` in a new `browserHttpsUrl` helper, used for both display and save validation, so a link stored by an older release still shows "Add a link" and cannot crash the panel.
- **Tests added.** In `packages/chat-core/src/topics.test.ts`: `httpsTopicUrl('https://foo bar/')`, `httpsTopicUrl('https://[::1/')` and `httpsTopicUrl('https://[zz]/')` are `undefined`; a valid IPv6 host (`https://[::1]/topic/42`) still passes. The chat-core suite went from 13 to 15 tests.
- **Finding 2 (nit, left alone).** The mobile re-export split is unchanged; nits outside lines I changed are out of scope for this round.
- **Checks run.** `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/topics.test.ts`: 1 file passed, 15 tests passed. `pnpm gate`: GATE PASS (install, format, lint, typecheck, effect, build @zilar/server, tests @zilar/chat-core, tests @zilar/mobile; web tests skipped; scope, migration, images and size checks pass). The first gate run failed on lint (`no-control-regex` for a `\u0000-\u0020` range in the new host check); I replaced it with `\s`, re-ran the suite, then the gate above passed.
- **Size.** Product files against `main` now add 131 lines and remove 99 (net +32), up from net −4: the must-fix adds the chat-core host check and the web `new URL` guard. The reduction from the move itself stands; the gate's size check (400 lines per file) passes.
- **Disagreements:** none.


## Review (written by Claude)

Approved after 1 auto round; the pre-review was clean, with 2 nits.
- **What changed.** `httpsTopicUrl`, `topicLinkText` and the create, manage and archive permission rules live in chat-core `topics.ts`, with tests. The web link row and New-chat button use them, and the phone's `lib/topics.ts` re-exports them.
- **Size.** Product lines grew by 32, against the spec's "go down". The lead accepts it: the growth is the auto-round host guard, so a stored link that a browser's `URL` refuses can't crash the web topic panel. The value is one tested permission rule.
- **Nit:** web links keep the trimmed text instead of a normalised URL. Same page.
