---
id: T-1090
title: "Mock backend: seed every group's General as a real topics row, so GET /groups/:id/topics lists it (not only Dev team's)"
status: merged
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

### What I did

Every seeded group now has a General row in the topics table, so
`GET /groups/:id/topics` lists General for all seven groups, not only Dev team.

- `chats/general-topics.ts`: `generalTopicRow` now takes `(groupId, chatJid)` and
  is exported; added `groupRoomJid(groupId)`, the one source of the seeded
  groups' room JIDs (`g-devteam` → `dev-team@rooms.zilar.test`, every other
  group → `<id without g->@rooms.zilar.test`). Removed `generalTopicView` and
  `withGeneralTopic`, unused once the chat list reads the table.
- `topics/seed.ts`: the seven Dev team rows are now `devTeamTopics`; `seedTopics`
  returns those plus one `generalTopicRow(group.id, groupRoomJid(group.id))` for
  each `mockGroups` group they do not already cover. Removed
  `seedTopicViews`/`SEED_SOURCE` (dead once nothing reads them).
- `chats/seed.ts`: group entries use `groupRoomJid(...)` for `chatJid` and no
  longer carry a `topics` array. The chat list gets every group's topics from the
  live table through `withTopics` in `chats/routes.ts` — the spec's preferred
  "build the entry's topics from the topics table" path; `withGeneralTopic` was
  not kept.
- `chats/routes.ts`: comment only (the "legacy row" fallback no longer exists).

No app file changed; all four source files are well under 400 lines (166, 50,
97, 29).

### Checks

```
$ pnpm --filter @zilar/mock-backend typecheck
> tsc --noEmit
(exit 0, no output)

$ pnpm gate
gate: 5 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.1s)
PASS  lint  (0.8s)
PASS  typecheck  (1.9s)
PASS  effect  (0.6s)
SKIP tests @zilar/mock-backend (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Probes (throwaway, not committed)

Run with `pnpm --filter @zilar/devtools exec tsx <file>` against
`createMockBackend({ delayMs: 0 }).http(...)`; the script was deleted afterwards.
"before" is the same probe with the four source files stashed (i.e. `main`).

**1. `GET /api/groups/:id/topics`**

```
                         BEFORE   AFTER
g-devteam                   7       7
g-acme                      0       1
g-viernes                   0       1
g-familia                   0       1
g-qa                        0       1
g-gym                       0       1
g-product                   0       1
```

Every non-Dev group's single row is General, e.g. after:
`g-familia: 1 topic(s); general=[{"id":"t-familia-general","name":"General","chatJid":"familia@rooms.zilar.test"}]`.
(All six: `t-acme-general`/`acme@rooms.zilar.test`, `t-viernes-general`,
`t-familia-general`, `t-qa-general`, `t-gym-general`, `t-product-general`, each
`name: "General"`.)

**2. `GET /api/chats` General rows — identical before and after:**

```
g-acme:      [{"id":"t-acme-general","name":"General","chatJid":"acme@rooms.zilar.test"}]
g-devteam:   [{"id":"t-devteam-general","name":"General","chatJid":"dev-team@rooms.zilar.test"}]
g-viernes:   [{"id":"t-viernes-general","name":"General","chatJid":"viernes@rooms.zilar.test"}]
g-familia:   [{"id":"t-familia-general","name":"General","chatJid":"familia@rooms.zilar.test"}]
g-qa:        [{"id":"t-qa-general","name":"General","chatJid":"qa@rooms.zilar.test"}]
g-gym:       [{"id":"t-gym-general","name":"General","chatJid":"gym@rooms.zilar.test"}]
g-product:   [{"id":"t-product-general","name":"General","chatJid":"product@rooms.zilar.test"}]
```

### Deviation to note

The General row's `memberCount` changes for the non-Dev groups on `/chats`,
because the row's view is now built by `groupTopicViews` and
`viewSourceFromData` derives a public topic's count from the group's member list
(`topics/view.ts:62`, not in scope). Before → after:

`g-acme 120→3`, `g-viernes 5→5`, `g-familia 4→2`, `g-qa 4→2`, `g-gym 8→2`,
`g-product 5→2`, `g-devteam 4→4`.

The spec's chat-list requirement names the same topic id, name and `chatJid`,
and those are unchanged. The chat list now agrees with `/groups/:id/topics`
(and with the group's member list); the alternative (keeping `withGeneralTopic`)
would make the two routes disagree, so I took the one-source path the spec asks
for.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 follow-up (a stale comment).**
- **The change:** `seedTopics` seeds a General row for every group without topic rows, through the shared `generalTopicRow`. The chat list's General comes from the same row.
- **The lead's re-run of the probe** (branch backend): `GET /api/groups/:id/topics` gives 1 (General) for `g-acme`, `g-viernes`, `g-familia`, `g-qa`, `g-gym` and `g-product`, and 7 for `g-devteam`. On main it gave 0 for the six.
- **The lead's web check** (`?mock=1`):
  - the chat list still shows Familia › General at `familia@rooms.zilar.test`;
  - the chat opens, and Topic info shows "All 2 members of Familia can read and write here.".
- **Noted, accepted:** the General topics' `memberCount` on `/chats` now follows each group's seeded member list (Acme 120→3, Familia 4→2, and so on), so `/chats` and `/groups/:id/topics` agree. The group entries' own counts (for example "120 subscribers") are not part of this.
- **Check:** the gate passed.
