import { describe, expect, it } from 'vitest';

import { mockParamAllowed } from './gate';

describe('mockParamAllowed', () => {
  it('covers dev on/off against every EXPO_PUBLIC_ZILAR_MOCK value', () => {
    const cases: Array<[boolean, string | undefined, boolean]> = [
      [true, undefined, true],
      [true, '1', true],
      [true, '0', true],
      [true, 'false', true],
      [true, '', true],
      [false, undefined, false],
      [false, '1', true],
      [false, 'default', true],
      [false, '0', false],
      [false, 'false', false],
      [false, '', false],
    ];
    for (const [dev, envMock, expected] of cases) {
      expect(mockParamAllowed({ dev, envMock })).toBe(expected);
    }
  });
});
