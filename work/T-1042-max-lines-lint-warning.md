---
id: T-1042
title: "Lint: oxlint max-lines warning at 400 for source files; tests, mocks, the emoji table and .d.ts files are off"
status: merged
milestone: M5
branch: task/T-1042-max-lines-lint-warning
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.1 day
---

# T-1042: The 400-line lint warning

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file. Most of the size-plan splits are merged, so the remaining files over 400 should show up in every lint run. That keeps the list from growing again. The plan is `docs/audit/size-plan.md` §3, which verified that oxlint 1.85 has `max-lines`. A warning does not fail `pnpm lint` (`package.json:14`, `oxlint .`) or the gate's lint step (`packages/devtools/src/gate/plan.ts:144`).

### What to build
Only `.oxlintrc.json` changes. Keep everything in it and add the following.

1. A top-level `"rules"` object: `"max-lines": ["warn", { "max": 400, "skipBlankLines": false, "skipComments": false }]`.
2. One more entry in the existing `"overrides"` array that sets `"max-lines": "off"` for test and generated files:
   - `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx`;
   - `**/*.test-harness.ts`, `**/test-support.ts`, `**/test-support/**`;
   - `**/*.d.ts`.
3. One more entry that sets `"max-lines": "off"` for mocks and data:
   - `apps/mobile/src/mock/**` and `packages/mock-backend/**`;
   - `apps/mobile/src/store/chat-store.ts`, which the mock rebuild replaces;
   - `apps/mobile/src/lib/emoji-data.ts`, a hand-kept emoji table.
4. Leave the existing `apps/mobile/src/app/**/*.tsx` `react/rules-of-hooks` override as it is.

### Read first
`AGENTS.md`, `docs/audit/size-plan.md` §3, and `.oxlintrc.json`.

### Allowed files
`.oxlintrc.json`, `work/T-1042-max-lines-lint-warning.md`.

### Checks
```bash
pnpm lint
pnpm gate
```

### Acceptance
- `pnpm lint` exits 0.
- The Report pastes the `max-lines` warning lines. Each file named is a source file over 400 lines (`wc -l`), and no test, mock or `emoji-data.ts` file appears among them.
- The Report also gives the count of those warnings.

---

## Report (written by the worker when done)

### What I did

Config-only change, as the spec says: `max-lines` warning at 400 for source files, `off` for tests, test support, `.d.ts`, mocks and data.

`.oxlintrc.json` changed exactly as the spec asks:

1. Added top-level `"rules": { "max-lines": ["warn", { "max": 400, "skipBlankLines": false, "skipComments": false }] }`.
2. Added an `overrides` entry with `"max-lines": "off"` for `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx`, `**/*.test-harness.ts`, `**/test-support.ts`, `**/test-support/**`, `**/*.d.ts`.
3. Added an `overrides` entry with `"max-lines": "off"` for `apps/mobile/src/mock/**`, `packages/mock-backend/**`, `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/lib/emoji-data.ts`.
4. Left the existing `apps/mobile/src/app/**/*.tsx` `react/rules-of-hooks` override untouched.

### Deviation from the spec (please confirm)

The spec's file lists in items 2–3 are narrower than the Acceptance and the task title ("tests, mocks, the emoji table and .d.ts files are off"). Following the lists literally left three test/mock files warned, which fails the Acceptance ("no test, mock or `emoji-data.ts` file appears among them"):

- `apps/web/src/mock/api.ts` (4297 lines) and `apps/web/src/mock/messages.ts` (1148 lines): mocks, not covered by item 3 (which names only `apps/mobile/src/mock/**` and `packages/mock-backend/**`).
- `packages/runner-tunnel/src/test-harness.ts` (468 lines): a test harness, not matched by item 2's `**/*.test-harness.ts` (that glob requires a dotted prefix, so it catches `apps/server/src/agents/gateway.test-harness.ts` but not `test-harness.ts`).

To meet the Acceptance I added the two minimal globs `apps/web/src/mock/**` and `**/test-harness.ts` to those same overrides. With them, no test, mock or data file is warned. If you intended those three files to stay warned, say so and I will remove the two globs; without them the Acceptance cannot pass. I did not block on this because the task title, the Acceptance and `docs/audit/size-plan.md` §3 ("mocks ... are off") all point the same way, and the extra globs only switch a warning off.

### Files changed

- `.oxlintrc.json` (Allowed).
- `work/T-1042-max-lines-lint-warning.md` (Allowed; this Report and status).

### Commands and real results

- `pnpm install`: done, 18.1s, `Done` (one pre-existing unmet peer warning: `@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18; unrelated to this task).
- `pnpm lint`: exit 0. After the rule is on: 33 `max-lines` warnings, none of them a test/mock/emoji/`.d.ts` file.
- `wc -l` on the 33 warned files: every one is over 400; the smallest is 404 (`apps/server/src/machines/api.ts`, `apps/server/src/auth/sql-adapter.ts`).
- `pnpm exec prettier --write .oxlintrc.json`: `unchanged`.
- `pnpm gate` (from repo root), summary lines:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.0s)
PASS  lint  (0.6s)
PASS  typecheck  (1.2s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
GATE PASS
```

Tests were skipped by the gate (no source files changed). No per-file test run was needed: the change is config only.

### The 33 `max-lines` warnings (`pnpm lint`)

```
apps/server/src/config.ts:507:2: warning eslint(max-lines): File has too many lines (507). help: Maximum allowed is 400.
apps/server/src/setup/api.ts:441:2: warning eslint(max-lines): File has too many lines (441). help: Maximum allowed is 400.
apps/server/src/main.ts:713:2: warning eslint(max-lines): File has too many lines (713). help: Maximum allowed is 400.
apps/server/src/app.ts:625:2: warning eslint(max-lines): File has too many lines (625). help: Maximum allowed is 400.
apps/server/src/search/routes.ts:542:2: warning eslint(max-lines): File has too many lines (542). help: Maximum allowed is 400.
apps/server/src/db/rows.ts:426:2: warning eslint(max-lines): File has too many lines (426). help: Maximum allowed is 400.
apps/server/src/auth/sql-adapter.ts:404:2: warning eslint(max-lines): File has too many lines (404). help: Maximum allowed is 400.
apps/server/src/approvals/api.ts:562:2: warning eslint(max-lines): File has too many lines (562). help: Maximum allowed is 400.
apps/server/src/machines/api.ts:404:2: warning eslint(max-lines): File has too many lines (404). help: Maximum allowed is 400.
apps/server/src/topics/access.ts:688:2: warning eslint(max-lines): File has too many lines (688). help: Maximum allowed is 400.
apps/server/src/ai/litellm-client.ts:589:2: warning eslint(max-lines): File has too many lines (589). help: Maximum allowed is 400.
apps/server/src/sandbox/tool-worker.ts:616:29: warning eslint(max-lines): File has too many lines (616). help: Maximum allowed is 400.
apps/server/src/effect/edge.ts:434:2: warning eslint(max-lines): File has too many lines (434). help: Maximum allowed is 400.
apps/server/src/agents/gateway/group-turn.ts:571:2: warning eslint(max-lines): File has too many lines (571). help: Maximum allowed is 400.
apps/web/src/store/store.ts:555:32: warning eslint(max-lines): File has too many lines (555). help: Maximum allowed is 400.
apps/web/src/store/realStore.ts:524:2: warning eslint(max-lines): File has too many lines (524). help: Maximum allowed is 400.
apps/web/src/store/effects/ports.ts:427:2: warning eslint(max-lines): File has too many lines (427). help: Maximum allowed is 400.
apps/web/src/store/effects/groups.ts:548:6: warning eslint(max-lines): File has too many lines (548). help: Maximum allowed is 400.
apps/mobile/src/store/real-store.ts:693:2: warning eslint(max-lines): File has too many lines (693). help: Maximum allowed is 400.
apps/mobile/src/store/types.ts:507:2: warning eslint(max-lines): File has too many lines (507). help: Maximum allowed is 400.
apps/mobile/src/store/effects/groups.ts:586:2: warning eslint(max-lines): File has too many lines (586). help: Maximum allowed is 400.
apps/mobile/src/lib/chat-api.ts:439:2: warning eslint(max-lines): File has too many lines (439). help: Maximum allowed is 400.
apps/mobile/src/lib/markdown.ts:410:2: warning eslint(max-lines): File has too many lines (410). help: Maximum allowed is 400.
apps/mobile/src/components/chat/channel-screen.tsx:408:2: warning eslint(max-lines): File has too many lines (408). help: Maximum allowed is 400.
apps/mobile/src/components/chat/message-list.tsx:418:2: warning eslint(max-lines): File has too many lines (418). help: Maximum allowed is 400.
apps/mobile/scripts/boot-check.mjs:805:3: warning eslint(max-lines): File has too many lines (805). help: Maximum allowed is 400.
packages/client-core/src/store/lifecycle.ts:405:6: warning eslint(max-lines): File has too many lines (405). help: Maximum allowed is 400.
packages/devtools/src/lead/autopilot.ts:664:2: warning eslint(max-lines): File has too many lines (664). help: Maximum allowed is 400.
packages/devtools/src/lead/client.ts:421:2: warning eslint(max-lines): File has too many lines (421). help: Maximum allowed is 400.
packages/devtools/src/lead/cli.ts:419:2: warning eslint(max-lines): File has too many lines (419). help: Maximum allowed is 400.
packages/runner-tunnel/src/mux.ts:471:2: warning eslint(max-lines): File has too many lines (471). help: Maximum allowed is 400.
packages/runner-tunnel/src/server.ts:614:2: warning eslint(max-lines): File has too many lines (614). help: Maximum allowed is 400.
packages/runner-tunnel/src/runner.ts:646:2: warning eslint(max-lines): File has too many lines (646). help: Maximum allowed is 400.
```

**Count: 33.** Each named file is a source file over 400 lines (`wc -l`, min 404). No test, mock or `emoji-data.ts` file appears. (`apps/mobile/scripts/boot-check.mjs` is a boot-check script, not a test or mock; it stays warned, as the spec did not list scripts.)

### Acceptance check

- `pnpm lint` exits 0: yes.
- Warning lines pasted, each over 400 by `wc -l`, none test/mock/emoji: yes.
- Warning count given: 33.

### Problems / open questions

- The spec-list vs Acceptance mismatch described under "Deviation". Everything passes with the two added globs.
- No secret, permission or data-boundary concerns: this is a lint config file only.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The change:** `.oxlintrc.json` gets `max-lines` as a warning at 400, and two `off` overrides (tests and generated files; mocks and data). The `rules-of-hooks` override is untouched.
- **The nit:** two globs the spec left out, `**/test-harness.ts` and `apps/web/src/mock/**`. The lead accepts both: without them `packages/runner-tunnel/src/test-harness.ts` and the web mock files would warn, against the Acceptance.
- **The lead ran `pnpm lint` on the branch:** exit 0 and 33 `max-lines` warnings. None of them is a test, mock, harness, support or emoji-data file.
- **Check:** the gate passed.
