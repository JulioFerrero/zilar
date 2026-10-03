---
id: T-0169
title: Mentions find people by @handle and show handles
status: planned
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

## Review (written by Claude)
