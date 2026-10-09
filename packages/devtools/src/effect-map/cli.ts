// `pnpm effect:map`: writes dist/effect-map/index.html (the page, data inlined)
// and dist/effect-map/data.json at the repo root, and prints one summary line.
// With GITHUB_STEP_SUMMARY set (in CI) it also appends a per-package table.
// With `--check-baseline <file>` it exits 1 when needs-effect files exceed the baseline.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  checkNeedsEffectBaseline,
  generateEffectMap,
  MARKER_BUDGET,
  repoRoot,
  type EffectMap,
} from './generate.js';

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
  const over = total.markersOverBudget ? ' (over budget)' : '';
  return (
    `effect-map: ${total.files} files, coverage ${total.coveragePct.toFixed(1)}% ` +
    `(effect ${kinds.effect.files}, needs-effect ${kinds['needs-effect'].files}, ` +
    `plain ${kinds.plain.files}, exempt ${kinds.exempt.files}, legacy ${kinds.legacy.files}), ` +
    `tier B ${total.tierB.files}, markers ${total.markers.length}/${MARKER_BUDGET}${over} -> ${output}`
  );
}

export function markdownSummary(map: EffectMap): string {
  const row = (name: string, s: EffectMap['total']): string =>
    `| ${name} | ${s.files} | ${s.kinds.effect.files} | ${s.effectLinesPct.toFixed(1)}% | ` +
    `${s.coveragePct.toFixed(1)}% | ${s.kinds['needs-effect'].files} | ${s.kinds.legacy.files} |`;
  return [
    '## Effect map',
    '',
    '| Package | Files | Effect files | Effect % (lines) | Coverage | Needs-effect files | Legacy files |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...map.packages.map((p) => row(`\`${p.name}\``, p)),
    row('**Total**', map.total),
    '',
    `${map.tasks.length} open tasks (todo, in-progress, review) touch ${map.files.filter((f) => f.tasks.length > 0).length} files.`,
    '',
  ].join('\n');
}

const baselineFlag = process.argv.indexOf('--check-baseline');
const baselineFile = baselineFlag < 0 ? undefined : process.argv[baselineFlag + 1];
if (baselineFlag >= 0 && baselineFile === undefined) {
  console.error('usage: effect:map --check-baseline <file>');
  process.exit(2);
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

// The baseline path is relative to the directory the script runs in.
if (baselineFile !== undefined) {
  const failure = checkNeedsEffectBaseline(map, readFileSync(resolve(baselineFile), 'utf8'));
  if (failure !== null) {
    console.error(`effect-map: ${failure}`);
    process.exitCode = 1;
  }
}
