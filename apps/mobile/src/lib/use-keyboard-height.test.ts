import { describe, expect, it, vi } from 'vitest';

// The mobile app has no React Native renderer under Vitest: mock the native
// module so the hook's module loads, then test the pure event reader it exposes.
vi.mock('react-native', () => ({
  Keyboard: { addListener: () => ({ remove: () => {} }) },
}));

import { keyboardHeightFromEvent, sheetBottomPadding } from './use-keyboard-height';

describe('keyboardHeightFromEvent', () => {
  it('reads the keyboard height from the end coordinates', () => {
    expect(keyboardHeightFromEvent({ endCoordinates: { height: 312 } })).toBe(312);
  });

  it('reports no height for a closed keyboard', () => {
    expect(keyboardHeightFromEvent({ endCoordinates: { height: 0 } })).toBe(0);
  });
});

describe('sheetBottomPadding', () => {
  it('keeps the 16 px minimum with no keyboard on Android', () => {
    expect(sheetBottomPadding('android', 0, 0)).toBe(16);
  });

  it('adds the keyboard height on Android', () => {
    expect(sheetBottomPadding('android', 24, 300)).toBe(324);
  });

  it('ignores the keyboard height on iOS', () => {
    expect(sheetBottomPadding('ios', 34, 300)).toBe(34);
  });
});
