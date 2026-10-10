// `pnpm code:map`: writes dist/code-map/index.html (the page, every asset and the
// data inlined) and dist/code-map/data.json at the repo root, and prints one
// summary line.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../effect-map/generate.js';
import { collectCodeMap, type CodeMap } from './collect.js';

const OUT_DIR = 'dist/code-map';
const STYLE_MARKER = '/*STYLE*/';
const SCRIPT_MARKER = '/*SCRIPT*/';
// The script holds `const MAP = /*DATA*/ null`; prettier may add or drop the space.
const DATA_MARKER = /\/\*DATA\*\/\s*null/;

const read = (name: string): string => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

export function renderHtml(template: string, style: string, script: string, map: CodeMap): string {
  // Escaping "<" keeps a path or commit subject from closing the script tag.
  const inline = JSON.stringify(map).replace(/</g, '\\u003c');
  return template
    .replace(STYLE_MARKER, () => style)
    .replace(SCRIPT_MARKER, () => script)
    .replace(DATA_MARKER, () => inline);
}

export function summaryLine(map: CodeMap): string {
  const { source, test, mock, generated } = map.totals.byClass;
  const delta = map.week.sourceDelta;
  const week = `${delta <= 0 ? '−' : '+'}${Math.abs(delta).toLocaleString('en-US')} this week`;
  return (
    `code-map: ${map.totals.files} files, source ${source.lines.toLocaleString('en-US')} ` +
    `(${week}), test ${test.lines.toLocaleString('en-US')}, mock ${mock.lines.toLocaleString('en-US')}, ` +
    `generated ${generated.lines.toLocaleString('en-US')}, over ${map.lineLimit}: ${map.totals.over400} ` +
    `-> ${OUT_DIR}/index.html`
  );
}

const root = repoRoot();
const map = collectCodeMap(root);
const dir = join(root, OUT_DIR);
const template = read('template.html');
const style = [read('style.css'), read('style-panels.css')].join('\n');
const script = [read('treemap.js'), read('page.js')].join('\n');

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'index.html'), renderHtml(template, style, script, map));
writeFileSync(join(dir, 'data.json'), `${JSON.stringify(map)}\n`);

console.log(summaryLine(map));
