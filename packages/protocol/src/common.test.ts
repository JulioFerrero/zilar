import { describe, expect, it } from 'vitest';
import {
  ArtifactRefSchema,
  BudgetSchema,
  CurrencySchema,
  IdSchema,
  IsoDateTimeSchema,
  JidSchema,
  MoneySchema,
} from './index';

describe('JidSchema', () => {
  it('accepts a normal JID', () => {
    expect(JidSchema.safeParse('dev-1@ai.example.com').success).toBe(true);
  });

  it('rejects a JID without an @', () => {
    expect(JidSchema.safeParse('no-at').success).toBe(false);
  });

  it('rejects a JID with two @', () => {
    expect(JidSchema.safeParse('two@@signs').success).toBe(false);
  });

  it('rejects a JID with whitespace', () => {
    expect(JidSchema.safeParse('a@b c').success).toBe(false);
  });

  it('rejects a JID longer than 3071 characters', () => {
    const tooLong = `${'a'.repeat(3071)}@b.com`;
    expect(tooLong.length).toBeGreaterThan(3071);
    expect(JidSchema.safeParse(tooLong).success).toBe(false);
  });

  it('rejects an empty JID', () => {
    expect(JidSchema.safeParse('').success).toBe(false);
  });
});

describe('IdSchema', () => {
  it('accepts a short id', () => {
    expect(IdSchema.safeParse('m-31').success).toBe(true);
  });

  it('rejects an empty id', () => {
    expect(IdSchema.safeParse('').success).toBe(false);
  });

  it('rejects an id longer than 128 characters', () => {
    expect(IdSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });

  it('rejects an id containing a colon', () => {
    expect(IdSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });

  it('rejects an id containing whitespace', () => {
    expect(IdSchema.safeParse('has space').success).toBe(false);
  });
});

describe('IsoDateTimeSchema', () => {
  it('accepts ISO datetimes with a timezone', () => {
    expect(IsoDateTimeSchema.safeParse('2026-09-27T10:00:00+02:00').success).toBe(true);
    expect(IsoDateTimeSchema.safeParse('2026-09-27T08:00:00Z').success).toBe(true);
  });

  it('rejects a date without a time', () => {
    expect(IsoDateTimeSchema.safeParse('2026-09-27').success).toBe(false);
  });

  it('rejects a datetime without a timezone', () => {
    expect(IsoDateTimeSchema.safeParse('2026-09-27T10:00:00').success).toBe(false);
  });
});

describe('CurrencySchema', () => {
  it('accepts EUR and USD', () => {
    expect(CurrencySchema.safeParse('EUR').success).toBe(true);
    expect(CurrencySchema.safeParse('USD').success).toBe(true);
  });

  it('rejects an unsupported currency', () => {
    expect(CurrencySchema.safeParse('GBP').success).toBe(false);
  });

  it('rejects a lowercase currency', () => {
    expect(CurrencySchema.safeParse('eur').success).toBe(false);
  });
});

describe('MoneySchema', () => {
  it('accepts a zero amount', () => {
    expect(MoneySchema.safeParse({ currency: 'EUR', amount: 0 }).success).toBe(true);
  });

  it('rejects a negative amount', () => {
    expect(MoneySchema.safeParse({ currency: 'EUR', amount: -0.01 }).success).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(MoneySchema.safeParse({ currency: 'EUR', amount: 1, extra: true }).success).toBe(false);
  });
});

describe('BudgetSchema', () => {
  it('accepts a positive max', () => {
    expect(BudgetSchema.safeParse({ currency: 'USD', max: 3 }).success).toBe(true);
  });

  it('rejects a zero max', () => {
    expect(BudgetSchema.safeParse({ currency: 'USD', max: 0 }).success).toBe(false);
  });

  it('rejects a missing currency', () => {
    expect(BudgetSchema.safeParse({ max: 3 }).success).toBe(false);
  });
});

describe('ArtifactRefSchema', () => {
  it('accepts an id ref', () => {
    expect(ArtifactRefSchema.safeParse({ kind: 'message', ref: 'm-31' }).success).toBe(true);
  });

  it('accepts a url ref', () => {
    expect(
      ArtifactRefSchema.safeParse({ kind: 'pr', ref: 'https://github.com/acme/shop/pull/42' })
        .success,
    ).toBe(true);
  });

  it('accepts an http url ref', () => {
    expect(
      ArtifactRefSchema.safeParse({ kind: 'preview', ref: 'http://localhost:3000' }).success,
    ).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'javascript:' + 'a'.repeat(200),
    'data:text/html,<h1>x</h1>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('rejects a %s ref', (ref) => {
    expect(ArtifactRefSchema.safeParse({ kind: 'pr', ref }).success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(ArtifactRefSchema.safeParse({ kind: 'video', ref: 'm-1' }).success).toBe(false);
  });

  it('rejects an empty ref', () => {
    expect(ArtifactRefSchema.safeParse({ kind: 'message', ref: '' }).success).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(ArtifactRefSchema.safeParse({ kind: 'message', ref: 'm-1', extra: true }).success).toBe(
      false,
    );
  });
});
