---
id: T-1300
title: "Web: the Notifications page lists muted chats with Unmute (WUX-39); the emoji tab gets a search box and categories (WUX-26); small copy nits (WUX-43)"
status: todo
milestone: M5
branch: task/T-1300-web-notify-emoji
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1300: Muted chats list, emoji search, copy nits (web)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md`:
- **WUX-39** (P3, `:139`): there's no per-chat mute list on the Notifications page. Mute lives only in the row menus (`apps/web/src/components/ChatActionsMenu.tsx`), so there's no way to see what's muted.
- **WUX-26** (P3, `:79`): the emoji tab is a fixed list of common emoji (`apps/web/src/components/sticker/emoji.ts`), with no search or categories.
- **WUX-43** (P3, `:149`):
  - the "Mute…" label flips to "Mute" by state (`ChatActionsMenu.tsx`);
  - the "CHANNEL"/"PUBLIC" tags use the same all-caps mono style as the role chips, which mean something else.

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **WUX-39:** a "Muted chats" section on the Notifications settings page (find the route) listing muted chats, each with its mute end ("until 18:00", "always"), plus an Unmute button using the existing unmute action (cite it). If none are muted, say "No muted chats."
2. **WUX-26:**
   - a search box over the emoji tab that filters by name. If `emoji.ts` has no names, add a compact name per emoji in that file, keeping it at most 400 lines (generated data is exempt: say so if you go over);
   - group the emoji into a few categories (smileys, people, nature, food, activities, objects, symbols) with tabs or headers.
   - No new dependency.
3. **WUX-43:**
   - the mute menu label reads "Mute…" when unmuted and "Unmute" when muted;
   - the channel and public tags become sentence-case muted text ("Channel", "Public"), distinct from the role chips.
4. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (`:79`, `:139`, `:149`), `apps/web/src/components/ChatActionsMenu.tsx`, `apps/web/src/components/sticker/emoji.ts` and the Notifications settings page (find it).

### Allowed files
`apps/web/src/components/**/*.tsx`, `apps/web/src/components/sticker/*.ts`, `apps/web/src/routes/**/*.tsx`, `work/T-1300-web-notify-emoji.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:**
  - mute a chat, and it shows on the Notifications page with Unmute;
  - typing "heart" in the emoji tab finds ❤️.

---

## Report (written by the worker when done)

## Review (written by Claude)
