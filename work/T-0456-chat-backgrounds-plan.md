---
id: T-0456
title: "Audit + plan: custom chat backgrounds (dot colours and images), web first"
status: merged
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

Wrote `docs/audit/chat-backgrounds-plan.md` (docs only, no code/config/schema/package
change), following the 7 required sections.

**What the plan says**

- **Today:** web draws the grid from `--chat-background`
  (`apps/web/src/index.css:133`, `--panel` `#0a0a0a` at `:71`), consumed only by
  `.chat-background` (`:585-587`) and used three times in `MessageList.tsx`
  (`:201`, `:213`, `:226`); mobile draws the same grid as an SVG pattern from
  `chatGrid` (`apps/mobile/src/components/chat/chat-background.tsx:6-29`,
  `packages/ui-tokens/src/index.ts:54-59`). No light mode exists, so the theme does
  not change the background (`index.css:4-10`, `:66-68`). Contrast constraint: the
  incoming bubble fill (`#161616`) is only ~1.07:1 against the `#0a0a0a` ground, so
  separation comes from the `#050505` border and shadow — presets must keep the
  ground in a narrow band (lighter than `#050505`, darker than `#161616`).
- **Presets:** 6 dot presets (`slate` default `#1c1c1c`, `graphite #2e2e2e`,
  `ocean #1e4d6b`, `teal #155e52`, `plum #4a2560`, `ember #5c3317`) on the
  `#0a0a0a` ground, 3 grounds (`charcoal #0d0d0d`, `midnight #0b1424→#05070d`,
  `espresso #140e09→#0a0705`), plus `default` and a custom image with fit + dim.
- **Scope:** recommend both — nullable background columns on `chat_prefs` plus a
  new `chat_background_defaults` table; API changes to `GET/PUT /chat-prefs` and a
  separate `GET/PUT /chat-background`; validation rules named.
- **Images:** copy the avatar storage/route pattern into `chat_backgrounds` +
  `BACKGROUND_STORAGE_DIR`, owner-only reads (unlike avatars), 512 KiB / WebP-PNG
  / 2048 px limits, a new probe because the shared sticker probe caps at 512 px.
- **Sync:** reuse the existing `GET /chat-prefs` load on both clients.
- **Task split:** 7 ordered PRs, tasks 1–2 server, 3 shared, 4–5 web, 6–7 mobile
  (marked as waiting).
- **Open questions:** 6, each with a recommended answer.

**Files changed**

- `docs/audit/chat-backgrounds-plan.md` (new)
- `work/T-0456-chat-backgrounds-plan.md` (Report + status only; Spec untouched)

**Commands run**

- `pnpm install` — exited 0 (1170 packages).
- `pnpm gate` — exited 0. Summary lines:

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (12.7s)
  PASS  lint  (0.8s)
  PASS  typecheck  (1.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

  No package tests ran because no `apps/` or `packages/` file changed (only docs),
  which is expected for a docs-only task. Per AGENTS.md I ran no other single test
  files.

**Problems / deviations**

- None. Docs-only, so the gate's package-test step is empty by design.

**Open questions for Julio** — see section 7 of the plan (per-chat vs global vs
both; image uploads in v1; light/dark presets; whether others see your wallpaper;
dim range/default; animated images). Each has a recommended answer; no answer is
blocking the doc, so this task is not blocked.

**Security checklist**

No routes, deletes or writes are added by this task (docs only). The plan itself
requires: owner-only reads for background images (section 4), idempotent
replace/delete copied from avatars, the same 404 for unknown/foreign image reads,
the same 400 for unknown/unowned image ids on write (no probing), and the existing
rate limiter reused for the new writes.

**Round (fixes after prereview)**

- Findings fixed: 1 (should-fix). Section 5's effective-look expression
  (`docs/audit/chat-backgrounds-plan.md:273`) parsed as
  `(preset ?? imageId) ? image : (globalDefault ?? slate)`, so any truthy preset
  id sent the resolver down the image branch. Rewrote it as an explicit resolve
  order: the preset wins, else the image, else `globalDefault`, else `slate`.
- Tests added: none. This round changes a plan doc only (no code), and the
  finding named no test.
- Nit 2 (worktree path at `:6-8`) left untouched: it is not in a line this round
  changed, per the fix-round instructions.
- Gate: `pnpm gate` exited 0.
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (11.9s)
  PASS  lint  (0.5s)
  PASS  typecheck  (0.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  No package tests ran: no `apps/` or `packages/` file changed (docs only).

## Review (written by Claude)

Approved (lead, 2026-10-07). docs/audit/chat-backgrounds-plan.md: 6 dot presets and 3 grounds with hex values; a custom image with fit and a 0-80% dim; per-chat values over a global default; owner-only image storage like avatars; a 7-task split (server 1-2, shared 3, web 4-5, mobile 6-7 waits). The pre-review spot-checked the file:line claims. Nits (worktree path; the FK belongs in §3; the PUT /chat-background cross-field rules) carry into the task-1 spec.
