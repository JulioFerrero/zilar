import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the accents migration (T-0275 … T-0279): a hand-rolled accent pill on
// a button or link should use the kit Button instead. The web tsconfig is
// DOM-only, and its node shim (`src/lib/node-builtins.d.ts`) exposes only
// fs/path/url, so the file list comes from Vite's glob import rather than
// `git ls-files` (the pattern used by `packages/devtools/src/no-legacy-name.test.ts`).

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..', '..', '..', '..');

// The solid accent background as a whole class token, preceded by a class-list
// boundary and not a tint (`bg-accent/10`) or the extended palette
// (`bg-accent-foreground`). Prefixed tints like `hover:bg-accent/90` stay allowed.
const SOLID_ACCENT = /(^|[\s'"`])bg-accent(?![/-])/;

const INTERACTIVE_TAGS = new Set(['button', 'a', 'Link']);

const KIT_BUTTON_HINT =
  "use the kit Button from '@/components/ui/button' (variant default = key-primary)";

// Every source file under `apps/web/src` (`here` is the kit directory itself).
const sourceModules = import.meta.glob(['../../**/*.tsx', '../../*.tsx']);

interface AccentPill {
  line: number;
  tag: string;
}

/** The last `<Tag` starting at or before `column`, or `null`. */
function lastTagAtOrBefore(line: string, column: number): string | null {
  const pattern = /<([A-Za-z][\w.-]*)/g;
  let found: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > column) {
      break;
    }
    if (match[1] !== undefined) {
      found = match[1];
    }
  }
  return found;
}

/**
 * The `<Tag` a reader would attribute the class to: the last one at or before
 * `column` on `index`, otherwise the first one on the lines above.
 */
function nearestTag(lines: string[], index: number, column: number): string | null {
  const sameLine = lastTagAtOrBefore(lines[index] ?? '', column);
  if (sameLine !== null) {
    return sameLine;
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    const match = /<([A-Za-z][\w.-]*)/.exec(lines[i] ?? '');
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return null;
}

/** Interactive tags carrying a solid accent pill in `source`. */
function findAccentPills(source: string): AccentPill[] {
  const lines = source.split('\n');
  const hits: AccentPill[] = [];
  lines.forEach((line, index) => {
    const accent = SOLID_ACCENT.exec(line);
    if (accent === null) {
      return;
    }
    const column = accent.index + accent[0].indexOf('bg-accent');
    const tag = nearestTag(lines, index, column);
    if (tag !== null && INTERACTIVE_TAGS.has(tag)) {
      hits.push({ line: index + 1, tag });
    }
  });
  return hits;
}

/** Non-test source files from the kit outward, read as text. */
function listWebSources(): { path: string; source: string }[] {
  const sources: { path: string; source: string }[] = [];
  for (const key of Object.keys(sourceModules)) {
    const absolute = join(here, key);
    if (absolute.startsWith(`${here}/`) || key.endsWith('.test.tsx')) {
      continue;
    }
    sources.push({
      path: absolute.slice(REPO_ROOT.length + 1),
      source: readFileSync(absolute, 'utf8'),
    });
  }
  return sources;
}

function findHandRolledPills(): { hits: string[]; scanned: number } {
  const sources = listWebSources();
  const hits: string[] = [];
  for (const { path, source } of sources) {
    for (const pill of findAccentPills(source)) {
      hits.push(`${path}:${pill.line}: <${pill.tag}> ${KIT_BUTTON_HINT}`);
    }
  }
  return { hits, scanned: sources.length };
}

describe('no-accent-pill guard', () => {
  it('flags a solid accent pill on a button, an anchor or a Link', () => {
    expect(findAccentPills('<button className="bg-accent px-2">Go</button>')).toEqual([
      { line: 1, tag: 'button' },
    ]);
    expect(findAccentPills('<Link className="bg-accent px-3">Go</Link>')).toEqual([
      { line: 1, tag: 'Link' },
    ]);
    expect(findAccentPills('<a className="bg-accent px-3">Go</a>')).toEqual([
      { line: 1, tag: 'a' },
    ]);
    expect(findAccentPills('<span><button className="bg-accent px-2">Go</button>')).toEqual([
      { line: 1, tag: 'button' },
    ]);
  });

  it('allows spans, other tags and tinted or prefixed accent classes', () => {
    expect(findAccentPills('<span className="bg-accent px-1">3</span>')).toEqual([]);
    expect(findAccentPills('<button className="bg-accent/10 px-2">Go</button>')).toEqual([]);
    expect(findAccentPills('<button className="hover:bg-accent/90">Go</button>')).toEqual([]);
    expect(findAccentPills('<div className="bg-accent-foreground">x</div>')).toEqual([]);
  });

  it('finds the tag across a multi-line class string', () => {
    const source = [
      '<button',
      "  className={cn('bg-accent', 'px-2')}",
      '>',
      '  Go',
      '</button>',
    ].join('\n');
    expect(findAccentPills(source)).toEqual([{ line: 2, tag: 'button' }]);
  });

  it('finds no hand-rolled accent pill on a button, anchor or Link', () => {
    const { hits, scanned } = findHandRolledPills();
    expect(scanned, 'the guard must actually read the web sources').toBeGreaterThan(50);
    expect(hits, `hand-rolled accent pill:\n${hits.join('\n')}`).toEqual([]);
  });
});
