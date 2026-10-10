---
id: T-1060
title: "Mock sweep Q (mobile): delete the dead mock store apps/mobile/src/store/chat-store.ts (1,595 lines) and the four mocks only it imports"
status: todo
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

## Review (written by Claude)
