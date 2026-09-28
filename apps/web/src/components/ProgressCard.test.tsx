import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgressSchema } from '@galena/protocol';
import { ProgressCard } from './ProgressCard';

const progress = ProgressSchema.parse({
  ai: 'dev-1@ai.galena.test',
  stage: 'Running e2e tests',
  detail: '12 of 15 specs',
  percent: 80,
});

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProgressCard', () => {
  it('spins the loader and shows the stage, detail and progress', () => {
    const { container } = render(<ProgressCard progress={progress} />);

    expect(screen.getByText('Running e2e tests')).toBeTruthy();
    expect(screen.getByText('12 of 15 specs')).toBeTruthy();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('80');
  });

  it('keeps the loader and progress but marks it reduced under reduced motion', () => {
    stubReducedMotion(true);
    const { container } = render(<ProgressCard progress={progress} />);

    expect(screen.getByText('Running e2e tests')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('80');
    // Still legible as "in progress": the icon stays, only the motion goes.
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.querySelector('.spinner-reduced')).not.toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
