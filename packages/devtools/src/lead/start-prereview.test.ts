import { describe, expect, it } from 'vitest';
import { PREREVIEW_MODEL } from './start-prereview.js';

describe('PREREVIEW_MODEL', () => {
  it('points at the free Muse listing', () => {
    expect(PREREVIEW_MODEL).toEqual({
      providerID: 'opencode',
      id: 'muse-spark-1.3-contributor-free',
    });
  });
});
