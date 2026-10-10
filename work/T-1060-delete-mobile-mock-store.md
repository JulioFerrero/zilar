---
id: T-1060
title: "Mock sweep Q (mobile): delete the dead mock store apps/mobile/src/store/chat-store.ts (1,595 lines) and the four mocks only it imports"
status: merged
milestone: M5
branch: task/T-1060-delete-mobile-mock-store
model: auto
effort: default
depends_on: [T-1059]
estimate: 0.1 day
---

# T-1060: Delete the mobile mock store

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-sweep-status.md` §3. The lead confirmed it with grep on main (2026-10-10):
- `apps/mobile/src/store/chat-store.ts` (1,595 lines) has no importers in `apps/mobile/src`, `app` or `test`. Since T-0949, mock mode runs the real store (`apps/mobile/src/store/chat-store-provider.tsx:67-92`).
- These old mocks are imported only by `chat-store.ts`:
  - `apps/mobile/src/mock/contacts.ts` (8 lines)
  - `apps/mobile/src/mock/pins.ts` (86)
  - `apps/mobile/src/mock/invite-links.ts` (198)
  - `apps/mobile/src/mock/chat-prefs.ts` (66)
- `apps/mobile/src/lib/chat-list.ts` imports its own `./chat-prefs` and `./topics` from `lib/`, not the mocks.

### What to build
1. **Delete five files:**
   - `apps/mobile/src/store/chat-store.ts`
   - `apps/mobile/src/mock/contacts.ts`
   - `apps/mobile/src/mock/pins.ts`
   - `apps/mobile/src/mock/invite-links.ts`
   - `apps/mobile/src/mock/chat-prefs.ts`
2. **Check before deleting each one:** `grep -rn` its module name across `apps/mobile` (`src`, `app`, `test`, config files). If anything other than `chat-store.ts` imports it, do not delete that file; say so in the Report.
3. **Keep everything else.** That includes `mock/index.ts`, `chats.ts`, `channel.ts`, `messages.ts`, `topics.ts`, `voice.ts` and `directory.ts`, which are still used through `mock/search.ts` and `use-directory-api.ts`, and `mock/drafts.ts`, `mock/load.ts`, `mock/gate.ts`, `mock/time.ts`, `mock/backend.ts` and `mock/uploader.ts`.
4. **No other change.** If typecheck or lint shows that something else used these files, stop and report it instead of rewriting code.

The lead runs a phone smoke in mock mode afterwards: the chats list, a chat, and a group.

### Read first
`AGENTS.md`, `docs/audit/mock-sweep-status.md` §3-§4, and `apps/mobile/src/store/chat-store-provider.tsx`.

### Allowed files
`apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/mock/contacts.ts`, `apps/mobile/src/mock/pins.ts`, `apps/mobile/src/mock/invite-links.ts`, `apps/mobile/src/mock/chat-prefs.ts`, `work/T-1060-delete-mobile-mock-store.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report shows the grep for each deleted file, before the deletion.

---

## Report (written by the worker when done)

### What I did

Deleted the five dead files exactly as in the spec, after grepping each one first:

```bash
git rm apps/mobile/src/store/chat-store.ts \
       apps/mobile/src/mock/contacts.ts \
       apps/mobile/src/mock/pins.ts \
       apps/mobile/src/mock/invite-links.ts \
       apps/mobile/src/mock/chat-prefs.ts
```

Deleted (5 files, 1,953 lines): `apps/mobile/src/store/chat-store.ts`
(1,595), `apps/mobile/src/mock/invite-links.ts` (198), `mock/pins.ts` (86),
`mock/chat-prefs.ts` (66), `mock/contacts.ts` (8). No other file changed.

### Greps run before deleting (Acceptance)

`grep -rn chat-store apps/mobile` → 37 matches, **all** `@/store/chat-store-provider`
or `../../store/chat-store-provider` (screens, hooks, effects). No file imports
`store/chat-store`, so the store itself is unreferenced.

`grep -rn "(mock/contacts|mock/pins|mock/invite-links|mock/chat-prefs)" apps/mobile`
→ 7 matches, **all inside `apps/mobile/src/store/chat-store.ts`**:
- `:19` `../mock/invite-links`
- `:29` `../mock/pins`
- `:30` `../mock/chat-prefs`
- `:32` `../mock/contacts`
- `:588` dynamic `import('../mock/chat-prefs')`
- `:649` dynamic `import('../mock/pins')`
- `:671` dynamic `import('../mock/pins')`

No test, config, tsconfig, metro or jest file references any of them.

`grep -rn "from '.*(contacts|pins|invite-links|chat-prefs)'" apps/mobile` → the
only extra hits are `lib/chat-prefs` (the separate `apps/mobile/src/lib/chat-prefs.ts`,
used by `store/effects/*`, `lib/chat-list.ts` and screens) and `./effects/pins`
(a different module). Neither is `mock/chat-prefs.ts` or `mock/pins.ts`, so both
remain untouched, as the spec says.

Nothing else imported the deleted files, so all five were safe to delete.

### Checks

`pnpm gate` (repo root), real output:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (0.8s)
PASS  lint  (1.1s)
PASS  typecheck  (3.9s)
SKIP effect (no source files changed)
PASS  tests @zilar/mobile  (3.3s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 6 changed files are the 5 deletions plus this task file (front-matter status
only). No files outside the Allowed list.

I ran no single test file: the change is a pure deletion of unreferenced files,
and `pnpm gate`'s `@zilar/mobile` tests already passed (3.3s). I did not run
format/lint/typecheck separately, per `AGENTS.md`.

### Problems / deviations

None. No files outside the Allowed list were touched; no other change was needed.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The change:** deleted `apps/mobile/src/store/chat-store.ts` (1,595 lines) and the four old mocks only it imported: `mock/{contacts,pins,invite-links,chat-prefs}.ts`. In total, 1,954 lines removed, with no code changed.
- **What the lead checked:**
  - before the spec, `grep` on main found no importer;
  - on the branch, no `require(` names a deleted file.
- **The lead's phone smoke** (mock):
  - the Chats tab lists every chat with its folder chips;
  - Ana's chat opens;
  - Dev team opens with its 7 topics. Familia, QA squad and Product show their General ("1 topic").
- **Check:** the gate passed, including the `@zilar/mobile` tests.
