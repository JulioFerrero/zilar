import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderHtml } from './cli.js';
import { buildPlan, type RawPlan, type TaskInfo } from './collect.js';

const assets = {
  template: readFileSync(new URL('./template.html', import.meta.url), 'utf8'),
  style: readFileSync(new URL('./style.css', import.meta.url), 'utf8'),
  styleFindings: readFileSync(new URL('./style-findings.css', import.meta.url), 'utf8'),
  script: readFileSync(new URL('./page.js', import.meta.url), 'utf8'),
  scriptFindings: readFileSync(new URL('./page-findings.js', import.meta.url), 'utf8'),
};

const TITLE = 'Private uploads need a signed URL';

function planWith(items: RawPlan['waves'][number]['items']): RawPlan {
  return {
    title: 'Test plan',
    updated: '2026-10-12',
    intro: 'intro',
    audits: [],
    waves: [{ id: '1', title: 'Wave 1', goal: 'goal', items }],
  };
}

describe('plan page rendering', () => {
  it('shows the title and the task link of a merged item', () => {
    const tasks = new Map<string, TaskInfo>([
      ['T-1', { status: 'merged', file: 'work/T-1-private-uploads.md' }],
    ]);
    const html = renderHtml(
      assets,
      buildPlan(planWith([{ task: 'T-1', ref: 'SEC-F6', title: TITLE }]), tasks),
    );
    expect(html).toContain(TITLE);
    expect(html).toContain('work/T-1-private-uploads.md');
  });
});
