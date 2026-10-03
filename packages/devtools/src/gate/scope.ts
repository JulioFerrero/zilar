// The "Allowed files" section of a task file names, in backticks, the paths a
// worker may change. The gate turns those tokens into matchers and lists every
// changed file that matches none of them, so the lead sees scope creep without
// reading the whole diff.

export function allowedTokens(taskText: string): string[] {
  const section = /^### Allowed files\s*\n([\s\S]*?)(?=^### |^---\s*$|^## )/m.exec(taskText);
  if (section === null) {
    return [];
  }
  const tokens: string[] = [];
  for (const match of (section[1] ?? '').matchAll(/`([^`\n]+)`/g)) {
    const token = (match[1] ?? '').trim();
    if (token.includes('/') || /\.[a-z]+$/i.test(token)) {
      tokens.push(token);
    }
  }
  return tokens;
}

function escapeRegex(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

// `a/b/**` matches everything below a/b; `a/*.ts` stays inside one folder; a
// bare path matches itself and anything below it (a folder name).
export function tokenMatcher(token: string): RegExp {
  const cleaned = token.replace(/^\.\//, '').replace(/\/$/, '');
  const pattern = cleaned
    .split('**')
    .map((part) => escapeRegex(part).replace(/\*/g, '[^/]*'))
    .join('.*');
  return new RegExp(`^${pattern}(/.*)?$`);
}

export interface ScopeReport {
  /** Files changed that no Allowed-files token covers. */
  outside: string[];
  /** True when the task named no usable tokens (nothing to compare against). */
  unchecked: boolean;
}

// Files every task may touch without naming them.
const ALWAYS_ALLOWED = [/^work\/T-\d+[^/]*\.md$/, /^pnpm-lock\.yaml$/];

export function scopeReport(taskText: string, changedFiles: string[]): ScopeReport {
  const tokens = allowedTokens(taskText);
  if (tokens.length === 0) {
    return { outside: [], unchecked: true };
  }
  const matchers = tokens.map(tokenMatcher);
  const outside = changedFiles.filter(
    (file) =>
      !ALWAYS_ALLOWED.some((always) => always.test(file)) &&
      !matchers.some((matcher) => matcher.test(file)),
  );
  return { outside, unchecked: false };
}
