// Which checks the gate runs for a set of changed files. The whole repo always
// gets format, lint and typecheck (they are fast and global); tests run only
// for the packages whose files changed, always with the worker cap.

export interface WorkspacePackage {
  name: string;
  dir: string;
  hasTests: boolean;
}

export interface GateStep {
  label: string;
  command: string;
  args: string[];
}

export function packagesTouched(
  changedFiles: string[],
  workspace: WorkspacePackage[],
): WorkspacePackage[] {
  const found = new Map<string, WorkspacePackage>();
  for (const file of changedFiles) {
    for (const pkg of workspace) {
      if (file === pkg.dir || file.startsWith(`${pkg.dir}/`)) {
        found.set(pkg.name, pkg);
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function gateSteps(
  changedFiles: string[],
  workspace: WorkspacePackage[],
  base: string,
): GateStep[] {
  const steps: GateStep[] = [
    { label: 'install (frozen)', command: 'pnpm', args: ['install', '--frozen-lockfile'] },
    { label: 'format', command: 'pnpm', args: ['format:check'] },
    { label: 'lint', command: 'pnpm', args: ['lint'] },
    { label: 'typecheck', command: 'pnpm', args: ['typecheck'] },
  ];
  for (const pkg of packagesTouched(changedFiles, workspace)) {
    if (pkg.hasTests) {
      steps.push({
        label: `tests ${pkg.name}`,
        command: 'pnpm',
        args: ['--filter', pkg.name, 'test', '--maxWorkers=2', '--changed', base],
      });
    }
  }
  return steps;
}
