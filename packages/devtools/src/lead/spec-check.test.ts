import { describe, expect, it } from 'vitest';
import { checkSpec, formatProblems } from './spec-check';

const deps = (files: string[], server = '') => ({
  exists: (file: string) => files.includes(file),
  serverText: () => server,
});

const spec = (body: string): string => `## Spec\n${body}\n\n## Report\nnothing`;

describe('checkSpec', () => {
  it('passes a spec whose paths and routes exist', () => {
    const text = spec(
      [
        '### Read first',
        '`docs/A.md`, `apps/server/src/contacts/routes.ts`',
        '### Allowed files',
        '`apps/mobile/src/lib/contacts-api.ts`, `apps/mobile/src/components/contacts/**`',
        '### Checks',
        'GET `/api/users/by-handle/:handle`',
      ].join('\n'),
    );
    const problems = checkSpec(
      text,
      deps(
        [
          'docs/A.md',
          'apps/server/src/contacts/routes.ts',
          'apps/mobile/src/lib',
          'apps/mobile/src/components/contacts',
        ],
        "app.get('/users/by-handle/:handle')",
      ),
    );
    expect(problems).toEqual([]);
  });

  it('flags a Read first path that does not exist', () => {
    const problems = checkSpec(spec('### Read first\n`docs/NOPE.md`'), deps([]));
    expect(problems).toEqual([{ kind: 'missing-read-first', detail: 'docs/NOPE.md' }]);
  });

  it('flags an Allowed files entry whose folder does not exist', () => {
    const problems = checkSpec(spec('### Allowed files\n`apps/mobile/src/typo/new.ts`'), deps([]));
    expect(problems[0]?.kind).toBe('missing-folder');
  });

  it('flags a route the server does not define', () => {
    const problems = checkSpec(
      spec('Call `GET /api/nothing/here`.'),
      deps([], "app.get('/other')"),
    );
    expect(problems).toEqual([{ kind: 'unknown-route', detail: '/api/nothing/here' }]);
  });

  it('flags a "like web" claim with no cited web file, and accepts one with a citation', () => {
    expect(checkSpec(spec('Same as web.'), deps([])).map((p) => p.kind)).toEqual([
      'uncited-web-claim',
    ]);
    expect(checkSpec(spec('Same as web (`apps/web/src/A.tsx`).'), deps([]))).toEqual([]);
  });

  it('ignores the Report section', () => {
    const text = '## Spec\n### Read first\n`docs/A.md`\n\n## Report\n`docs/NOPE.md` mentioned here';
    expect(checkSpec(text, deps(['docs/A.md']))).toEqual([]);
  });
});

describe('formatProblems', () => {
  it('prints one line when clean', () => {
    expect(formatProblems('T-1', [])).toBe('T-1: spec check passed');
  });
});
