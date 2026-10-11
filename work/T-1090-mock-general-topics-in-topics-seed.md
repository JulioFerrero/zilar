---
id: T-1090
title: "Mock backend: seed every group's General as a real topics row, so GET /groups/:id/topics lists it (not only Dev team's)"
status: todo
milestone: M5
branch: task/T-1090-mock-general-topics-in-topics-seed
model: auto
effort: default
depends_on: [T-1088]
estimate: 0.15 day
---

# T-1090: Every seeded group's General is in the topics table

## Spec (written by Claude, do not edit)

### Why
This is the T-1048 follow-up. The lead probed main (2026-10-11) with `createMockBackend({ delayMs: 0 }).http('/api/groups/:id/topics')` for every group in `GET /api/chats`:
- `g-devteam` returns 7 topics;
- `g-acme`, `g-viernes`, `g-familia`, `g-qa`, `g-gym` and `g-product` each return **0**.

**The cause:**
- the topics table holds only Dev team's rows (`packages/mock-backend/src/domains/topics/seed.ts:14-178`, `seedTopics` at `:176`);
- the other groups' General lives only on the chat list entry, built by `withGeneralTopic` (`packages/mock-backend/src/domains/chats/general-topics.ts:44-60`, used at `domains/chats/seed.ts:15-83`).

So any screen that lists a group's topics through `/groups/:id/topics` (group info, topic pickers, the topic routes) shows none for those groups. The real server creates a General topic row for every group (`apps/server/src/groups/service.ts:157-171`, cited in `general-topics.ts:2-4`).

### What to build
1. **Seed the General rows:** `seedTopics` also returns one General `MockTopic` row for every seeded group that has no topic rows. Derive them from `mockGroups` (`domains/groups/seed.ts`).
   - Use the same id scheme and fields as `generalTopicRow` (`general-topics.ts:12-41`): `t-<group>-general`, the group's room `chatJid`, public, open and `isGeneral: true`.
   - Reuse `generalTopicRow` rather than copy it. If that needs it exported, or moved into the topics domain, do that.
2. **The chat list:** it must still show each group's General exactly as today, the same topic id, name and `chatJid`. Prefer building the entry's topics from the topics table, so a later topic edit is reflected and there is one source. If that is not straightforward, keep `withGeneralTopic` and make sure the ids match the new rows. Say which you did in the Report.
3. **Proof in the Report:** run a throwaway script, not committed, that probes `GET /api/groups/:id/topics` for all seven groups (each non-Dev group gives exactly 1, General). Also show that `GET /api/chats` gives the same General topic ids as before.
4. **Rules:** every file stays under 400 lines, no tests, and no app files change.

The lead's web check (`?mock=1`): open Familia, then group info, and its topics list shows General.

### Read first
`AGENTS.md`, `packages/mock-backend/src/domains/topics/seed.ts`, `packages/mock-backend/src/domains/topics/routes.ts`, `packages/mock-backend/src/domains/chats/general-topics.ts`, `packages/mock-backend/src/domains/chats/seed.ts`, and `packages/mock-backend/src/domains/groups/seed.ts`.

### Allowed files
`packages/mock-backend/src/domains/topics/seed.ts`, `packages/mock-backend/src/domains/chats/general-topics.ts`, `packages/mock-backend/src/domains/chats/seed.ts`, `packages/mock-backend/src/domains/chats/routes.ts`, `packages/mock-backend/src/domains/chats/state.ts`, `work/T-1090-mock-general-topics-in-topics-seed.md`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the two probes.

---

## Report (written by the worker when done)

## Review (written by Claude)
