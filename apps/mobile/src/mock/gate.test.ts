import { describe, expect, it } from 'vitest';

import * as gate from './gate';
import { mockParamAllowed } from './gate';

describe('mock env constants', () => {
  it('exports the bundle-time mock env values the hooks import', () => {
    expect(Object.keys(gate)).toEqual(
      expect.arrayContaining(['ENV_MOCK', 'ENV_MOCK_SCENARIO', 'ENV_NODE_ENV', 'MOCK_ENV']),
    );
  });
});

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
