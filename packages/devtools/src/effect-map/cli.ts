// `pnpm effect:map`: writes dist/effect-map/index.html (the page, data inlined)
// and dist/effect-map/data.json at the repo root, and prints one summary line.
// With GITHUB_STEP_SUMMARY set (in CI) it also appends a per-package table.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateEffectMap, repoRoot, type EffectMap } from './generate.js';

const OUT_DIR = 'dist/effect-map';
// The template holds `/*DATA*/ null`; prettier may add or drop the space.
const DATA_MARKER = /\/\*DATA\*\/\s*null/;

export function renderHtml(template: string, map: EffectMap): string {
  // Escaping "<" keeps a path or commit subject from closing the script tag.
  const inline = JSON.stringify(map).replace(/</g, '\\u003c');
  return template.replace(DATA_MARKER, () => inline);
}

export function summaryLine(map: EffectMap, output: string): string {
  const { total } = map;
  const kinds = total.kinds;
  return [
    `effect-map: ${total.files} files (Effect ${kinds.effect.files}, plain ${kinds.plain.files}, legacy ${kinds.legacy.files})`,
    `Effect ${total.effectLinesPct.toFixed(1)}% of lines, ${total.effectFilesPct.toFixed(1)}% of files`,
    `${map.tasks.length} open tasks -> ${output}`,
  ].join(', ');
}

export function markdownSummary(map: EffectMap): string {
  const row = (name: string, s: EffectMap['total']): string =>
    `| ${name} | ${s.files} | ${s.kinds.effect.files} | ${s.effectLinesPct.toFixed(1)}% | ${s.kinds.legacy.files} |`;
  return [
    '## Effect map',
    '',
    '| Package | Files | Effect files | Effect % (lines) | Legacy files |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...map.packages.map((p) => row(`\`${p.name}\``, p)),
    row('**Total**', map.total),
    '',
    `${map.tasks.length} open tasks (todo, in-progress, review) touch ${map.files.filter((f) => f.tasks.length > 0).length} files.`,
    '',
  ].join('\n');
}

const root = repoRoot();
const map = generateEffectMap(root);
const dir = join(root, OUT_DIR);
const template = readFileSync(new URL('./template.html', import.meta.url), 'utf8');

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'index.html'), renderHtml(template, map));
writeFileSync(join(dir, 'data.json'), `${JSON.stringify(map)}\n`);

const stepSummary = process.env.GITHUB_STEP_SUMMARY;
if (stepSummary) {
  appendFileSync(stepSummary, markdownSummary(map));
}

console.log(summaryLine(map, `${OUT_DIR}/index.html`));
