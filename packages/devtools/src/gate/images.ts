// T-1412: a production image copies only the workspace packages its app
// imports, listed by hand in the app's Dockerfile. T-1410 added `@zilar/desk` to
// apps/server/package.json without adding it to apps/server/Dockerfile, so the
// Coolify build failed at `pnpm --filter @zilar/server build` with a resolve
// error and no merge could deploy. T-1101 was the same bug for the web image and
// `@zilar/ball-avatar`. This check compares, as plain text and without Docker,
// the `@zilar/*` workspace dependencies of an app with the `COPY packages/<name>`
// lines of that app's Dockerfile, and fails when one is missing.

import type { WorkspacePackage } from './plan.js';

export interface ImageTarget {
  /** App directory, the prefix of the failure path. */
  app: string;
  /** The app manifest that names its workspace dependencies. */
  manifest: string;
  /** The Dockerfile whose COPY lines must cover them. */
  dockerfile: string;
}

// The apps that build a production image from the workspace root.
export const IMAGE_TARGETS: readonly ImageTarget[] = [
  {
    app: 'apps/server',
    manifest: 'apps/server/package.json',
    dockerfile: 'apps/server/Dockerfile',
  },
  { app: 'apps/web', manifest: 'apps/web/package.json', dockerfile: 'apps/web/Dockerfile' },
];

// The web app reaches @zilar/mock-backend only through the VITE_MOCK branch that
// Vite folds out of a production build (apps/web/src/mock/load.ts), so the
// production image deliberately does not copy it. Every other workspace
// dependency that is present must be copied, or the app's build fails on a
// resolve error.
const NOT_IN_IMAGE = new Set(['@zilar/mock-backend']);

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** The `@zilar/*` workspace dependencies of an app manifest, sorted. */
export function workspaceDeps(manifest: string): string[] {
  const parsed = JSON.parse(manifest) as Manifest;
  const names: string[] = [];
  for (const block of [parsed.dependencies, parsed.devDependencies]) {
    for (const [name, range] of Object.entries(block ?? {})) {
      if (name.startsWith('@zilar/') && range.startsWith('workspace:')) {
        names.push(name);
      }
    }
  }
  return [...new Set(names)].sort();
}

// The `packages/<name>` directories a Dockerfile copies whole. A manifest copy
// (`COPY packages/desk/package.json packages/desk/`) names a nested path and is
// skipped: only the source copy makes the package importable at build time.
export function copiedPackageDirs(dockerfile: string): Set<string> {
  const dirs = new Set<string>();
  for (const line of dockerfile.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== 'COPY') {
      continue;
    }
    const source = parts.slice(1).filter((part) => !part.startsWith('--'))[0];
    if (source !== undefined && /^packages\/[^/]+$/.test(source)) {
      dirs.add(source);
    }
  }
  return dirs;
}

/** The workspace package directory for `@zilar/<name>`, whatever the export is. */
export function packageDirFor(name: string, workspace: WorkspacePackage[]): string {
  return (
    workspace.find((pkg) => pkg.name === name)?.dir ?? `packages/${name.slice('@zilar/'.length)}`
  );
}

export interface ImageCheckInput {
  app: string;
  manifest: string;
  dockerfile: string;
  workspace: WorkspacePackage[];
}

/** One message per workspace dependency the app's Dockerfile does not copy. */
export function checkImagePackages(input: ImageCheckInput): string[] {
  const copied = copiedPackageDirs(input.dockerfile);
  const failures: string[] = [];
  for (const name of workspaceDeps(input.manifest)) {
    if (NOT_IN_IMAGE.has(name)) {
      continue;
    }
    const dir = packageDirFor(name, input.workspace);
    if (!copied.has(dir)) {
      failures.push(`${input.app}/Dockerfile: missing \`COPY ${dir} ${dir}\` for ${name}`);
    }
  }
  return failures;
}

/**
 * The image check for the repo: reads each target's manifest and Dockerfile
 * through `read` and collects every missing package. A target whose files cannot
 * be read is reported rather than thrown, so one broken path does not hide the
 * rest.
 */
export function checkImages(
  workspace: WorkspacePackage[],
  read: (file: string) => string,
): string[] {
  const failures: string[] = [];
  for (const target of IMAGE_TARGETS) {
    try {
      failures.push(
        ...checkImagePackages({
          app: target.app,
          manifest: read(target.manifest),
          dockerfile: read(target.dockerfile),
          workspace,
        }),
      );
    } catch {
      failures.push(`${target.dockerfile}: cannot read ${target.manifest} or the Dockerfile`);
    }
  }
  return failures;
}
