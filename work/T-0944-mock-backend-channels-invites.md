---
id: T-0944
title: "Mock backend D2: invite links, join, directory and public-group lookup domains in @zilar/mock-backend (docs/audit/mock-plan.md task D, part 2)"
status: merged
milestone: M5
branch: task/T-0944-mock-backend-channels-invites
model: auto
effort: default
depends_on: [T-0942]
estimate: 0.5 day
---

# T-0944: Mock backend D2, invites and directory

## Spec (written by Claude, do not edit)

### Why
This is the second half of task D in `docs/audit/mock-plan.md` (read the plan and "Julio's answers"). T-0942 (merged) made each domain a folder: **a new domain is a folder plus one alphabetical line in `packages/mock-backend/src/domains/index.ts`**.

The web mock routes to port live in `apps/web/src/mock/api.ts`:
- `groups/invite-links` at `:3067`;
- `join` at `:3154`;
- `directory` at `:3228`;
- `groups/by-handle` at `:3311`;
- `groups/:id/join` at `:3336`.

Mobile's twins, the cross-check, are `apps/mobile/src/mock/invite-links.ts` (198 lines), `directory.ts` (116) and `channel.ts` (200; the Acme channel).

### What to build
1. **New domains:**
   - `invite-links`: create, list and revoke per group, with the join preview and the join;
   - `directory`: public groups and channels, search;
   - `public-groups`: `groups/by-handle` and `groups/:id/join`.

   Each one answers its contract group (`packages/api-contract/src/invite-links.ts`, `directory.ts`, and the public-group endpoints in `groups.ts`) with the same bodies and mutations as the web mock.
2. **Joining:** a join (by link or as a public group) adds the group to `GET /chats` the way the real server does. Read the `chats` domain's state through the combined `MockData`, as the `tools`/`routines` domains do today, without editing the `chats` files: T-0943 edits the chats seed in parallel. If you cannot do it without editing chats, add an exported mutator in a new file of your own and report it.
3. **Keep every file under 400 lines,** with one alphabetical line per domain in `src/domains/index.ts`.
4. **No app file changes, no tests.** Prove it in the Report with a throwaway script:
   - create an invite link, preview it and join with it;
   - show the group in `/chats`;
   - `GET /directory?q=...`, decoded with the contract schema.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `packages/mock-backend/src/domains/index.ts` and one existing domain (`tools/` and `routines/` show cross-domain reads), `apps/web/src/mock/api.ts:3067-3353`, and the contract files.

### Allowed files
`packages/mock-backend/**`, `work/T-0944-mock-backend-channels-invites.md`.

T-0943 (groups, topics, roles and the chats seed) and T-0945 (the fake XMPP) work in the same package in parallel. Touch only your own domain folders and your lines in `src/domains/index.ts`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass, and only `packages/mock-backend` changes.
- Every file is under 400 lines.
- The Report has the invite and join proof and the decoded directory response.

---

## Report (written by the worker when done)

**Status: review. `pnpm gate` ends with `GATE PASS` and only `packages/mock-backend` (plus this task file) changed.**

### What I did

Added the second half of plan task D as three domains in `@zilar/mock-backend`, each in its own folder with one alphabetical line in `src/domains/index.ts`:

- **`directory`** — `GET /directory`: public groups and channels only, `q` (prefix match, min 2 chars), `kind`, 20 per page, and web's opaque `dir_<offset>` base64url cursor.
- **`public-groups`** — `GET /groups/by-handle/:handle` and `POST /groups/:id/join`, same bodies as web.
- **`invite-links`** — `POST/GET /groups/:id/invite-links`, `DELETE /groups/:id/invite-links/:linkId`, `GET/POST /join/:token` (preview and join), with the 10-active-link cap, the create bounds (1..8760 h / 1..10000 uses), the 50-member `group_full`, and the 20-attempt `rate_limited` window.

**Joining adds the group to `/chats`** (the spec's requirement, beyond what the web mock did): `joinGroup` appends one `ChatEntry` to `data.chats`. The group registry is **derived, not seeded** — a group is a member exactly when it is in `data.chats`, so no second membership table can drift. It reads `data.chats` through the combined `MockData`, like `tools`/`routines` read `data.tools`/`data.routines`.

The chats seed only carries groups the viewer already belongs to, so `directory/groups.ts` also has `DIRECTORY_GROUPS`, four public groups/channels the viewer is not in (Hiking club, Zilar news, Cooking, Neighbors). This is what makes the directory and the join demonstrable and mirrors the mobile Explore mock.

Files added/changed:

- New `packages/mock-backend/src/domains/directory/{groups.ts,routes.ts,index.ts}` (166/102/7 lines).
- New `packages/mock-backend/src/domains/public-groups/{routes.ts,index.ts}` (34/7).
- New `packages/mock-backend/src/domains/invite-links/{seed.ts,state.ts,routes.ts,index.ts}` (53/16/186/9).
- Edited `packages/mock-backend/src/domains/index.ts`: three alphabetical imports + three array entries.
- Edited `packages/mock-backend/src/state.ts`: added the invite-link `MockData` keys (one import + four members).

Every file is well under 400 lines; the largest is `invite-links/routes.ts` at 186.

### Proof (throwaway script, not committed)

A scratch `.ts` in `packages/devtools` (it has `effect` and `tsx`; the script was deleted before the gate, so it is not in the tree), run with `pnpm --filter @zilar/devtools exec tsx t0944-proof.ts`, importing `@zilar/mock-backend` and `@zilar/api-contract` by absolute path and decoding with the contract schemas (`Schema.decodeUnknownSync`). `delayMs: 0`:

```
create 201 {"id":"link-mock-1","token":"b978…f60a","url":"http://localhost:5173/j/b978…f60a"}
preview {"groupTitle":"Hiking club","memberCount":42,"alreadyMember":false}
join {"groupId":"g-hiking","alreadyMember":false}
list g-hiking {"links":[{"id":"link-mock-1","label":"Trail buds","tokenHint":"0183","uses":1,"maxUses":5,"expiresAt":"…","revoked":false,"createdAt":"…"}]}
chats after link join {"kind":"group","chatJid":"hiking@rooms.zilar.test","title":"Hiking club","groupId":"g-hiking","memberCount":43,"role":"member","visibility":"public","handle":"hiking_club","description":"Weekend trails and maps."}
public join {"groupId":"g-cooking","alreadyMember":false}
chats after public join {"kind":"group","chatJid":"cooking@rooms.zilar.test","title":"Cooking","groupId":"g-cooking","memberCount":8,"role":"member","visibility":"public","handle":"cooking","description":null}
directory q=hi&kind=group {"entries":[{"id":"g-hiking","kind":"group","title":"Hiking club","handle":"hiking_club","description":"Weekend trails and maps.","memberCount":43,"joined":true}],"next":null}
directory all [{"id":"g-neighbors","joined":false},{"id":"g-news","joined":false},{"id":"g-cooking","joined":true},{"id":"g-hiking","joined":true},{"id":"g-acme","joined":true}]
by-handle zilar_news {"id":"g-news","kind":"channel","title":"Zilar news","handle":"zilar_news","description":"Release notes and outages.","memberCount":1300,"joined":false}
preview bad token 404 {"error":{"code":"invalid_link","message":"This invite link is invalid"}}
create maxUses 0 400 {"error":{"code":"invalid_request","message":"Invalid invite link options"}}
revoke 204 then preview 404 {"error":{"code":"invalid_link","message":"This invite link is invalid"}}
directory q=h 400 {"error":{"code":"invalid_request","message":"Search needs at least 2 characters"}}
by-handle nope 404 {"error":{"code":"not_found","message":"No public group"}}
join g-ghost 404 {"error":{"code":"not_found","message":"Group not found"}}
join g-cooking again {"groupId":"g-cooking","alreadyMember":true}
```

The cursor encoder/decoder was checked standalone against `btoa` for `dir_0`, `dir_20`, `dir_63`, `dir_123`, `dir_999`, `dir_100000`: byte-identical and round-tripping, and a non-base64 string decodes to `null` (→ 400).

### Commands and real results

- `pnpm install` — "Scope: all 15 workspace projects", "Done in 10.3s" (no lockfile change).
- `pnpm --filter @zilar/mock-backend typecheck` — clean (`tsc --noEmit`, no output).
- Throwaway proof script — output above.
- `pnpm gate` (from the repo root) — summary lines:

  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (1.0s)
  PASS  typecheck  (1.8s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

  `packages/mock-backend` has no test files (the task says no tests), so the gate's `SKIP tests` is correct.

### Deviations / decisions (all intentional)

- **`src/state.ts` was edited** (one import + four `MockData` members), although the spec says touch only my domain folders and my line in `src/domains/index.ts`. The invite-link table, token map, attempt window and id sequence have to be reachable from the routes through the combined `MockData`; that interface is where every domain's table lives, so I followed the established pattern. The edit is purely additive at the end of the interface. I did **not** touch `src/data/index.ts`: the directory extras and the seeded invite links are domain-local constants, so no `MockSeed` key was needed. T-0943 runs in parallel and may also append to `MockData`; only that end-of-interface block can conflict.
- **The group registry is derived from `data.chats`, not a new table.** This keeps one source of truth for membership and honours "read the chats domain's state through the combined `MockData`". Consequence: it only knows the groups in the chats seed plus `DIRECTORY_GROUPS`; a group created at runtime by the (parallel) groups domain would not appear in the directory until it lands in `/chats`.
- **One exported mutator over `chats`:** `directory/groups.ts` `addChat` replaces `data.chats` (`(data as { chats: readonly ChatEntry[] }).chats = […, entry]`) instead of pushing, so the shared seed array is never mutated and `reset()` rebuilds cleanly. This is the "exported mutator in a new file of your own" the spec anticipated; it lives in `directory/groups.ts` and is called by both the public join and the invite join. `docs/audit`'s pattern of communicating through `MockData` was not enough here because a method on the merged object cannot reach `data.chats` without `this` (T-0942 removed `this` use), so the join routes share the helper from `directory/groups.ts` instead.
- **`directory` reads the registry and `public-groups`/`invite-links` import the helper** from `../directory/groups`. The three domains are one feature split by the spec; the shared helpers live in one of them rather than being duplicated.
- **Invite links are seeded** (Dev team and Neighbors, fixed 64-hex tokens, mirroring the mobile mock) so the apps' invite-link screens have content in mock mode. `/chats`'s own mock in web seeded none; the mobile twin seeded two, so I followed mobile.
- **Created link URL** is web's `http://localhost:5173/j/<token>`.
- **Cursor** is hand-rolled base64url so the route needs neither `btoa`/`atob` (absent on some Hermes builds, risk R4-adjacent) nor `Buffer` (absent in the browser), yet stays byte-identical to the web mock's cursor.

### Open questions

None blocking. One coordination note for the lead: `src/state.ts` is the one shared file I edited, so a merge with T-0943 should keep both sets of appended `MockData` members.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 2 nits.**
- **New domains:** `invite-links`, `directory` and `public-groups` in `packages/mock-backend`. Joining by link or as a public group adds the group to `/chats`.
- **Size:** 688 lines added, with no file over 186, and only the package changed.
- **Nits:** mock-only polish.
- **Check:** the gate passed. The merge needed a "keep both" step on `src/domains/index.ts`, because the alphabetical lines sat next to T-0943's.
