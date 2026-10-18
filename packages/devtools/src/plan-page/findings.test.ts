import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../effect-map/generate.js';
import { parsePlan } from './collect.js';
import { collectFindings, parseAuditDoc } from './findings.js';
import { parseParity } from './collect.js';

const root = repoRoot();

describe('finding formats', () => {
  it('parses the bullet, bold and table shapes', () => {
    const bullet = parseAuditDoc(
      'MP',
      '- MP-1 P0 mobile: a backgrounded app keeps a socket open. Confirmed.\n',
    );
    expect(bullet).toEqual([
      {
        id: 'MP-1',
        audit: 'MP',
        severity: 'P0',
        platform: 'mobile',
        title: 'a backgrounded app keeps a socket open.',
      },
    ]);

    const bold = parseAuditDoc(
      'SG',
      '**SG-1 (P0, both, confirmed) — blocking does not stop the blocked person.**\n',
    );
    expect(bold).toEqual([
      {
        id: 'SG-1',
        audit: 'SG',
        severity: 'P0',
        platform: 'both',
        title: 'blocking does not stop the blocked person.',
      },
    ]);

    const table = parseAuditDoc(
      'SEC',
      '| Id | Sev | Component | One line |\n' +
        '| --- | --- | --- | --- |\n' +
        '| SEC-1 | P1 | Uploads | an `.svg` is served inline. |\n',
    );
    expect(table).toEqual([
      {
        id: 'SEC-1',
        audit: 'SEC',
        severity: 'P1',
        platform: null,
        title: 'an .svg is served inline.',
      },
    ]);
  });
});

describe('the real audits', () => {
  it('gives at least 190 findings with no duplicate ids', () => {
    const plan = parsePlan(readFileSync(join(root, 'docs/plan/plan.json'), 'utf8'));
    const findings = collectFindings(
      root,
      plan.audits.map((audit) => ({ id: audit.id, doc: audit.doc })),
    );
    expect(findings.length).toBeGreaterThanOrEqual(190);
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(findings.length);
  });

  it('reads the real parity matrix with at least 70 rows', () => {
    const source = readFileSync(join(root, 'docs/audit/telegram-parity-audit.md'), 'utf8');
    const rows = parseParity(source);
    expect(rows.length).toBeGreaterThanOrEqual(70);
  });
});
