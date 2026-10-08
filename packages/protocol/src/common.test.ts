import { describe, expect, it } from 'vitest';
import {
  ArtifactRefSchema,
  BudgetSchema,
  CurrencySchema,
  IdSchema,
  IsoDateTimeSchema,
  JidSchema,
  MoneySchema,
  isValid,
} from './index';

describe('JidSchema', () => {
  it('accepts a normal JID', () => {
    expect(isValid(JidSchema)('dev-1@ai.example.com')).toBe(true);
  });

  it('rejects a JID without an @', () => {
    expect(isValid(JidSchema)('no-at')).toBe(false);
  });

  it('rejects a JID with two @', () => {
    expect(isValid(JidSchema)('two@@signs')).toBe(false);
  });

  it('rejects a JID with whitespace', () => {
    expect(isValid(JidSchema)('a@b c')).toBe(false);
  });

  it('rejects a JID longer than 3071 characters', () => {
    const tooLong = `${'a'.repeat(3071)}@b.com`;
    expect(tooLong.length).toBeGreaterThan(3071);
    expect(isValid(JidSchema)(tooLong)).toBe(false);
  });

  it('rejects an empty JID', () => {
    expect(isValid(JidSchema)('')).toBe(false);
  });
});

describe('IdSchema', () => {
  it('accepts a short id', () => {
    expect(isValid(IdSchema)('m-31')).toBe(true);
  });

  it('rejects an empty id', () => {
    expect(isValid(IdSchema)('')).toBe(false);
  });

  it('rejects an id longer than 128 characters', () => {
    expect(isValid(IdSchema)('a'.repeat(129))).toBe(false);
  });

  it('rejects an id containing a colon', () => {
    expect(isValid(IdSchema)('javascript:alert(1)')).toBe(false);
  });

  it('rejects an id containing whitespace', () => {
    expect(isValid(IdSchema)('has space')).toBe(false);
  });
});

describe('IsoDateTimeSchema', () => {
  it('accepts ISO datetimes with a timezone', () => {
    expect(isValid(IsoDateTimeSchema)('2026-09-27T10:00:00+02:00')).toBe(true);
    expect(isValid(IsoDateTimeSchema)('2026-09-27T08:00:00Z')).toBe(true);
  });

  it('rejects a date without a time', () => {
    expect(isValid(IsoDateTimeSchema)('2026-09-27')).toBe(false);
  });

  it('rejects a datetime without a timezone', () => {
    expect(isValid(IsoDateTimeSchema)('2026-09-27T10:00:00')).toBe(false);
  });
});

describe('CurrencySchema', () => {
  it('accepts EUR and USD', () => {
    expect(isValid(CurrencySchema)('EUR')).toBe(true);
    expect(isValid(CurrencySchema)('USD')).toBe(true);
  });

  it('rejects an unsupported currency', () => {
    expect(isValid(CurrencySchema)('GBP')).toBe(false);
  });

  it('rejects a lowercase currency', () => {
    expect(isValid(CurrencySchema)('eur')).toBe(false);
  });
});

describe('MoneySchema', () => {
  it('accepts a zero amount', () => {
    expect(isValid(MoneySchema)({ currency: 'EUR', amount: 0 })).toBe(true);
  });

  it('rejects a negative amount', () => {
    expect(isValid(MoneySchema)({ currency: 'EUR', amount: -0.01 })).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(isValid(MoneySchema)({ currency: 'EUR', amount: 1, extra: true })).toBe(false);
  });
});

describe('BudgetSchema', () => {
  it('accepts a positive max', () => {
    expect(isValid(BudgetSchema)({ currency: 'USD', max: 3 })).toBe(true);
  });

  it('rejects a zero max', () => {
    expect(isValid(BudgetSchema)({ currency: 'USD', max: 0 })).toBe(false);
  });

  it('rejects a missing currency', () => {
    expect(isValid(BudgetSchema)({ max: 3 })).toBe(false);
  });
});

describe('ArtifactRefSchema', () => {
  it('accepts an id ref', () => {
    expect(isValid(ArtifactRefSchema)({ kind: 'message', ref: 'm-31' })).toBe(true);
  });

  it('accepts a url ref', () => {
    expect(
      isValid(ArtifactRefSchema)({ kind: 'pr', ref: 'https://github.com/acme/shop/pull/42' }),
    ).toBe(true);
  });

  it('accepts an http url ref', () => {
    expect(isValid(ArtifactRefSchema)({ kind: 'preview', ref: 'http://localhost:3000' })).toBe(
      true,
    );
  });

  it.each([
    'javascript:alert(1)',
    'javascript:' + 'a'.repeat(200),
    'data:text/html,<h1>x</h1>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('rejects a %s ref', (ref) => {
    expect(isValid(ArtifactRefSchema)({ kind: 'pr', ref })).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(isValid(ArtifactRefSchema)({ kind: 'video', ref: 'm-1' })).toBe(false);
  });

  it('rejects an empty ref', () => {
    expect(isValid(ArtifactRefSchema)({ kind: 'message', ref: '' })).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(isValid(ArtifactRefSchema)({ kind: 'message', ref: 'm-1', extra: true })).toBe(false);
  });
});
