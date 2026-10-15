---
id: T-1615
title: "AI computer /workspace is read-only and empty: the agent's loop mount never reaches the host (desks bind is rprivate) and mkfs makes the disk root-owned; mount the desks root rshared in every compose file and give the disk's root to the jail user (10001)"
status: merged
milestone: M5
branch: task/T-1615-workspace-reaches-jail
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1615: The AI's disk reaches its computer, writable

## Spec (written by Claude, do not edit)

### Why
On live (2026-10-16) Julio's AI answered: "/workspace is read-only (user desk, owned by root). Wrote hello.txt in /tmp instead."

What the lead verified on the VPS:
- **Inside the `desk-agent` container,** `/var/lib/zilar/desks/<aiId>/default.img` (5 GiB) is loop-mounted on `/var/lib/zilar/desks/<aiId>/default`: `mount | grep -c /var/lib/zilar/desks` gives 2.
- **On the host,** the same folder is **not** mounted (`mount | grep -c zilar/desks` gives 0). It is an empty `drwxr-xr-x root root` folder.
- **The cause:** the agent's bind of `/var/lib/zilar/desks` has `propagation=rprivate` (`docker inspect`), so its mount never reaches the host. Docker then bind-mounts the host's empty, root-owned folder into the jail as `/workspace`.
- **The host can take the fix:** `findmnt` gives `/ shared` for both `/` and `/var/lib/zilar/desks`.
- **The second bug:** even once mounted, the disk's root folder is owned by root. `mkfs.ext4` makes it so (`packages/desk/src/agent/workspace.ts:88`), and the jail runs as `desk`, uid 10001 (`packages/desk/Dockerfile:27,33`). The agent's `mke2fs` is 1.47.3.

### Facts (the lead read them on 2026-10-16, main after T-1613)
- **The desks bind mount in each compose file:**
  - `deploy/docker-compose.yml:330`, `deploy/coolify/docker-compose.yml:301`, `deploy/coolify/docker-compose.app.yml:312` and `deploy/coolify/zilar-core.yml:146` each have `- /var/lib/zilar/desks:/var/lib/zilar/desks` for `desk-agent`;
  - all four set `DESK_WORKSPACE_MODE: image`.
- **`packages/desk/src/agent/workspace.ts`** (173 lines):
  - `ensureImage(image, mountDir, diskBytes)` (`:83-94`) runs `truncate -s`, then `mkfs.ext4 -q -F` when the image is new, then `mount -o loop,rw` unless `mountpoint -q` says it's already mounted;
  - `imageWorkspaces(config).ensure` calls it (`:113-118`);
  - `directoryWorkspaces` (`:145-165`, the macOS dev mode) is a plain folder.

### Steps
1. **In all four compose files,** change the `desk-agent` desks mount to propagate: `- /var/lib/zilar/desks:/var/lib/zilar/desks:rshared`.
   - Keep the short syntax, so the host path is still created when it is missing.
   - Add a one-line comment: the agent loop-mounts each AI's disk here, and `rshared` lets the host (and so the jail's bind mount) see it.
2. **In `workspace.ts`,** add `export const JAIL_UID = 10001;` with a comment that it must match `useradd -u 10001` in `packages/desk/Dockerfile`.
   - **New images:** `mkfs.ext4 -q -F -E root_owner=10001:10001 <image>`.
   - **Existing images** (live already has one): after the mount check in `ensureImage`, always run `chown 10001:10001 <mountDir>`. This changes only the disk's root folder, not recursively, so it fixes images made before this change.
   - Leave `directoryWorkspaces` unchanged.
3. **Test** in `deploy/tests/host-setup.test.sh`: each of the four compose files mounts `/var/lib/zilar/desks` with `rshared`.

### Tests
The compose assertion above. The lead checks the rest on live.

### Allowed files
- `deploy/docker-compose.yml`
- `deploy/coolify/docker-compose.yml`
- `deploy/coolify/docker-compose.app.yml`
- `deploy/coolify/zilar-core.yml`
- `packages/desk/src/agent/workspace.ts`
- `deploy/tests/host-setup.test.sh`
- `work/T-1615-workspace-reaches-jail.md`

### Checks
```bash
sh deploy/tests/host-setup.test.sh
sh deploy/tests/install.test.sh
pnpm gate
```

### Acceptance
- **On live after the deploy:**
  - `docker inspect` shows `propagation=rshared` on the agent's desks mount;
  - a new jail's `/workspace` is the mounted disk, owned by 10001 and writable.
- **Nothing else changes.**

---

## Report (written by the worker when done)

### What I did

- Changed the `desk-agent` desks bind to propagate in all four compose files:
  `- /var/lib/zilar/desks:/var/lib/zilar/desks:rshared` (short syntax kept, so the
  host path is still created when missing), each with a one-line comment saying the
  agent loop-mounts each AI's disk there and `rshared` lets the host (and the jail's
  bind mount) see it. Files: `deploy/docker-compose.yml`,
  `deploy/coolify/docker-compose.yml`, `deploy/coolify/docker-compose.app.yml`,
  `deploy/coolify/zilar-core.yml`.
- `packages/desk/src/agent/workspace.ts`:
  - added `export const JAIL_UID = 10001;` with a comment that it must match
    `useradd -u 10001` in `packages/desk/Dockerfile`;
  - new images: `mkfs.ext4 -q -F -E root_owner=10001:10001 <image>`;
  - `ensureImage` now always runs `chown 10001:10001 <mountDir>` after the mount
    check (the early `return` when already mounted became an `if` around `mount`,
    so the chown runs on both paths). This fixes existing images' root folder without
    touching the rest of the tree. `directoryWorkspaces` is unchanged.
- `deploy/tests/host-setup.test.sh`: new section 3b asserts each of the four compose
  files mounts the desks root `rshared`.

### Checks run

- `sh deploy/tests/host-setup.test.sh` -> `pass=56 fail=0` (ran twice; the four new
  `ok: <file> mounts the desks root rshared` lines pass).
- `sh deploy/tests/install.test.sh` -> `pass=58 fail=0`.
- `pnpm gate` (repo root) summary:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.3s)
  PASS  lint  (1.3s)
  PASS  typecheck  (2.3s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/desk  (1.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  Changed files: the four compose files, `workspace.ts`, `host-setup.test.sh`, this task file.
- No single Vitest file was run on its own: the desk change is in `ensureImage`, which
  no unit test exercises (the existing `lifecycle.test.ts`/`server.test.ts` inject a
  fake `Workspaces`), so `pnpm gate`'s `tests @zilar/desk` run is the relevant one.

### Notes for the lead

- I could not verify the live behaviour (`docker inspect` propagation, a writable
  `/workspace`): that needs the VPS and a redeploy, so it stays for your live check.
- The chown is not recursive, per the spec. If a pre-existing image already has files
  owned by root inside it, they stay root-owned; only the disk root is fixed. The spec
  asked exactly for this.
- The `rshared` mount only takes effect after `desk-agent` is recreated on the host.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 1 nit.
- **What the lead read:**
  - all four compose files mount `/var/lib/zilar/desks:/var/lib/zilar/desks:rshared`, with a comment;
  - `mkfs.ext4 … -E root_owner=10001:10001` for new images;
  - `chown 10001:10001 <mountDir>` after every mount check, which fixes the existing live image;
  - `JAIL_UID` points at the Dockerfile.
- **The order is right:** `ensure` mounts the disk before `docker create`, so the jail's bind mount sees the mounted disk.
- **After deploy, the lead checks:**
  - the agent's desks mount shows `propagation=rshared`;
  - the AI writes `/workspace/hello.txt` from its computer in "ai test › General".
