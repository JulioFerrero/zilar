---
id: T-0195
title: Audit: what web does for AI tools, routines, activity, @mentions and group dialogs, and what mobile lacks (documentation only)
status: planned
milestone: M5
branch: task/T-0195-mobile-parity-audit
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0195: Audit: web versus mobile for the last parity items (documentation only)

## Spec (written by Claude, do not edit)

### Why
The lead writes the specs for T-0189 (AI tools, routines, activity feed on the AI screen) and T-0190 (@mention picker and dialog gaps). A spec that states something the web app does not do cost two review rounds on T-0184 (an invented History tab). So the facts must come from the code, with file and line. You produce those facts; you change no code.

### What to produce
ONE file: `docs/audit/mobile-parity-gaps.md`, in English, with these sections. Every statement carries a `file:line` reference (web, server or mobile). If something does not exist, write "does not exist" and name the file you searched. Never guess.

1. **AI tools** (web `apps/web/src/lib/tools.ts` and the components that use it, plus `AiPanel`): what a person can do (list, grant, revoke, approve once or always; what the screen shows per tool, the exact visible strings, the server routes with method and path, request and response shapes, rate limits or caps visible in the server code, which errors have fixed sentences). Then: what already exists in mobile (`apps/mobile/src/lib/*-api.ts`, `apps/mobile/src/app/ais/**`, `components/ais/**`, `components/approvals/**`) and what is missing.
2. **Routines** (`apps/web/src/lib/routines.ts` and its components): create, edit, pause, delete, run history. Same detail as above.
3. **Activity feed** (`AiActivity` on web): what rows it shows, how it loads (polling, pagination), the route, the shapes, the strings. Mobile: what exists, what is missing.
4. **@mention picker** (`MentionPicker` and the composer on web): trigger rules (which character, when the picker opens and closes), what it lists (members of this chat only? AIs?), how a mention is inserted and sent (the stanza or payload shape, with the file where it is built), keyboard behaviour. Mobile: composer files, whether any mention support exists, what must change.
5. **Dialogs** (`InviteDialog`, `NewGroupDialog` on web): every field, option and visible string; then compare with the mobile equivalents (search `apps/mobile/src/components/chat/new-chat-button.tsx` and the group screens) and list each difference.
6. **Pitfalls for mobile workers**: anything in these areas that is easy to get wrong (a route that needs an owner role, a field the server rejects, a rate limit, a response that can be relative URLs).

At the end, add a section "Suggested task split" listing for each of T-0189 and T-0190 a proposed split into tasks of at most one day, with the Allowed files for each, as plain suggestions for the lead.

### Read first
`AGENTS.md`, `docs/ROADMAP_MOBILE_PARITY.md`, `docs/FEATURES.md`, `docs/MOBILE_UX.md` if it exists.

### Allowed files
`docs/audit/mobile-parity-gaps.md` (create the folder), `work/T-0195-mobile-parity-audit.md`. No code file may change.

### Checks
```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm gate
```
`pnpm format:check` formats Markdown too: run `pnpm exec prettier --write docs/audit/mobile-parity-gaps.md` before it.

### Acceptance
- All six sections exist and every claim has a `file:line` that exists (open the file and check the line before you cite it; the lead spot-checks ten of them).
- No claim about behaviour you did not read in code. "Does not exist" is a valid answer.
- `pnpm gate` ends with GATE PASS.

### Out of scope
Any code change, any test, any spec for the tasks themselves (the lead writes those).

---

## Report (written by the worker when done)

## Review (written by Claude)
