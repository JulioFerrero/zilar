// `lead spec-check T-XXXX` reads a task's Spec before a worker starts and
// reports claims that are not true of the code, the mistake that cost whole
// rounds (a spec that invents a feature, names a file that does not exist, or
// calls a route the server does not have).

import path from 'node:path';

export interface SpecProblem {
  kind: 'missing-read-first' | 'missing-folder' | 'unknown-route' | 'uncited-web-claim';
  detail: string;
}

export interface SpecCheckDeps {
  /** True when a repo-relative path exists (file or folder). */
  exists: (relativePath: string) => boolean;
  /** Source text of the server routes and route tests, to look routes up in. */
  serverText: () => string;
}

function section(text: string, heading: string): string {
  const match = new RegExp(
    `^### ${heading}\\s*\\n([\\s\\S]*?)(?=^### |^---\\s*$|^## |$(?![\\s\\S]))`,
    'm',
  ).exec(text);
  return match?.[1] ?? '';
}

function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((match) => (match[1] ?? '').trim());
}

function looksLikePath(token: string): boolean {
  return /^[\w@.-]+(\/[\w@.[\]()*-]+)+\/?$/.test(token) && !token.includes(' ');
}

function hasGlob(token: string): boolean {
  return token.includes('*');
}

// `docs/a.md#section` and `docs/a.md:12` name the file.
function bareFile(token: string): string {
  return token.replace(/[#:][^/]*$/, '');
}

export function checkSpec(taskText: string, deps: SpecCheckDeps): SpecProblem[] {
  const problems: SpecProblem[] = [];
  const spec = taskText.split(/^## Report/m)[0] ?? taskText;

  for (const token of backticked(section(spec, 'Read first'))) {
    if (!looksLikePath(bareFile(token)) || hasGlob(token)) {
      continue;
    }
    if (!deps.exists(bareFile(token))) {
      problems.push({ kind: 'missing-read-first', detail: token });
    }
  }

  for (const token of backticked(section(spec, 'Allowed files'))) {
    if (!looksLikePath(token)) {
      continue;
    }
    const concrete = token.split('*')[0] ?? token;
    const folder = concrete.endsWith('/') ? concrete.slice(0, -1) : path.posix.dirname(concrete);
    // A new folder is fine (a task may create one); a new folder under a
    // folder that does not exist either is a typo.
    const parent = path.posix.dirname(folder);
    const typo = !deps.exists(folder) && parent !== '.' && !deps.exists(parent);
    if (folder !== '.' && folder !== '' && typo) {
      problems.push({
        kind: 'missing-folder',
        detail: `${token} (neither ${folder} nor its parent exists)`,
      });
    }
  }

  const serverText = deps.serverText();
  const seen = new Set<string>();
  for (const match of spec.matchAll(/`(?:GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[^\s`?]+)/g)) {
    const route = match[1] ?? '';
    if (seen.has(route)) {
      continue;
    }
    seen.add(route);
    // Route params differ in name (":handle" vs "{handle}"): compare the static prefix.
    const prefix = route.replace(/\/[:{][^/]*$/, '').replace(/\/[:{].*$/, '');
    const relative = prefix.replace(/^\/api/, '');
    if (!serverText.includes(relative) && !serverText.includes(prefix)) {
      problems.push({ kind: 'unknown-route', detail: route });
    }
  }

  const claimsWeb = /\b(like|as|same as|matches|mirrors|from) (the )?web\b/i.test(spec);
  if (claimsWeb && !/apps\/web\//.test(spec)) {
    problems.push({
      kind: 'uncited-web-claim',
      detail:
        'the spec says it matches web but names no apps/web/ file; read the web code and cite it',
    });
  }
  return problems;
}

export function formatProblems(task: string, problems: SpecProblem[]): string {
  if (problems.length === 0) {
    return `${task}: spec check passed`;
  }
  const lines = problems.map((problem) => `  ${problem.kind}: ${problem.detail}`);
  return [`${task}: ${problems.length} problem(s) in the spec`, ...lines].join('\n');
}
