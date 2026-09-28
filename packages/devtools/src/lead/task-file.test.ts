import { describe, expect, it } from 'vitest';
import {
  assertNotV4Pro,
  extractBlockedText,
  isV4Pro,
  parseFrontMatter,
  parseTaskFrontMatter,
  splitModel,
} from './task-file';

const FRONT_MATTER = `---
id: T-0038
title: Lead autopilot
status: in-progress
milestone: tooling
branch: task/T-0038-lead-autopilot
model: opencode-go/muse-spark-1.3-contributor
depends_on: []
estimate: 2 days
---

# T-0038
`;

describe('parseTaskFrontMatter', () => {
  it('parses id, branch, model and status', () => {
    const parsed = parseTaskFrontMatter(FRONT_MATTER);
    expect(parsed.id).toBe('T-0038');
    expect(parsed.branch).toBe('task/T-0038-lead-autopilot');
    expect(parsed.model).toBe('opencode-go/muse-spark-1.3-contributor');
    expect(parsed.status).toBe('in-progress');
  });

  it('rejects a missing branch', () => {
    expect(() => parseTaskFrontMatter('---\nid: T-0038\nmodel: a/b\nstatus: todo\n---\n')).toThrow(
      /branch/,
    );
  });

  it('rejects a missing model', () => {
    expect(() =>
      parseTaskFrontMatter('---\nid: T-0038\nbranch: task/x\nstatus: todo\n---\n'),
    ).toThrow(/model/);
  });

  it('rejects a bad task id', () => {
    expect(() =>
      parseTaskFrontMatter('---\nid: nope\nbranch: task/x\nmodel: a/b\nstatus: todo\n---\n'),
    ).toThrow();
  });

  it('rejects a file without front matter', () => {
    expect(() => parseFrontMatter('# no front matter\n')).toThrow(/front matter/);
  });
});

describe('splitModel', () => {
  it('splits providerID and id', () => {
    expect(splitModel('opencode-go/muse-spark-1.3-contributor')).toEqual({
      providerID: 'opencode-go',
      id: 'muse-spark-1.3-contributor',
    });
  });

  it('rejects a model without a provider', () => {
    expect(() => splitModel('muse-spark')).toThrow(/providerID/);
  });
});

describe('isV4Pro', () => {
  it.each([
    'opencode-go/deepseek-v4-pro',
    'deepseek-v4-pro',
    'x/deepseek-v4_pro',
    'opencode-go/DEEPSEEK-V4-PRO',
  ])('refuses %s', (model) => {
    expect(isV4Pro(model)).toBe(true);
    expect(() => assertNotV4Pro(model)).toThrow(/V4 Pro/);
  });

  it.each([
    'opencode-go/deepseek-v4.1-flash',
    'opencode-go/muse-spark-1.3-contributor',
    'opencode-go/mimo-v2.6-flash',
  ])('allows %s', (model) => {
    expect(isV4Pro(model)).toBe(false);
    expect(() => assertNotV4Pro(model)).not.toThrow();
  });
});

describe('extractBlockedText', () => {
  it('returns the text under the blocked subsection', () => {
    const text = [
      '## Report',
      '',
      'did things',
      '',
      '### Blocked / needs a decision',
      '',
      'Need the Apple Developer account.',
      'Second line.',
      '',
      '## Review',
    ].join('\n');
    expect(extractBlockedText(text)).toContain('Need the Apple Developer account.');
    expect(extractBlockedText(text)).not.toContain('## Review');
  });

  it('returns empty when there is no blocked section', () => {
    expect(extractBlockedText('## Report\n\nall good\n')).toBe('');
  });
});
