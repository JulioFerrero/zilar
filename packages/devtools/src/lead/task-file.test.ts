import { describe, expect, it } from 'vitest';
import {
  assertAllowedModel,
  assertNotV4Pro,
  extractBlockedText,
  isCostlyMetaModel,
  isV4Pro,
  parseFrontMatter,
  pickEffort,
  parseTaskFrontMatter,
  reviewModel,
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

  it('accepts model: auto', () => {
    const parsed = parseTaskFrontMatter(
      FRONT_MATTER.replace('opencode-go/muse-spark-1.3-contributor', 'auto'),
    );
    expect(parsed.model).toBe('auto');
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

describe('Meta Model API cost guard', () => {
  it.each([
    'meta/muse-spark-1.3',
    'meta/muse-spark-1.2',
    'meta/muse-spark-1.1',
    'META/muse-spark-1.3',
  ])('refuses %s', (model) => {
    expect(isCostlyMetaModel(model)).toBe(true);
    expect(() => assertAllowedModel(model)).toThrow(/contributor/);
  });

  it.each([
    'meta/muse-spark-1.3-contributor',
    'meta/muse-spark-1.2-contributor',
    'opencode-go/muse-spark-1.3-contributor',
    'minimax-coding-plan/MiniMax-M3',
  ])('allows %s', (model) => {
    expect(isCostlyMetaModel(model)).toBe(false);
    expect(() => assertAllowedModel(model)).not.toThrow();
  });

  it('still refuses DeepSeek V4 Pro', () => {
    expect(() => assertAllowedModel('opencode-go/deepseek-v4-pro')).toThrow(/V4 Pro/);
  });
});

describe('pickEffort', () => {
  const task = (allowed: string, estimate = '1 day'): string =>
    `---\nestimate: ${estimate}\n---\n\n### Allowed files\n${allowed}\n\n### Checks\n`;

  it('is low for a contained job', () => {
    expect(pickEffort(task('`apps/mobile/**`'), undefined)).toBe('low');
  });

  it('is high when the allowed files touch the schema or migrations', () => {
    expect(pickEffort(task('`apps/server/src/db/schema.ts`, `apps/web/**`'), undefined)).toBe(
      'high',
    );
    expect(pickEffort(task('`apps/server/drizzle/**`'), undefined)).toBe('high');
  });

  it('is high for a long estimate and ignores risky words outside Allowed files', () => {
    expect(pickEffort(task('`apps/web/**`', '3 days'), undefined)).toBe('high');
    expect(pickEffort(`${task('`apps/web/**`')}\nmentions schema.ts in prose`, undefined)).toBe(
      'low',
    );
  });

  it('lets the front matter win', () => {
    expect(pickEffort(task('`apps/server/drizzle/**`'), 'low')).toBe('low');
  });
});

describe('reviewModel', () => {
  it('returns the free Muse default when the env is unset', () => {
    expect(reviewModel({})).toEqual({
      providerID: 'opencode',
      id: 'muse-spark-1.3-contributor-free',
    });
  });

  it('returns the free Muse default for an empty override', () => {
    expect(reviewModel({ ZILAR_REVIEW_MODEL: '' })).toEqual({
      providerID: 'opencode',
      id: 'muse-spark-1.3-contributor-free',
    });
  });

  it('splits a valid override into providerID and id', () => {
    expect(reviewModel({ ZILAR_REVIEW_MODEL: 'meta/muse-spark-1.3-contributor' })).toEqual({
      providerID: 'meta',
      id: 'muse-spark-1.3-contributor',
    });
  });

  it('refuses a costly Meta Model API tier', () => {
    expect(() => reviewModel({ ZILAR_REVIEW_MODEL: 'meta/muse-spark-1.3' })).toThrow(/contributor/);
  });

  it('refuses a malformed value', () => {
    expect(() => reviewModel({ ZILAR_REVIEW_MODEL: 'nonsense' })).toThrow(/providerID\/modelID/);
  });
});
