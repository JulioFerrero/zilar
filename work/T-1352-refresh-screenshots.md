---
id: T-1352
title: "Refresh docs screenshots and the README/USER_GUIDE text to today's app: fix the shot table (scripts/shots.ts) for routes and setups that changed since 09-30, add shots for new screens, regenerate with pnpm screenshots, and correct stale feature text"
status: todo
milestone: M5
branch: task/T-1352-refresh-screenshots
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1352: Refresh screenshots and docs text

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: "do we need to update the readme? the screencaptures?"
- **The screenshots are stale.** All 17 files in `docs/screenshots/` date from 2026-09-30 (last commit `a5e150116`, T-0107). They're used by `README.md:61-64` and 17 times in `docs/USER_GUIDE.md`.
- **What has changed since:** the rail and menu (T-1330); the `/settings` hub (`apps/web/src/routes/SettingsHubPage.tsx`); orb avatars by name (T-1334); edge-to-edge photos (T-1335); contact requests as chat-list rows (T-1336); the photo viewer on a lightbox (T-1343); dialogs and menus on Base UI (T-1350, T-1349); and the 10-10 simplify, which deleted `packages/agent-drivers`, so check whether `/settings/machines` still makes sense.
- **The tooling:** `pnpm screenshots` (`package.json:27`) runs `scripts/screenshots.ts` (199 lines). It starts the web dev server in `?mock=1` and captures the table in `scripts/shots.ts` (133 lines, shots at `:70-113`).

### What to build
1. **Run `pnpm screenshots` once as is** and note which shots fail or show the wrong thing (routes like `/settings/machines`, ids like `c-devteam-bug` and `c-ana`, and setups like `openChatMenu`, `openNewTopic` and `searchTickets`, which may have changed). Fix `scripts/shots.ts` (and the setups in `scripts/screenshots.ts`) so every shot shows its screen as it is today.
   - **Remove** shots of screens that no longer exist, and their references in the docs.
   - **Add** shots for: the chat list with the contact-request rows (desktop and phone); the `/settings` hub; a chat with an edge-to-edge photo bubble, if the mock can show one (mock images are blank by Julio's decision; if so, skip it and say why); and the open message menu (right-click).
2. **Regenerate** all shots with `pnpm screenshots`, and commit the PNGs. Keep the 16 px gutter and viewport sizes as the table has them.
3. **Text:**
   - In `README.md` and `docs/USER_GUIDE.md`, fix every sentence and image reference that no longer matches the app. Verify each claim against the code and cite `file:line` in the Report.
   - **Don't add marketing text**, and don't list UI libraries in the README.
   - The README's status table (`:121` area) may stay as is unless something in it is now wrong.
4. **No tests.** Every source file stays at most 400 lines.

### Read first
`AGENTS.md`, `scripts/screenshots.ts`, `scripts/shots.ts`, `README.md`, `docs/USER_GUIDE.md`, `apps/web/src/routes/AppRoutes.tsx`.

### Allowed files
`scripts/screenshots.ts`, `scripts/shots.ts`, `docs/screenshots/*.png`, `README.md`, `docs/USER_GUIDE.md`, `work/T-1352-refresh-screenshots.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `pnpm screenshots` runs clean.
- Every image the README and USER_GUIDE reference exists and shows today's UI.
- The gate passes.
- **The lead looks at every PNG.**

---

## Report (written by the worker when done)

## Review (written by Claude)
