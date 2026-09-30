---
id: T-0107
title: Tools and routines UI (web)
status: planned
milestone: M4
branch: task/T-0107-tools-routines-ui
model: meta/muse-spark-1.3-contributor
depends_on: [T-0105, T-0104, T-0132]
estimate: 3 days
---

# T-0107: Tools and routines UI (web)

## Spec (written by Claude, do not edit)

### Why
AIs can now build tools and routines, but a human cannot see or control them except through chat. The server already has read routes, run, revert, delete, pause, resume (see below). People must be able to look at the code and its history, run a tool, and pause or delete a routine, and see which hosts a tool may contact (T-0132). Web first; mobile later. Read `AGENTS.md` (test policy, security checklist) first.

### API that exists (do not change the server)
- Tools: `GET /api/ais/:id/tools`, `/api/groups/:id/tools`, `/api/topics/:id/tools`, `GET /api/tools/:id` (with source), `/api/tools/:id/versions`, `/api/tools/:id/versions/:n`, `/api/tools/:id/runs`, `POST /api/tools/:id/revert`, `POST /api/tools/:id/run`, `DELETE /api/tools/:id` (see `apps/server/src/tools/routes.ts`; read the exact shapes and permissions there).
- Routines: `GET /api/ais/:id/routines`, `/api/groups/:id/routines`, `POST /api/routines/:id/pause`, `/resume`, `DELETE /api/routines/:id` (`apps/server/src/routines/routes.ts`).
- T-0132 adds the tool's approved hosts and `tool.approve_hosts`/`tool.revoke_hosts` as AI actions; if T-0132 also exposes the approved hosts in `GET /api/tools/:id`, show them; otherwise show only the declared hosts and say so in the Report.

### What to build
1. A **Tools** section reachable from a topic (and a group's General), from the topic panel and the AI settings panel: list of tools with name, description, current version, hosts (declared, and approved when the API gives it), last run status and time. Empty state explains what tools are in one sentence.
2. **Tool detail** (a side panel or page, match the existing panels): source code in a read-only monospace block (no syntax highlighter dependency; plain text with line numbers), version history with each version's message, author and hosts, "Revert to this version" (creates a new version, needs the confirm step), a **Run now** button with an optional JSON input field (validated, max 4 KB) that shows the result and errors, recent runs list (status, duration, trigger; never show output of other users' chats: the API decides), **Delete tool** with confirm.
3. **Routines** list per AI and per group: title, schedule in plain words (there is a `describeSchedule` helper on the server; reproduce the wording in a small tested web helper), next run, last status, paused reason (user, failures, hosts_changed) with an explanation line, **Pause/Resume** and **Delete** (confirm). A routine paused for `hosts_changed` or failures says what to do next (ask the AI to re-approve).
4. Everything renders as text: tool source, names, descriptions, outputs and error strings are shown as plain text (never HTML, no markdown with links from tool output). Long output is truncated with a "Show all" toggle.
5. Permissions follow the server: the UI hides an action the API would refuse (member vs admin/owner, AI owner) and still handles a 403/404 from the server gracefully (inline message, no crash).
6. Mock mode: extend the web mock so tools and routines exist (one AI, two tools with two versions each, one routine active and one paused) and every action works in memory, so the screens can be developed and screenshotted without a server.
7. Add the two screens to `scripts/screenshots.ts` and `docs/USER_GUIDE.md` (a short "Tools and routines" section, marked as off by default and needing `TOOLS_ENABLED`).

### Read first
`AGENTS.md`, `work/T-0103-*.md` and `work/T-0104-routines-scheduler.md`, `work/T-0105-tool-adapters.md` (Reviews), `apps/server/src/{tools,routines}/routes.ts`, `apps/web/src/components/{TopicPanel,GroupPanel}.tsx`, `apps/web/src/lib/api.ts`, `apps/web/src/mock/`.

### Allowed files
`apps/web/**`, `scripts/screenshots.ts`, `docs/USER_GUIDE.md`, `docs/screenshots/**` (regenerate only the new shots and the ones that changed), `work/T-0107-tools-routines-ui.md`. Not allowed: server, mobile, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/web test --maxWorkers=2
pnpm build
```
(Affected tests while working; the full web suite once at the end.)

### Acceptance criteria
- [ ] List, detail, history, revert, run, delete for tools; list, pause, resume, delete for routines; each with render tests and error-state tests (403, 404, network).
- [ ] Tool source and outputs are rendered as text; a test with `<img onerror>` and `javascript:` strings proves nothing executes.
- [ ] Mock mode covers all of it; screenshots added; guide section added.
- [ ] No new dependency; no lint or ts disable comments; web suite exits 0 with no unhandled errors.

### Out of scope
Editing tool source in the UI (AIs write tools; humans read, run, revert, delete), creating routines by hand, mobile, server changes.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
