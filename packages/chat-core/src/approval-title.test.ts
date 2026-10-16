import { describe, expect, it } from 'vitest';
import { routineCardTitle } from './approval-title';

describe('routineCardTitle', () => {
  it('splits a routine summary at the last " · ", keeping a title that contains one', () => {
    expect(routineCardTitle('routine.schedule', 'Prices · every 5 minutes')).toEqual({
      title: 'Prices',
      schedule: 'every 5 minutes',
    });
    expect(routineCardTitle('routine.schedule', 'BTC · gold · every 5 minutes')).toEqual({
      title: 'BTC · gold',
      schedule: 'every 5 minutes',
    });
  });

  it('returns null for a non-routine action', () => {
    expect(routineCardTitle('send_message', 'Prices · every 5 minutes')).toBeNull();
  });
});
