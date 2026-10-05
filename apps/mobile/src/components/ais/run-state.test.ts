import { describe, expect, it } from 'vitest';

import { runAction, runStateLabel } from './run-state';

describe('runAction', () => {
  it('offers stop for an active AI', () => {
    expect(runAction({ status: 'active' })).toBe('stop');
  });

  it('offers resume for a stopped AI', () => {
    expect(runAction({ status: 'stopped' })).toBe('resume');
  });

  it('offers nothing for a disabled AI (provisioning)', () => {
    expect(runAction({ status: 'disabled' })).toBeNull();
  });
});

describe('runStateLabel', () => {
  it('labels a stopped AI', () => {
    expect(runStateLabel('stopped')).toBe('Stopped');
  });

  it('labels a provisioning AI', () => {
    expect(runStateLabel('disabled')).toBe('Setting up');
  });

  it('returns an empty string for an active AI', () => {
    expect(runStateLabel('active')).toBe('');
  });
});
