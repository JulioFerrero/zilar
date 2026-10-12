---
id: T-1289
title: "Mobile batch 2: one copy style for errors (MUX-26); proper empty states (MUX-27); one transient toast instead of stacked banners in the chat (MUX-32); a readable message time (MUX-25); New topic from the '+' menu (MUX-29)"
status: todo
milestone: M5
branch: task/T-1289-mobile-copy-states
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1289: Mobile batch 2

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md`:
- **MUX-26** (P3, `:119`): error copy is mixed ("Couldn't…" vs "Could not…. Try again." vs "Couldn't send. Retry").
- **MUX-27** (P3, `:91`): empty states are a single muted line: chats, messages, topics.
- **MUX-32** (P3, `:61`): errors are `DismissBanner`s stacked between the list and the composer (`apps/mobile/src/components/chat/chat-thread.tsx`), pushing the list up.
- **MUX-25** (P3, `:109`): the message time is 10 px mono in low-contrast greys.
- **MUX-29** (P3, `:79`): the "+" menu (`apps/mobile/src/components/chat/new-chat-button.tsx`) has no New topic; it's only reachable from a group screen.

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **MUX-26:** one style everywhere: "Could not {verb} {thing}. Try again." for failures, with a "Retry" button label where there's an action. List every string you changed in the Report.
2. **MUX-27:** each empty state gets a lucide icon, a short title and one helpful line (with an action where one exists, for example "Start a chat"), using the existing `StateMessage` if it fits (cite it).
3. **MUX-32:** a small toast component (a new `apps/mobile/src/components/ui/toast.tsx`, if none exists) that shows one message at a time for about 3 s over the list. Use it for the chat screen's transient errors in place of the stacked banners. Keep persistent states (offline) as they are.
4. **MUX-25:** message time at 11 px with the existing muted token at higher contrast. Cite the token, no new hex.
5. **MUX-29:** a "New topic" entry in the "+" menu that asks which group (only groups where I can create topics), then opens the existing new-topic flow.
6. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (`:61`, `:79`, `:91`, `:109`, `:119`), and the files above.

### Allowed files
`apps/mobile/src/components/**/*.tsx`, `apps/mobile/src/components/**/*.ts`, `apps/mobile/src/app/**/*.tsx`, `work/T-1289-mobile-copy-states.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator mock:** an empty state looks right; the message time is readable; "+" offers New topic.

---

## Report (written by the worker when done)

## Review (written by Claude)
