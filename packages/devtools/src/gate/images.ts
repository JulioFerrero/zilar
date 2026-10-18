// A production image copies only the workspace packages its Dockerfile names by hand.
// This compares, as plain text and without Docker, the `@zilar/*` workspace deps of
// an app with the `COPY packages/<name>` lines of its Dockerfile.

import type { WorkspacePackage } from './plan.js';

export interface ImageTarget {
  app: string;
  manifest: string;
  dockerfile: string;
}

export const IMAGE_TARGETS: readonly ImageTarget[] = [
  {
    app: 'apps/server',
    manifest: 'apps/server/package.json',
    dockerfile: 'apps/server/Dockerfile',
  },
  { app: 'apps/web', manifest: 'apps/web/package.json', dockerfile: 'apps/web/Dockerfile' },
];

// The web app reaches @zilar/mock-backend only through the VITE_MOCK branch Vite
// folds out of a production build, so its image does not copy it.
const NOT_IN_IMAGE = new Set(['@zilar/mock-backend']);

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

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

// The `packages/<name>` directories a Dockerfile copies whole; a manifest copy
// (`COPY packages/desk/package.json ...`) names a nested path and is skipped.
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
