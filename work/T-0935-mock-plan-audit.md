---
id: T-0935
title: "Audit (no code): plan a better mock mode, where both apps' real stores run on one shared fake backend (fake HTTP plus fake XMPP), replacing the two hand-written mock stores and the duplicated mock data"
status: todo
milestone: M5
branch: task/T-0935-mock-plan-audit
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0935: Mock mode plan (audit)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-10: "we need the mock mode so you can test and we can see new features, etc, its good but maybe we can do better". Today the mock code is 12,447 lines (the lead measured it):
- **web:** `apps/web/src/mock/` (12 files, 6,331 lines, with `api.ts` at 4,297) and `apps/web/src/store/mockStore.ts` (1,294; `createChatStore` at `:434`, re-exported at `apps/web/src/store/store.ts:40`);
- **mobile:** `apps/mobile/src/mock/` (26 files, 3,227 lines, one per domain) and `apps/mobile/src/store/chat-store.ts` (1,595, an in-memory mock store);
- **the switches:** web decides in `apps/web/src/mock/gate.ts` (`resolveMockMode`), and in mock mode `request()` in `apps/web/src/lib/api.ts` answers from `mock/api.ts`. Mobile decides in `apps/mobile/src/store/chat-store-provider.tsx`.
- `packages/xmpp-core/src/testing.ts` (88 lines) already has `createFakeXmppCore`.

So each app keeps its own fake store next to the real one, and its own copy of the fake data. The real stores now run on `packages/client-core/src/store`.

### What to build
One document, `docs/audit/mock-plan.md`, covering:
1. **Inventory:** what each mock file fakes (which endpoints, which store actions, which seed data), with `file:line`, and where web and mobile duplicate each other.
2. **The design:** mock mode runs each app's **real** store, unchanged, against a shared fake backend in one package:
   - a fake HTTP layer answering the `packages/api-contract` endpoints from in-memory data. Say whether the contract's HttpApi groups can be served by an in-memory handler, or whether a plain `request()` switch is simpler;
   - a fake XMPP core built on `createFakeXmppCore`: send and echo, rooms, MAM history, typing, reads;
   - one seed data set.

   Name the package, its folders and its public API.
3. **What it must cover:** every screen Julio uses to see a new feature (chats, topics, groups, AIs, approvals, stickers, voice, attachments, search, settings), so mock mode stays useful for demos and the lead's checks. List anything that is not worth faking.
4. **The task split:** ordered tasks of at most about 800 changed lines each, every one with its files, `file:line` anchors, what gets deleted, and how to check it (the app runs in mock mode on web at `?mock=1`, and on the mobile emulator). Include the target total line count.
5. **Risks and open questions** for Julio, if any.

Change no code.

### Read first
`AGENTS.md`, `docs/STORE_CORE_PLAN.md` (sections 4 and 9), the files above, `apps/web/src/lib/api.ts` (the `request()` mock branch), and `packages/api-contract/src/api.ts`.

### Allowed files
`docs/audit/mock-plan.md`, `work/T-0935-mock-plan-audit.md`.

### Checks
```bash
pnpm exec prettier --check docs/audit/mock-plan.md
```

### Acceptance
- `docs/audit/mock-plan.md` exists, cites `file:line` for every claim, and gives the task split and the target line count.
- No code changes.

---

## Report (written by the worker when done)

## Review (written by Claude)
