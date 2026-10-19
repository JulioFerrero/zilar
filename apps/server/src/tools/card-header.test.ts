import { describe, expect, it } from 'vitest';
import { describeToolCard } from './card-header';

// T-1768: after a saved tool's test run the AI is told whether its card would
// post, so a broken card is not a silent fallback to plain text.
describe('describeToolCard', () => {
  it('reports the board prices card as ok', () => {
    const line = describeToolCard(
      {
        text: 'Prices',
        card: { title: 'Prices', icon: 'chart', meta: '22:34 UTC' },
        blocks: [
          {
            kind: 'figure',
            rows: [{ label: 'BTC', value: '$82,302', change: { direction: 'up', text: '2.1%' } }],
          },
        ],
      },
      'market-prices',
    );

    expect(line).toBe('card ok: 1 blocks (figure)');
  });
});
