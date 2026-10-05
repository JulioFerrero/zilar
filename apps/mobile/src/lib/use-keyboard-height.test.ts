import { describe, expect, it, vi } from 'vitest';

// The mobile app has no React Native renderer under Vitest: mock the native
// module so the hook's module loads, then test the pure event reader it exposes.
vi.mock('react-native', () => ({
  Keyboard: { addListener: () => ({ remove: () => {} }) },
}));

import { keyboardHeightFromEvent } from './use-keyboard-height';

describe('keyboardHeightFromEvent', () => {
  it('reads the keyboard height from the end coordinates', () => {
    expect(keyboardHeightFromEvent({ endCoordinates: { height: 312 } })).toBe(312);
  });

  it('reports no height for a closed keyboard', () => {
    expect(keyboardHeightFromEvent({ endCoordinates: { height: 0 } })).toBe(0);
  });
});
