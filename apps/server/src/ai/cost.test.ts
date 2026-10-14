import { beforeEach, describe, expect, it } from 'vitest';
import { costOf, priceKey, setModelPrices } from './cost';

function captureLogger(): {
  warn: (fields: Record<string, unknown>, message: string) => void;
  calls: Array<{ fields: Record<string, unknown>; message: string }>;
} {
  const calls: Array<{ fields: Record<string, unknown>; message: string }> = [];
  return {
    warn: (fields, message) => {
      calls.push({ fields, message });
    },
    calls,
  };
}

const usage = {
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 500,
  cacheWriteTokens: 100,
};

describe('costOf', () => {
  beforeEach(() => {
    setModelPrices(
      new Map([
        [
          priceKey('anthropic', 'claude-test'),
          {
            inputPerMTok: 3,
            outputPerMTok: 15,
            cacheReadPerMTok: 0.3,
            cacheWritePerMTok: 3.75,
          },
        ],
      ]),
    );
  });

  it('prices input, output and both cache counters per million tokens', () => {
    // 1000*3 + 200*15 + 500*0.3 + 100*3.75 = 6525 micro-USD.
    expect(costOf('anthropic', 'claude-test', usage)).toBeCloseTo(0.006525, 12);
  });

  it('falls back to the input price when a cache price is missing', () => {
    setModelPrices(
      new Map([
        [
          priceKey('openai', 'gpt-test'),
          {
            inputPerMTok: 2,
            outputPerMTok: 8,
            cacheReadPerMTok: null,
            cacheWritePerMTok: null,
          },
        ],
      ]),
    );

    // No uncached input or output; 1000 cache reads + 500 cache writes at the
    // input price (2) = 3000 micro-USD.
    expect(
      costOf('openai', 'gpt-test', {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1000,
        cacheWriteTokens: 500,
      }),
    ).toBeCloseTo(0.003, 12);
  });

  it('costs 0 and warns once for an unknown model', () => {
    const logger = captureLogger();

    expect(costOf('acme', 'ghost', usage, logger)).toBe(0);
    expect(costOf('acme', 'ghost', usage, logger)).toBe(0);

    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0]?.fields).toMatchObject({ provider: 'acme', model: 'ghost' });
  });
});
