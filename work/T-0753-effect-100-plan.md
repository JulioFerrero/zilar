---
id: T-0753
title: "AUDIT (docs only): the plan to a 100% Effect codebase — define '100%' precisely (which code must use Effect and which may stay plain), inventory every package against it with file:line facts, and write an ordered, small-task plan in docs/audit/effect-100-plan.md"
status: merged
milestone: M5
branch: task/T-0753-effect-100-plan
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0753: the plan to 100% Effect (audit)

## Spec (written by Claude, do not edit)

### Why
On 2026-10-09 Julio asked for "a 100% effect project" and a plan to get there. The legacy libraries are gone: Hono, drizzle, zod and zustand have zero imports, and drizzle left in T-0751. Measured by "the file imports `effect` or `@effect/*`" (non-test `.ts`/`.tsx`), the codebase stands at:

| Package | Effect files | Share of lines |
| --- | --- | --- |
| `apps/server` | 137 / 204 | 83% |
| `apps/web` | 6 / 210 | 7% |
| `apps/mobile` | 29 / 329 | 14% |
| `apps/runner` | 3 / 5 | — |
| `apps/site` | 0 / 8 | — |
| `packages/xmpp-core` | 0 / 9 (2851 lines) | — |
| `packages/chat-core` | 0 / 16 (1555 lines) | — |
| `packages/devtools` | 7 / 38 | — |
| `packages/protocol` | 12 / 14 | — |
| `packages/runner-tunnel` | 3 / 9 | — |
| `packages/agent-drivers` | 1 / 5 | — |
| `packages/ui-tokens` | 0 / 1 | — |
| **Total** | **198 / 848** | **36%** of 191k lines |

A pure React component or a pure helper importing nothing from Effect is fine. "100%" needs a precise definition, and that definition is the first deliverable.

### What to write: `docs/audit/effect-100-plan.md`
1. **The definition of 100%.** State, as a rule a script can check, which code must use Effect and which may stay plain.
   - **Must use Effect:** I/O (network, XMPP, storage, files, timers), async control flow and concurrency, typed errors, resources with a lifetime, validation and decoding (Schema), shared and app state (atoms), config, logging.
   - **May stay plain:** pure functions with no failure mode, pure presentational React components, types, constants, generated files, and React glue that only renders atoms.
   - Read the project's existing Effect guidance first: `docs/EFFECT_GUIDE.md`, `docs/ROADMAP_EFFECT.md`, `docs/audit/effect-everywhere-plan.md` and `docs/audit/effect-atom-react-plan.md`. Do not contradict decisions recorded there; cite them.
   - Propose how the map (T-0752, `packages/devtools/src/effect-map/`) can measure it. For example, a file is "needs-effect" when it uses `async`/`await`, `Promise`, `fetch`, `setTimeout`, `try`/`catch`, `localStorage`, `WebSocket`, `JSON.parse` on input, or React state hooks for shared state, and does not import Effect. Give the exact patterns and their known false positives.
2. **The inventory, per package,** smallest first. For every file that fails the rule, give `path:line` and what fails (for example "Promise-based XMPP client at `packages/xmpp-core/src/client.ts:NNN`"). Group the files by module. Count the files and lines per package.
3. **Designs for the big pieces,** short and concrete, citing the existing code:
   - **xmpp-core** to Effect: `Stream` for stanzas, `Scope` for the connection, typed errors, and how web and mobile then consume it;
   - **chat-core**;
   - **the web data layer** (fetch calls, the API client), and the same for mobile;
   - **the runner and devtools leftovers**.

   For each, say what stays plain and why, and what the migration risk is (the user-visible flows to test on web and on the Android emulator).
4. **An ordered task list.** Tasks of about 0.5 day or less, each with its files, its tests, its dependencies and a "web" or "mobile" tag. Mark the tasks that need Julio, such as a new dependency or a behaviour risk on login or messaging. Follow `docs/LEAD_LOOP.md` sizing: one folder per task where possible, and at most 3 mobile tasks in parallel.
5. **A projection:** the Effect percentage by lines after each phase, using the same measure as the table above, with the new rule as the target metric.

### Rules
- Cite `file:line` for every claim about the code, and name the doc for every decision you quote. Never guess; mark anything unverified.
- **Docs only.** No code or config changes.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/ROADMAP_EFFECT.md`, `docs/audit/effect-everywhere-plan.md`, `docs/audit/effect-atom-react-plan.md`, `docs/LEAD_LOOP.md` (the task-sizing part), then the package sources.

### Allowed files
`docs/audit/effect-100-plan.md`, `work/T-0753-effect-100-plan.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The plan has all five sections, with a checkable definition and `path:line` citations.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did.** Wrote `docs/audit/effect-100-plan.md` (docs only, no code or config changed). It has the five sections asked for (definition, inventory, designs, ordered task list, projection) plus a decisions table, an "unverified" list and two appendices (every failing file with `path:first line`, and an optional Phase 6). Counts come from a throwaway script, run at `19a769a9`, that is not committed; its core is printed in section 1.5 so the map task (T-0752, task R1) can port it.

**Findings.**

- **Definition:** a file is done when it either uses Effect for everything that waits, fails or touches the outside world, or has nothing of that kind. A script can check it: scope filter, an `exempt` class (mock folders, `*.config.ts`, `apps/site`, `// effect-plain: reason` markers, capped at 25), an `effect` class (value import of `effect` or `@effect/*`), a `needs-effect` class (hard signals H1 async, H2 network, H3 timers, H5 storage, H8 node I/O imports, H9 native imports; weak signals W4 try/catch, W6 JSON.parse, W7 env reads) and `plain`. Exact regexes and the known false positives are in section 1.4. 100% = zero `needs-effect` files, zero legacy imports (zod, drizzle, hono, zustand: none today), markers within budget, coverage = Effect lines / (Effect lines + failing lines) = 100.0%. Effect files that still contain a hard signal (130 files, 56,537 lines, "Tier B") are tracked but not part of 100%.
- **Baseline:** 196 of 829 files import Effect (38.3% of non-exempt lines). 271 files (82,143 lines) fail the rule, so coverage by the new rule is 45.4%. Web has 86 failing files, mobile 119, devtools 21, server 37; chat-core, ui-tokens, protocol and agent-drivers have none; xmpp-core has one (`client.ts`, 1,142 lines).
- **Plan:** 118 tasks, 54.5 worker-days, 6 phases; 37 tasks are flagged for Julio. Projected coverage: 46.6% after rule and markers, 47.3% after foundations and xmpp-core, 56.8% after server and tooling, 77.1% after web, 100.0% after mobile.
- **Designs:** xmpp-core (Scope, PubSub and Streams, Deferred plus timeout, tagged errors, Promise facade kept until the last consumer moves), chat-core (stays plain), web and mobile data layers ("lift first, sink later" so no component test changes), the two stores (Scope replaces the `generation` counter), the `useAction` pattern for components, server leftovers and the entry point, runner and devtools.
- **Stale docs found:** `AGENTS.md:41` still says to validate with zod; `docs/LEAD_LOOP.md:14` still says 4 workers while `CLAUDE.md` says 8 (3 mobile).

**Checks.**

- `pnpm exec prettier --write docs/audit/effect-100-plan.md` then `--check`: all matched files use Prettier code style.
- `rg` for legacy imports over `apps`, `packages`, `scripts`: no hits.
- `pnpm gate` from the worktree root, summary lines:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (14.4s)
PASS  lint  (2.1s)
PASS  typecheck  (1.2s)
scope: every changed file is inside the Allowed files
GATE PASS
```

I ran no unit tests (nothing to test in a docs-only change).

**Deviations and open points.**

- Counts differ from the spec table (198 of 848 files, 36%): my scope also drops Cosmos fixtures and test helpers in `src/` (`test-harness.ts`, `test-support.ts`, `fake-*.ts`), and main has moved.
- Line ranges for the xmpp-core and store tasks (X1 to X5, WS1 to WS10, MS1 to MS9) are function starts confirmed with `rg`; the ends must be re-read when each spec is written.
- Not verified because nothing was built: `FetchHttpClient` and `@effect/atom-react` on Hermes, whether `effect/socket` can replace `mux.ts`, and the projection's assumptions (converted file keeps its size; stores end half Effect). They are listed in section 7.
- Nine decisions for Julio are in section 6; D2 (`apps/site`) and D7 (`packages/devtools`) change the size of the plan.

## Review (written by Claude)

**2026-10-09, lead:** approved. Auditor: Sonnet 5.5. The lead read sections 0, 1.1-1.4, 4, 5, 6 and 7.
- **The definition** can be checked by a script: needs-effect means hard or weak signals with no Effect import, and an exempt list plus `effect-plain` markers (at most 25).
- **The plan:** 118 tasks and 54.5 worker-days in 6 phases, cut by folder and function range, with dependencies, tests and Julio flags.
- **Decisions D1-D9** go to Julio.
- **Line ranges are starts only:** every spec re-reads them before launch.
- **Lead follow-ups:** `AGENTS.md:41` (zod) is stale and is the lead's to fix; `docs/LEAD_LOOP.md:14` should say 8 workers.
