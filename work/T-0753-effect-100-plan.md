---
id: T-0753
title: "AUDIT (docs only): the plan to a 100% Effect codebase — define '100%' precisely (which code must use Effect and which may stay plain), inventory every package against it with file:line facts, and write an ordered, small-task plan in docs/audit/effect-100-plan.md"
status: todo
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

## Review (written by Claude)
