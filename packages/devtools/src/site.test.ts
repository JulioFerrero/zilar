import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SITE = join(__dirname, '..', '..', '..', 'site');
const html = readFileSync(join(SITE, 'index.html'), 'utf8');

// every local file the landing page points at (href="/x", src="/x"), without fragments and queries
function localReferences(source: string): string[] {
  const found = [...source.matchAll(/\b(?:href|src)="(\/[^"#?]*)"/g)].map((match) => match[1]);
  return [...new Set(found)].filter((path): path is string => path !== undefined && path !== '/');
}

describe('the landing page (site/)', () => {
  it('references only files that exist', () => {
    const missing = localReferences(html).filter((path) => !existsSync(join(SITE, path)));
    expect(missing).toEqual([]);
  });

  it('loads nothing from another host', () => {
    const external = [...html.matchAll(/\b(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    const stylesheet = readFileSync(join(SITE, 'styles.css'), 'utf8');
    expect(external.filter((url) => !url?.startsWith('https://zilar.app'))).toEqual([]);
    expect(stylesheet).not.toMatch(/url\(\s*['"]?https?:/);
    expect(html).not.toMatch(/<script/);
  });

  it('has a title, a description and social metadata', () => {
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toContain('name="description"');
    expect(html).toContain('property="og:image"');
  });
});
