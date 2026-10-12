// `pnpm plan:page`: writes dist/code-map/plan/index.html (the page, every asset
// and the plan data inlined) and prints one summary line with the per-audit
// finding counts. The page lives below the Code map so the Code map can link to
// it at `plan/`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../effect-map/generate.js';
import { collectPlan, type PlanPage } from './collect.js';

const OUT_DIR = 'dist/code-map/plan';
const STYLE_MARKER = '/*STYLE*/';
const STYLE_FINDINGS_MARKER = '/*STYLE-FINDINGS*/';
const SCRIPT_MARKER = '/*SCRIPT*/';
const SCRIPT_FINDINGS_MARKER = '/*SCRIPT-FINDINGS*/';
// page.js holds `const PLAN = /*DATA*/ null`; prettier may add or drop the space.
const DATA_MARKER = /\/\*DATA\*\/\s*null/;

const read = (name: string): string => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

export interface RenderAssets {
  template: string;
  style: string;
  styleFindings: string;
  script: string;
  scriptFindings: string;
}

export function renderHtml(assets: RenderAssets, plan: PlanPage): string {
  // Escaping "<" keeps a title from closing the script tag.
  const inline = JSON.stringify(plan).replace(/</g, '\\u003c');
  return assets.template
    .replace(STYLE_MARKER, () => assets.style)
    .replace(STYLE_FINDINGS_MARKER, () => assets.styleFindings)
    .replace(SCRIPT_MARKER, () => assets.script)
    .replace(SCRIPT_FINDINGS_MARKER, () => assets.scriptFindings)
    .replace(DATA_MARKER, () => inline);
}

export function summaryLine(plan: PlanPage): string {
  const { merged, total } = plan.overall;
  const perAudit = plan.audits
    .map(
      (audit) =>
        `${audit.id} ${plan.findings.filter((finding) => finding.audit === audit.id).length}`,
    )
    .filter((line) => !line.endsWith(' 0'))
    .join(', ');
  return (
    `plan-page: ${plan.audits.length} audits, ${plan.waves.length} waves, ` +
    `${merged}/${total} merged, ${plan.findings.length} findings (${perAudit}), ` +
    `${plan.parity.length} parity rows -> ${OUT_DIR}/index.html`
  );
}

export function main(): void {
  const root = repoRoot();
  const plan = collectPlan(root);
  const dir = join(root, OUT_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'index.html'),
    renderHtml(
      {
        template: read('template.html'),
        style: read('style.css'),
        styleFindings: read('style-findings.css'),
        script: read('page.js'),
        scriptFindings: read('page-findings.js'),
      },
      plan,
    ),
  );
  console.log(summaryLine(plan));
}

// Run only when invoked as the script, so a test can import renderHtml.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
