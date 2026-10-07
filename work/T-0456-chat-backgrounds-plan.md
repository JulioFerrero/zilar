---
id: T-0456
title: "Audit + plan: custom chat backgrounds (dot colours and images), web first"
status: todo
milestone: M5
branch: task/T-0456-chat-backgrounds-plan
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0456: chat backgrounds plan

## Spec (written by Claude, do not edit)

### Why
Today every chat shows the same dark 22px dot grid. Julio (2026-10-05, again on 2026-10-07) wants custom chat backgrounds like Telegram wallpapers: dots in different colours, or an image. Web comes first and mobile follows.

This task writes the plan only. **Docs only: no code, config, schema or package changes.**

### Verified facts (do not re-derive)
- **Web:**
  - `--chat-background: radial-gradient(#1c1c1c 1px, transparent 1px) 0 0 / 22px 22px var(--panel);` at `apps/web/src/index.css:133`;
  - `.chat-background { background: var(--chat-background); }` at `apps/web/src/index.css:585-586`;
  - it is used three times in `apps/web/src/components/MessageList.tsx` (lines 201, 213 and 226).
- **Mobile:** it draws the same grid as an SVG pattern in `apps/mobile/src/components/chat/chat-background.tsx`, with numbers from `packages/ui-tokens`.
- **Per-chat prefs already exist:** the `chat_prefs` table (`apps/server/src/db/schema.ts:604-621`, keyed by `(userId, chatJid)`, with `mutedUntil`, `archived`, `pinnedAt`), `GET /chat-prefs` and `PUT /chat-prefs/:chatJid` (`apps/server/src/chat-prefs/routes.ts:65` and `:70`), with zod fields at lines 27-29.
- **Uploaded images:**
  - Avatars are served by the server from its own volume (`apps/server/src/avatars/routes.ts`).
  - Stickers come from `STICKER_STORAGE_DIR` (`apps/server/src/stickers/routes.ts`).
  - Chat uploads go through ejabberd and are now member-locked (`docs/audit/upload-auth-plan.md`).

### What to write: `docs/audit/chat-backgrounds-plan.md`
Every claim about today's code carries a `file:line`. Sections:
1. **Today:**
   - how the web and mobile backgrounds are drawn;
   - which tokens they use;
   - how the theme (light or dark) affects them, if at all;
   - where the composer and bubbles sit on top, and what contrast they need.
2. **What to offer:**
   - a small preset list: dot colours on the dark ground, plus a few solid or gradient grounds;
   - a custom image (upload, with crop or fit, plus a dim slider for readability);
   - "default".

   Name 6-10 concrete presets with hex values that keep bubble and text contrast (check against the bubble tokens in `apps/web/src/index.css`).
3. **Scope of a choice:** for one chat, for all chats (a global default), or both, with the chat value winning. Say where each is stored. Options: new nullable columns on `chat_prefs` plus a per-user default row or table, versus a new table. Name the API changes to `/chat-prefs` and give the validation rules.
4. **Images:** where an uploaded background is stored and served (copy the avatar storage and route pattern, or reuse uploads), with size and type limits, resizing, who can read it (only its owner, since it's a personal setting), and deletion when replaced.
5. **Sync:** how web and mobile read the same setting. Name the data each client needs and how it reaches them (the existing `GET /chat-prefs` load, or a new endpoint).
6. **Task split,** web and server first: ordered tasks, each one PR, with files and tests. Mark which tasks are mobile; they wait.
7. **Open questions for Julio,** each with a recommended answer. At least: per-chat or global or both; are image uploads in scope for v1; do the presets follow light and dark mode.

### Read first
`AGENTS.md`, `apps/web/src/index.css` (tokens and `.chat-background`), `apps/web/src/components/MessageList.tsx:195-230`, `apps/mobile/src/components/chat/chat-background.tsx`, `packages/ui-tokens/src`, `apps/server/src/chat-prefs/routes.ts`, `apps/server/src/chat-prefs/service.ts`, `apps/server/src/db/schema.ts:595-625`, `apps/server/src/avatars/routes.ts`, `docs/audit/upload-auth-plan.md` §1d.

### Allowed files
`docs/audit/chat-backgrounds-plan.md`, `work/T-0456-chat-backgrounds-plan.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/chat-backgrounds-plan.md` has the 7 sections, cites `file:line` for every claim about today's code, names concrete presets with hex values, and gives an ordered task split marked web, server or mobile.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
