---
id: T-0149
title: Docs refresh: user guide and feature list for everything merged this week
status: review
milestone: M5
branch: task/T-0149-docs-refresh
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0131]
estimate: 1 day
---

# T-0149: Docs refresh

## Spec (written by Claude, do not edit)

### Why
`docs/USER_GUIDE.md` still lists stickers, GIFs, channels, push, roles and the install wizard under "Coming next", and `docs/FEATURES.md` does not know the newest work. Several things merged since: invite links, group roles with private-topic access and approvers, search (including prefix and typo tolerance), channels, stickers (packs, creator, favorites), GIFs (off until a provider key is set), web push and the installable app, tool host approval, the model side of AI tools, and the mobile versions of most of these. Read `AGENTS.md` first. This is a documentation task: be exact, never describe a feature that is not merged, and mark what still needs a human to enable or try.

### What to build
1. `docs/USER_GUIDE.md`: new sections written for a non-technical user, in the existing style: Invite links, Roles and private topics, Channels, Stickers (use, create, favorites), GIFs (and how the owner turns them on), Notifications and installing the app, Search tips (prefix and typo tolerance). Update Pins/Mute/Search where behaviour changed. Replace the "Coming next" list with what is really still planned (check `work/BOARD.md` and `docs/ROADMAP_M5.md`). Each new section gets a screenshot reference; add the shots to `scripts/screenshots.ts` (mock mode, desktop and phone) and regenerate them with `pnpm screenshots` ONLY if the script runs in your environment without starting anything outside the repo; otherwise say in the Report which screenshots are missing and leave the image links out.
2. `docs/FEATURES.md`: add every merged feature with its task ids and the honest status mark (✅ Live only where the Report or Review says it was used on the real stack; 🟡 Merged otherwise).
3. `README.md`: the "See it" feature list matches.
4. Check every claim against `work/T-*.md` Reports and Reviews; list in your Report anything you could not verify.
5. Do not change code, specs, the board, or other tasks' files.

### Read first
`AGENTS.md`, `docs/USER_GUIDE.md`, `docs/FEATURES.md`, `docs/ROADMAP_M5.md`, `work/BOARD.md`, the Review sections of T-0115, T-0116, T-0117, T-0119, T-0120, T-0121, T-0122, T-0124, T-0132, T-0142, T-0143, T-0144.

### Allowed files
`docs/USER_GUIDE.md`, `docs/FEATURES.md`, `README.md`, `docs/screenshots/**`, `scripts/screenshots.ts`, `work/T-0149-docs-refresh.md`. Not allowed: code, other docs, specs, the board.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
```

## Report (written by the worker)

### What I did
- `docs/USER_GUIDE.md`: added seven non-technical sections (Invite links, Roles and private topics, Channels, Stickers, GIFs + owner enable step, Notifications and installing the app, Search tips) in the existing style; extended Pins with channels/mobile; replaced the stale "Coming next" list (stickers/GIFs/channels/push/roles/install wizard are merged) with what BOARD + ROADMAP_M5 still show as planned (voice, Telegram import T-0123, mobile GIFs T-0148, deploy push T-0145, native iOS push T-0005). No screenshot references added (see below).
- `docs/FEATURES.md`: new rows for invites (T-0115), roles (T-0116), smarter search (T-0142), push+PWA (T-0118/T-0119), stickers (T-0120), creator/favorites (T-0121), GIFs (T-0122), channels (T-0124), host approval (T-0132), model side (T-0106), tools UI (T-0107), mobile parity bundle (T-0135–T-0140, T-0143, T-0144, T-0147), deploy rows (T-0126–T-0129), install wizard (T-0127); fixed the stale rows (pins was "In review" → Merged; sandbox/store/routines/actions were "not wired yet"/"Planned" → Merged); extended the timeline to 2026-09-30/10-01.
- `README.md`: three new "What it does" rows (invites/roles/channels, stickers/GIFs, notifications) and an updated M5 status line.
- Status marks: everything new is 🟡 Merged — no "✅ Live" anywhere new. No task I read claims a real-stack/device/browser live check for this week's features: invite/roles/search/push/stickers/GIFs/channels/tools-UI reviews all say "not live-checked / mock + tests only" (push stage A live against local ejabberd only, push Helium check open, GIFs need Julio's key, T-0127 wizard proven live on scratch containers but marked 🟡 since it is deploy tooling). Claim checks: private topics invisible to non-member admins (T-0116 decision 1 + review), 20-pin cap (T-0114), GIF off until key set (T-0122), HTTPS needed for push (ROADMAP_M5 "things only Julio can provide"), channels read-only via server moderation (ROADMAP_M5 decision 8), sticker limits PNG/WebP 512 KiB (ROADMAP_M5 decision 6), roles = two powers only (decision 10), search never leaks private topics (T-0117 authz design).
- Screenshots: NOT regenerated and no new image links added. `pnpm exec playwright --version` works (1.63.0) but no Chromium binary is installed in this environment (`~/.cache/ms-playwright` absent; no headless_shell found), and downloading one needs `npx playwright install` approval I don't have. So the seven new guide sections ship without screenshot references, per the spec's fallback. Missing shots for a later run: invite-links, roles, channels, stickers, GIFs, notifications, search-tips (desktop + phone).
- No code, specs, board, or other files touched. No `scripts/screenshots.ts` change needed (shot table untouched).

### Files changed
- `docs/USER_GUIDE.md`, `docs/FEATURES.md`, `README.md`, `work/T-0149-docs-refresh.md` (this Report + status).

### Lead review fixes (round 2)
- FEATURES.md: deleted the 4 stale T-0104–T-0107 rows (the "(merged)"/"(wired)" dups and the contradicting Planned rows) — each task id now appears once per feature; fixed the stale "Coolify without bind mounts in review" copy and folded the second "Self-hosted install" row into the first (now cites T-0126/28/29/27 with the real `./deploy/galena` command names); push row cites T-0119 only (T-0118 was a spike, never merged); host-approval row now `server, web` (T-0132 + T-0107).
- USER_GUIDE Coming next: install wizard/backups/bare-metal now marked merged with the real helper path and commands; phone GIF line now says stickers merged, GIF tab planned (T-0148); push line names T-0119/T-0145 explicitly.
- Re-verified claims: (a) wizard path/commands against `deploy/galena` usage header + `docs/INSTALL_DOCKER.md:21-23,160` — `./deploy/galena init|up|doctor|backup|restore|create-admin`, run from repo root against `deploy/`; (b) phone invite links against T-0136 Report+Review — create/list/revoke/join-by-link merged, same limits as web (label ≤60, expiry 1–8760h, max uses 1–10000), gates/neutral-message behavior kept generic, plus the Review's honest mock limit (demo preview hardcodes `alreadyMember`); (c) shared packs against code — visibility is `private`|`server` (`stickers/service.ts:21`, discover filters `visibility='server'`, web Settings→Stickers shows Shared/Private + Share/Make-private toggle).
- Deleted the lead's `PREREVIEW.md` from my worktree (untracked review artifact, not mine to keep).
- Final pass: every new claim traces to a merged task Review; unverified items unchanged from round 1 (UI labels/paths, push surface, mobile flows — Reports/Reviews only, no browser/device here).

### Checks (real results, round 2)
- `pnpm install`: pass (Done in 7.9s).
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint`: pass (oxlint, no output = clean).
- `pnpm typecheck`: pass (10/10 tasks successful, 9.4s).
- Tests: none added (docs-only task; per AGENTS.md I ran format/lint/typecheck, not package suites).

### Could not verify
- Exact web UI labels/paths (e.g. where "Create pack" or "Install app" buttons live) — verified only against task Reports/Reviews, not a running browser.
- Push details (VAPID setup surface, test button, iOS A2HS hint) — from the T-0119 Report only; stage B live gate still the lead's check.
- Mobile invite/roles/search/channels/sticker flows — mobile tasks say "to be run on the emulator after the batch merge"; guide claims kept generic.

### Blocked / needs a decision
- None. Screenshots need Chromium + a lead-approved install; listed above as missing, not blocking.

## Review (written by Claude)
