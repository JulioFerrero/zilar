---
id: T-0169
title: Mentions find people by @handle and show handles
status: merged
milestone: M5
branch: task/T-0169-mentions-by-handle
model: meta/muse-spark-1.3-contributor
effort: medium
depends_on: [T-0163]
estimate: 0.5 day
---

# T-0169: Mentions find people by @handle and show handles

## Spec (written by Claude, do not edit)

### Why
Mentions already exist in groups: typing `@` opens `MentionPicker`, `filterMentionMembers` matches by display name, a chosen member becomes a tracked mention (JID plus offsets) rendered as a chip, and a mention of you is highlighted. Since T-0163 every person can have a unique `@handle`, but the picker does not know it: typing `@julio` finds nobody unless the display name starts the same way, two people with the same display name cannot be told apart, and the inserted text never shows the handle.

### What to build
1. **Data.** `MentionMember` (`packages/chat-core/src/types.ts`) gains an optional `handle?: string | undefined`. Wherever the web builds the member list for the picker from the group members (which already carry `handle` since T-0163), pass it through. AIs have no handle in this task; they keep matching by name.
2. **Matching.** `filterMentionMembers` matches the typed query, case-insensitively, against the handle (prefix) and against the name (word prefix, as today). Handle prefix matches rank first, then name matches, ties in the existing order. Typing `@` alone lists as today. No match, no picker (as today).
3. **Picker rows.** Show the name and, when present, `@handle` in muted text; two people with the same display name are distinguishable. Keep the existing keyboard behavior and accessible names (the option's accessible name includes the handle).
4. **Inserted text.** Picking a member who has a handle inserts `@handle ` (with the trailing space, as today) and records the mention range over `@handle`; a member without a handle inserts `@Name` exactly as today. The mention still carries the JID, so servers, AIs and highlights behave the same. Backspace deleting a whole mention token keeps working for both forms.
5. **Rendering.** Chips and the "mention of me" highlight work from the stored range as today; make sure a message whose text contains `@handle` but whose range is missing is NOT turned into a chip (only tracked ranges count).
6. **Mock mode** members get handles so the picker is demonstrable.
7. Tests (Vitest, Testing Library): handle prefix match, name match, ranking, same display name distinguished, inserted text and range for both forms, backspace removes the token, a literal `@handle` without a range stays plain text.

### Read first
`AGENTS.md`, `packages/chat-core/src/types.ts` and the mention helpers (`filterMentionMembers`, `splitMentions`) with their tests, `apps/web/src/components/MentionPicker.tsx`, `Composer.tsx` (mention parts), `LinkText.tsx`, `apps/web/src/mock/`.

### Allowed files
`packages/chat-core/src/**` (mention types and helpers and their tests), `apps/web/src/components/MentionPicker.tsx`, `Composer.tsx` and their tests, `LinkText.tsx` only if rendering needs it, the web code that builds the member list for the picker, `apps/web/src/mock/**`, `work/T-0169-mentions-by-handle.md`. No server changes, no new dependencies, no mobile.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/chat-core test --maxWorkers=2
pnpm --filter @zilar/web test --maxWorkers=2 src/components/Composer src/components/MentionPicker src/components/MessageContent src/store
```

### Acceptance
- In a group, typing `@ju` offers the member whose handle starts with `ju`, even when the display name does not; two members named "Alex" show different handles.
- Picking inserts `@handle `, the message sends with a mention for that JID, and the receiver sees a chip (and the highlight if it is them).
- Members without a handle still work exactly as before. A typed `@handle` without a picked mention is plain text.

### Out of scope
Mentioning by handle someone who is not in the group, `@all`/`@here`, AI handles, push notifications for mentions, mobile.

---

## Report (written by the worker when done)

Done. Mentions now find people by `@handle` and show handles.

What changed:
- `packages/chat-core/src/types.ts`: `MentionMember` gains optional `handle?: string | undefined`.
- `packages/chat-core/src/mentions.ts`:
  - `filterMentionMembers` matches the query (case-/accent-insensitive, leading `@` stripped) against handle prefix, and against display-name word prefixes (whitespace-separated); handle matches rank first, then name matches, ties keep input order. Empty/`@` query returns everyone, as before.
  - `insertMention` inserts `@handle ` (range over `@handle`) when the member has a handle, else `@Name ` exactly as before. JID tracking, rebase, backspace and `splitMentions` are range-based and untouched (a literal `@handle` without a range stays plain text by construction).
- `apps/web/src/components/MentionPicker.tsx`: each row shows `name` plus `@handle` in muted text when present; the option's accessible name is `Name @handle` when a handle exists, else the name.
- Member-list plumbing passes handles through: `apps/web/src/store/store.ts` (`mentionMembersFor`), `apps/web/src/store/realStore.ts` (`applyGroupDetail`), `apps/web/src/mock/members.ts`. AIs keep no handle.
- `apps/web/src/mock/groups.ts`: mock people in c-devteam, c-viernes, c-familia get handles (`you`, `ana`, `luis`, `marco`, `marta`, `sofia`); AIs unchanged. c-qa/c-gym/c-product/c-acme untouched.
- No Composer.tsx logic change needed: it already funnels through `filterMentionMembers`/`insertMention`, and backspace deletion is range-based so it works for both token forms. No LinkText.tsx change needed: chips/highlight already render from tracked ranges only.
- Tests: `packages/chat-core/src/mentions.test.ts` (handle prefix match incl. name mismatch, ranking, order stability, later-word name match, bare-`@` list, handle insert + range, literal `@handle` without range stays text); `Composer.test.tsx` (handle offer/insert/send-with-JID, same-name pair distinguished, no-handle member inserts `@Name`; 5 existing assertions updated from `@Luis `/`@Marta ` to `@luis `/`@marta `); `MentionPicker.test.tsx` (handle shown, accessible names, same-name pair); `MessageContent.test.tsx` (tracked `@handle` range renders a chip, literal `@handle` is plain text).

Checks (all in `/Users/julio/personal-projects/zilar-T-0169`):
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint`: pass (oxlint, no output).
- `pnpm typecheck`: pass (11 tasks successful).
- `pnpm --filter @zilar/chat-core test --maxWorkers=2`: 11 files, 143 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 src/components/Composer src/components/MentionPicker src/components/MessageContent src/store`: 8 files, 222 tests passed.
- Extra: `src/mock` (7 files, 89 passed) and GroupPanel/Channels/TopicPanel (3 files, 55 passed) to cover the mock group-detail change.

Deviations: none. Security checklist: no secrets/logs/routes touched; no deletes/updates/caps changed; N/A items (401 sweep, audit, rate limits) don't apply — no server changes.

Files changed: `packages/chat-core/src/types.ts`, `mentions.ts`, `mentions.test.ts`; `apps/web/src/components/MentionPicker.tsx`, `MentionPicker.test.tsx`, `Composer.test.tsx`, `MessageContent.test.tsx`; `apps/web/src/store/store.ts`, `realStore.ts`; `apps/web/src/mock/groups.ts`, `members.ts`; this task file.

## Review (written by Claude)

Merged, no fix round. Pre-review: no must-fix. Nit 1 fixed by me (empty-string handle now treated like no handle in the picker label, token and matching). Nit 2: narrowing name matching from substring to word prefix is what the spec asks for. Nit 3: the extra MessageContent test change is test-only and covers spec item 7.

Checks: format, lint, typecheck pass; chat-core mentions tests 40 passed; web MentionPicker/Composer/MessageContent 52 passed; store/mock neighbours 248 passed.
