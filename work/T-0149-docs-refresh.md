---
id: T-0149
title: Docs refresh: user guide and feature list for everything merged this week
status: todo
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

## Review (written by Claude)
