import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Guards the mobile accents migration (T-0349 … T-0387): a hand-rolled solid
// accent or danger pill on an interactive element should use the kit Button
// instead. The web twin is `apps/web/src/components/ui/no-accent-pill.test.ts`;
// this one walks `src` with `node:fs` (see `src/lib/routes-dir.test.ts`) because
// the mobile app has no Vite glob import.

const SRC_ROOT = join(__dirname, '..', '..');
const KIT_DIR = join(SRC_ROOT, 'components', 'ui');

// The solid accent background as a whole class token, preceded by a class-list
// boundary and not a tint (`bg-accent/10`) or the extended palette
// (`bg-accent-foreground`). Prefixed tints like `active:bg-accent/90` stay
// allowed because `:` is not a boundary.
const SOLID_ACCENT = /(^|[\s'"`])bg-accent(?![/-])/;

// The solid danger background as a whole class token: `bg-danger/10` and
// prefixed tints like `active:bg-danger/90` stay allowed.
const SOLID_DANGER = /(^|[\s'"`])bg-danger(?![/-])/;

const SOLID_PATTERNS = [
  { token: 'bg-accent', pattern: SOLID_ACCENT },
  { token: 'bg-danger', pattern: SOLID_DANGER },
];

const INTERACTIVE_TAGS = new Set(['Pressable', 'TouchableOpacity', 'Link']);

// Selected states paint a solid fill on purpose (radio, tab, checkbox).
const SELECTED_ROLES = /accessibilityRole="(radio|tab|checkbox)"/;

const KIT_BUTTON_HINT =
  "use the kit Button from '@/components/ui/button' (variant default or destructive)";

interface SolidPill {
  line: number;
  tag: string;
}

interface TagHit {
  tag: string;
  /** 0-based index of the line the tag starts on. */
  line: number;
}

/** The last `<Tag` starting at or before `column` on `index`. */
function lastTagAtOrBefore(lines: string[], index: number, column: number): TagHit | null {
  const pattern = /<([A-Za-z][\w.-]*)/g;
  let found: TagHit | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(lines[index] ?? '')) !== null) {
    if (match.index > column) {
      break;
    }
    if (match[1] !== undefined) {
      found = { tag: match[1], line: index };
    }
  }
  return found;
}

/**
 * The `<Tag` a reader would attribute the class to: the last one at or before
 * `column` on `index`, otherwise the first one on the lines above.
 */
function nearestTag(lines: string[], index: number, column: number): TagHit | null {
  const sameLine = lastTagAtOrBefore(lines, index, column);
  if (sameLine !== null) {
    return sameLine;
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    const match = /<([A-Za-z][\w.-]*)/.exec(lines[i] ?? '');
    if (match?.[1] !== undefined) {
      return { tag: match[1], line: i };
    }
  }
  return null;
}

/** The opening tag text from `<Tag` through the first line that ends with `>`. */
function openingTag(lines: string[], line: number): string {
  const from = (lines[line] ?? '').indexOf('<');
  const parts = [(lines[line] ?? '').slice(from)];
  for (let i = line + 1; i < lines.length; i += 1) {
    const next = lines[i] ?? '';
    parts.push(next);
    if (next.trimEnd().endsWith('>')) {
      break;
    }
  }
  return parts.join('\n');
}

/** Interactive tags carrying a solid accent or danger pill in `source`. */
function findSolidPills(source: string): SolidPill[] {
  const lines = source.split('\n');
  const hits: SolidPill[] = [];
  lines.forEach((line, index) => {
    for (const { token, pattern } of SOLID_PATTERNS) {
      const match = pattern.exec(line);
      if (match === null) {
        continue;
      }
      const column = match.index + match[0].indexOf(token);
      const tag = nearestTag(lines, index, column);
      if (tag === null || !INTERACTIVE_TAGS.has(tag.tag)) {
        continue;
      }
      if (SELECTED_ROLES.test(openingTag(lines, tag.line))) {
        continue;
      }
      hits.push({ line: index + 1, tag: tag.tag });
      break;
    }
  });
  return hits;
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** Non-test sources outside the kit, walked from `src`. */
function listMobileSources(): string[] {
  return filesUnder(SRC_ROOT)
    .filter((file) => file.endsWith('.tsx'))
    .filter((file) => !/\.test\./.test(file))
    .filter((file) => !file.startsWith(`${KIT_DIR}/`));
}

function findHandRolledPills(): { hits: string[]; scanned: number } {
  const files = listMobileSources();
  const hits: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const pill of findSolidPills(source)) {
      hits.push(
        `${file.slice(SRC_ROOT.length + 1)}:${pill.line}: <${pill.tag}> ${KIT_BUTTON_HINT}`,
      );
    }
  }
  return { hits, scanned: files.length };
}

describe('no-solid-pill guard', () => {
  it('flags a solid accent pill on a Pressable, TouchableOpacity or Link', () => {
    expect(
      findSolidPills('<Pressable className="rounded-full bg-accent px-3">Go</Pressable>'),
    ).toEqual([{ line: 1, tag: 'Pressable' }]);
    expect(findSolidPills('<TouchableOpacity className="bg-accent">Go</TouchableOpacity>')).toEqual(
      [{ line: 1, tag: 'TouchableOpacity' }],
    );
    expect(findSolidPills('<Link className="bg-accent px-3">Go</Link>')).toEqual([
      { line: 1, tag: 'Link' },
    ]);
  });

  it('flags a multi-line solid danger pill', () => {
    const source = ['<Pressable', "  className='bg-danger'", '>', '  Delete', '</Pressable>'].join(
      '\n',
    );
    expect(findSolidPills(source)).toEqual([{ line: 2, tag: 'Pressable' }]);
  });

  it('allows Views, tints and prefixed classes', () => {
    expect(findSolidPills('<View className="bg-accent">x</View>')).toEqual([]);
    expect(findSolidPills('<Pressable className="bg-accent/10">x</Pressable>')).toEqual([]);
    expect(findSolidPills('<Pressable className="active:bg-accent/90">x</Pressable>')).toEqual([]);
    expect(findSolidPills('<Pressable className="bg-danger-foreground">x</Pressable>')).toEqual([]);
  });

  it('allows a solid pill on a selected radio, tab or checkbox', () => {
    expect(
      findSolidPills('<Pressable accessibilityRole="radio" className="bg-accent">x</Pressable>'),
    ).toEqual([]);
    expect(
      findSolidPills('<Pressable accessibilityRole="tab" className="bg-accent">x</Pressable>'),
    ).toEqual([]);
    expect(
      findSolidPills('<Pressable accessibilityRole="checkbox" className="bg-danger">x</Pressable>'),
    ).toEqual([]);
  });

  it('finds no hand-rolled solid pill', () => {
    const { hits, scanned } = findHandRolledPills();
    expect(scanned, 'the guard must actually read the mobile sources').toBeGreaterThan(100);
    expect(hits, `hand-rolled solid pill:\n${hits.join('\n')}`).toEqual([]);
  });
});
