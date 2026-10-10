---
id: T-0936
title: "Audit (no code): a 400-line file limit and duplicated code: measure clones, plan a split for every source file over 400 lines, and plan a lint rule"
status: todo
milestone: M5
branch: task/T-0936-size-dup-audit
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0936: File size and duplication plan (audit)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-10: "I also see 1000+ line files! ... we need to find a way to reduce the number of lines in files, reuse code". He picked a **400-line limit**.

The lead measured `apps/*/src` and `packages/*/src`, without tests, `.d.ts` files or `routes.expected.ts`:
- 194,219 source lines;
- **87 files over 500 lines**, and **19 over 1,000**. The biggest:
  - mock code: `apps/web/src/mock/api.ts` 4,297, `apps/mobile/src/store/chat-store.ts` 1,595, `apps/web/src/store/mockStore.ts` 1,294, `apps/web/src/mock/messages.ts` 1,148;
  - `apps/web/src/lib/api.ts` 1,792;
  - server: `apps/server/src/agents/reply.ts` 1,585, `groups/service.ts` 1,583, `ais/service.ts` 1,390, `stickers/service.ts` 1,388, `tools/service.ts` 1,200, `topics/service.ts` 1,127, `actions/gateway.ts` 1,036, `approvals/service.ts` 1,030;
  - packages: `xmpp-core/src/core-effect.ts` 1,206, `client-core/src/store/ledger.ts` 1,176, `xmpp-core/src/stanza.ts` 1,078, `devtools/src/lead/policy.ts` 1,111;
  - UI: `apps/web/src/components/Composer.tsx` 1,145, `apps/mobile/src/app/chat/[id].tsx` 1,118.

The mock files are planned separately (T-0935), so leave them out.

### What to build
One document, `docs/audit/size-plan.md`, covering:
1. **Duplicated code:**
   - run a clone detector over `apps/*/src` and `packages/*/src`, excluding tests and mocks. `pnpm dlx jscpd@4` with a minimum of about 30 lines or 150 tokens works, or anything already in the repo;
   - list the clone groups, largest first, with their files and lines;
   - group them into web↔mobile copies (which go to `packages/chat-core` or `packages/client-core`), server copies (which go to a shared server helper), and others;
   - for each group, say where the one copy should live.
2. **Every non-mock source file over 400 lines:** a split plan with the new file names (by feature or responsibility, not "part 1 and 2"), what moves where, and what shared code removes lines rather than just moving them. Order them: files over 1,000 first, then over 600, then over 400.
3. **The lint rule:** whether oxlint (`.oxlintrc.json`) supports `max-lines`, and the exact config:
   - a warning at 400 lines for source files;
   - off for tests, mocks and generated files.

   Should it start as a warning and become an error once the splits land?
4. **The task split:** ordered tasks of at most about 800 changed lines each, every one with its files, `file:line` anchors and the expected line delta. **No behaviour change, and no new tests** (Julio's minimal-test rule in `AGENTS.md`). Each task is checked by typecheck, lint and the remaining tests.
5. **The totals:** the lines expected to be removed by deduplication, separate from the lines that are only moved.

Change no code.

### Read first
`AGENTS.md`, `.oxlintrc.json`, `docs/audit/simplify-plan.md`, `docs/STORE_CORE_PLAN.md`, and the files above.

### Allowed files
`docs/audit/size-plan.md`, `work/T-0936-size-dup-audit.md`.

### Checks
```bash
pnpm exec prettier --check docs/audit/size-plan.md
```

### Acceptance
- `docs/audit/size-plan.md` exists, with the clone list, a split plan for each file over 400 lines, the lint config, the ordered tasks and the totals, each claim with `file:line`.
- No code changes.

---

## Report (written by the worker when done)

## Review (written by Claude)
