---
id: T-0661
title: "typecheck with tsgo: add @typescript/native-preview (pinned) and switch every package's typecheck script from tsc to tsgo; any package where tsgo's result differs from tsc keeps tsc and is reported"
status: todo
milestone: M5
branch: task/T-0661-typecheck-with-tsgo
model: auto
effort: low
depends_on: [T-0659]
estimate: 0.5 day
---

# T-0661: typecheck with tsgo

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-09: "use tsgo, please". T-0657 measured tsgo 7.0.0-dev.20260707.2 against tsc 6.0.3:
- the same result, 0 errors, on `apps/server` and `packages/protocol`;
- 1.9x faster on `apps/server` and 4.1x faster on `packages/protocol`.

The gate's typecheck step runs each package's `typecheck` script through Turbo (`packages/devtools/src/gate/plan.ts`), so switching the scripts switches the gate.

### Verified facts (do not re-derive)
- **The `typecheck` scripts:**

  | `package.json` | Script |
  | --- | --- |
  | `apps/mobile:11`, `apps/runner:7`, `apps/server:9` | `tsc --noEmit` |
  | `packages/devtools:10`, `packages/agent-drivers:10`, `packages/chat-core:10` | `tsc --noEmit` |
  | `packages/protocol:10`, `packages/ui-tokens:10`, `packages/runner-tunnel:10` | `tsc --noEmit` |
  | `apps/site:10` | `tsc --noEmit -p tsconfig.json` |
  | `apps/web:11` | `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json` |
  | `packages/xmpp-core:10` | `tsc --noEmit && tsc --noEmit -p tsconfig.integration.json` |

- **The npm package** is `@typescript/native-preview`, and its binary is `tsgo`. T-0657 found that `pnpm dlx @typescript/native-preview --noEmit` runs it; once it is installed, the binary is `tsgo`.

### What to build
1. **Add `@typescript/native-preview` at exactly `7.0.0-dev.20260707.2`**, with no caret, as a devDependency wherever `pnpm --filter <pkg> typecheck` needs to find `tsgo`. That is the root `package.json` if pnpm puts the root's bins on the path for workspace scripts; otherwise add it to each package. Check it with one package before doing the rest.
2. **In every script above, replace `tsc` with `tsgo`** and keep the same flags and `-p` projects.
3. **For each package, run the old command and the new command one after the other** and compare the exit code and the number of errors.
   - If tsgo differs in any package (more or fewer errors, or a flag it does not accept), keep `tsc` for that package and report it with the first errors.
   - Pay attention to `apps/mobile` (Expo / React Native types) and `apps/web` (two projects).
4. **Keep the `typescript` dependency.** Editors, Expo and other tools still use it.
5. **In the Report,** add a table with the package, `tsc` seconds, `tsgo` seconds and the result. Run `pnpm exec turbo run typecheck --force --concurrency=2` once, so every package is typechecked with tsgo, and paste its summary lines. The gate itself checks only affected packages.

### Read first
`AGENTS.md`, `work/T-0657-tsgo-spike.md` (its Report), the `package.json` of each package listed above, and the root `package.json`.

### Allowed files
`package.json`, `pnpm-lock.yaml`, `apps/mobile/package.json`, `apps/runner/package.json`, `apps/server/package.json`, `apps/site/package.json`, `apps/web/package.json`, `packages/devtools/package.json`, `packages/agent-drivers/package.json`, `packages/chat-core/package.json`, `packages/xmpp-core/package.json`, `packages/protocol/package.json`, `packages/ui-tokens/package.json`, `packages/runner-tunnel/package.json`, `work/T-0661-typecheck-with-tsgo.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- Every `typecheck` script uses `tsgo`, except any package the Report shows differs.
- The tsgo version is pinned.
- The full `turbo run typecheck --force` passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
