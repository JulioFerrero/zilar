import { describe, expect, it } from 'vitest';
import { displayNameOf } from './context';

const ANA = 'ana@zilar.test';

describe('displayNameOf', () => {
  it('uses the database name for a resolved sender, never the nick', () => {
    const name = displayNameOf(
      { fromJid: ANA, fromResolved: true, fromNick: 'Julio' },
      new Map([[ANA, 'Ana']]),
    );

    expect(name).toBe('Ana');
  });
});
