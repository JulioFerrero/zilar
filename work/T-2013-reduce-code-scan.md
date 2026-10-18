---
id: T-2013
title: "Code reduction scan (read-only): measure duplication (jscpd), unused files/exports/deps (knip), web-vs-phone twin modules, and hand-rolled helpers a library covers — numbers and file lists in docs/audit/reduce-scan.md, no code changes"
status: merged
milestone: M5
branch: task/T-2013-reduce-code-scan
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2013: Code reduction scan

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the repo has about 272k lines of code, and he wants it smaller:
- share components and functions;
- use libraries instead of hand-writing everything.

This task is the cheap first pass: tools measure, and nothing is changed. A Claude audit then reads only the hotspots this scan finds and writes the fix plan. Earlier rounds to build on, and not repeat:
- `docs/audit/dedup-status.md` (T-1051, 2026-10-10);
- `docs/audit/library-plan.md` (T-1342, 2026-10-13);
- `docs/audit/simplify-plan.md`;
- `docs/audit/size-plan.md`.

### Facts (measured by the lead on 2026-10-18 at `f11c106ff`)
- **Size.** `git ls-files '*.ts' '*.tsx'` lists 2,580 files. Non-test source is about 277k lines:
  - `apps/mobile` 83.1k, `apps/server` 82.3k, `apps/web` 58.9k;
  - `packages/devtools` 13.9k, `packages/client-core` 8.9k, `packages/chat-core` 5.7k;
  - `packages/api-contract` 5.0k, `packages/xmpp-core` 4.9k, `packages/desk` 4.5k;
  - `packages/runner-tunnel` 3.4k, `apps/site` 2.8k, `packages/protocol` 1.6k, `apps/runner` 1.6k.
- **Tests and mocks** are about 74k lines more, of which `apps/server` holds 35.2k and `packages/mock-backend` 10.5k.
- **No tooling.** Neither `jscpd` nor `knip` is in any `package.json`, and there is no config file for either.

### Steps
Run every tool with `pnpm dlx <tool>@<exact version>`. Pick the current version with `npm view <tool> version` and write it in the doc. Write tool output only under `/tmp/zilar-T-2013/`. Never commit configs, tool output or `package.json` changes. Use `nice -n 10` for heavy runs. If a tool fails or runs over 10 minutes, write that in the doc and go on.

1. **Duplication (jscpd)** over `apps/*/src` and `packages/*/src`.
   - Settings: `--min-lines 8 --min-tokens 70 --reporters json`.
   - Ignore tests (`**/*.test.*`), `**/test-*`, mocks, `**/generated/**`, `dist` and `node_modules`.
   - In the doc, write:
     - the overall duplicated-line percentage, per app and per package;
     - the **40 largest clone clusters**, each with both locations (`file:start-end`), its size in lines, and a one-line guess of what it is;
     - a separate list of clusters that span `apps/web` and `apps/mobile`. Those are the candidates for moving logic into `packages/client-core` or `packages/chat-core`.
2. **Unused code (knip)** at the repo root, with workspace auto-detection.
   - Report counts and the full lists of unused files, unused exports (top 100 by file), and unused dependencies per `package.json`.
   - Mark anything that looks like a false positive: entry points, Expo config plugins, test-only exports.
3. **Web and phone twins.** List the modules that exist in both `apps/web/src` and `apps/mobile/src` under the same name, ignoring case and `-`/`_` (for example `MessageBubble.tsx` and `message-bubble.tsx`). For each pair give both line counts and jscpd's shared lines. Then list the pairs that hold **non-UI logic**: hooks, stores, formatting, parsing. Mark those that could move to a shared package.
4. **Hand-rolled helpers.** Grep for local implementations of common helpers, and give `file:line` for each:
   - debounce and throttle; deep equality; LRU or TTL caches; retry with backoff;
   - relative-time and date formatting; byte-size and duration formatting;
   - UUID or random ids; URL and query building; Markdown or text parsing; color math;
   - copy-to-clipboard; and `sleep` and `withTimeout` helpers.

   For each kind, say whether a dependency the repo **already has** covers it. Check with `grep` in the `package.json` files: for example `effect` (Duration, Cache, Schedule), `date-fns` or `dayjs`, `@base-ui/*`, and React Native libraries. If none does, name one well-known library. Do not install anything.
5. **Write `docs/audit/reduce-scan.md`.** Start with a summary table of the five areas above and the estimated deletable lines, using the numbers you measured. Then give one section per step. Put no recommendations beyond what the numbers show; the Claude audit decides.

### Allowed files
- `docs/audit/reduce-scan.md`
- `work/T-2013-reduce-code-scan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/reduce-scan.md` exists, and every number in it comes from a tool run recorded in the doc, with the tool's version.
- No other file changed, and the gate passes.

---

## Report (written by the worker when done)

### What I did

Read-only measurement; no code, config or `package.json` changes.

- **Duplication (jscpd 5.4.1).** Ran the overall scan over `apps/*/src` and `packages/*/src` with `--min-lines 8 --min-tokens 70 --reporters json`, ignoring tests, test helpers, mocks/`mock-backend`, generated, dist and node_modules. Result: 260 clones, 4,558 duplicated lines of 275,060 (1.66%). Then ran the same command once per app/package to get per-unit percentages. Wrote all 40 largest clusters with both `file:start-end` locations, sizes and a one-line guess, and all 55 clusters that span `apps/web` × `apps/mobile` (1,119 lines).
- **Unused code (knip 6.42.0).** Root run with workspace auto-detection. Result: 25 unused files, 1,393 unused exports in 513 files, 516 unused types, 5 unused dependencies and 8 unused devDependencies. The doc has the full unused-file list, the full dependency list and the full export list for the top 100 files, each marked as true or false positive. Knip could not load `apps/mobile/metro.config.js` (missing `tailwind.config`); it still produced the full JSON report and exited 2.
- **Twins.** Matched all `.ts`/`.tsx` basenames between `apps/web/src` and `apps/mobile/src`, lowercased and stripped `-`/`_`: 224 pairs, 219 non-test, 600 exact shared lines across 25 pairs. The full table is Appendix A; the ~30 pairs that hold non-UI logic (hooks, stores, formatting, parsing, API) are listed separately with a move candidate.
- **Hand-rolled helpers.** Grepped for all 13 requested kinds and recorded 57 `file:line` sites. Every kind says whether an installed dependency covers it (`effect` for debounce/cache/retry/sleep/timeout, `expo-clipboard`, `@zilar/chat-core` formatting helpers); no dependency was installed. Noted the 394-line mobile Markdown parser and the local `formatSize`/`formatDuration`/`formatMs`/`formatRelative` duplicates.
- **Doc.** `docs/audit/reduce-scan.md` (677 lines) has the five-area summary table with estimated deletable lines, then one section per step.

Files changed: `docs/audit/reduce-scan.md` (new) and `work/T-2013-reduce-code-scan.md` (status + this report). Nothing else.

### Checks run

- `pnpm install` — done in 15s (`pnpm v10.32.1`), peer warning for `apps/mobile` `@types/react-dom` only (pre-existing).
- `npm view jscpd version` — `5.4.1`; `npm view knip version` — `6.42.0`.
- `pnpm dlx jscpd@5.4.1 ...` — `260` clones, `4,558/275,060` duplicated lines, `1.66%`, `1,931` files.
- Per-unit jscpd loop (15 runs) — `apps/mobile 1.30%`, `apps/server 1.37%`, `apps/web 1.15%`, `packages/client-core 1.20%`, `packages/desk 1.00%`, `packages/devtools 0.69%`, `packages/runner-tunnel 0.50%`; the other units 0.00%.
- `pnpm dlx knip@6.42.0 ...` — 25 files / 1,393 exports / 516 types / 5 deps / 8 devDeps; exited 2 after `Error loading apps/mobile/metro.config.js (Cannot find module 'tailwind.config')`, JSON report still written.
- No single test files were run: the change touches docs only.
- `pnpm gate` — `GATE PASS`:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.0s)
PASS  lint  (1.3s)
PASS  typecheck  (1.2s)
SKIP  effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- Biggest measured single items: `apps/mobile/src/types/xmpp.d.ts` ↔ `packages/xmpp-core/src/types/xmpp.d.ts` (97 lines, ambient `@xmpp/client` types); `apps/server/src/effect/runtime.ts` + `effect/logger.ts` (133 lines, no importer after the Effect edge migration); `apps/web/src/components/ais/templates.ts`, `apps/server/src/voice-transcription/schemas.ts`, `apps/server/src/xmpp/routes.ts`, `apps/mobile/src/lib/whistle-last-voice.ts` (41 lines of re-export shims with no importer); the 394-line mobile Markdown parser.
- `packages/mock-backend` is excluded by the mocks ignore, and `packages/ball-avatar` has no `src` directory (its code is `index.ts` at the package root), so neither appears in the per-unit table; both are noted in the doc.
- The knip `metro.config.js` failure may hide some mobile imports from knip; no config was added to work around it, because the task forbids committing tool configs.
- Estimated totals in the summary are deliberately ranges: 4,558 duplication lines, 174 confirmed dead lines, and up to 1,909 export/type lines. The twin shared lines overlap the duplication total and are not added.
- Prior rounds (`dedup-status.md`, `library-plan.md`, `simplify-plan.md`, `size-plan.md`) were only used as context; no attempt was made to re-measure their claims.


## Review (written by Claude)

Approved. The pre-review checked the numbers against the raw tool output.

What the scan found:
- **Exact clones:** 4,558 lines (1.66%). 1,119 of them are clones between web and phone.
- **Dead code (knip):** 174 lines in dead files, plus unused exports and dependencies.
- **Twins:** 219 web/phone twin modules. About 30 of them are non-UI logic, each kept separately in both apps.

The big win is not exact copies but shared logic in the twins. Next, the lead runs a Claude plan over the non-UI twin pairs and the store adapters, and sends the mechanical items (dead files, unused dependencies, server clones) straight to workers.
