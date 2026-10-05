import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

const fixtureModules = import.meta.glob<{ default: Record<string, ReactNode> }>('./*.fixture.tsx', {
  eager: true,
});

describe('ui fixtures', () => {
  it('loads at least 7 fixture files', () => {
    expect(Object.keys(fixtureModules).length).toBeGreaterThanOrEqual(7);
  });

  for (const [path, mod] of Object.entries(fixtureModules)) {
    describe(path, () => {
      for (const [name, node] of Object.entries(mod.default)) {
        it(`renders ${name} without throwing`, () => {
          render(node);
        });
      }
    });
  }
});
