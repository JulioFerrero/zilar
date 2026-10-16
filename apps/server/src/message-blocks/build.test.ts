import { describe, expect, it } from 'vitest';
import { buildBlocksPayload } from './build';

// T-1751: the server turns unchecked blocks into a checked payload, or a short
// reason the model can read. The message pipeline depends on both paths.
describe('buildBlocksPayload', () => {
  it('builds a blocks payload from a figure and a callout', () => {
    const result = buildBlocksPayload(
      {
        title: 'BTC',
        blocks: [
          { kind: 'figure', rows: [{ label: 'BTC', value: '$82,302' }] },
          { kind: 'callout', tone: 'info', text: 'Up 2% today' },
        ],
      },
      'BTC $82,302',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.payload.type).toBe('blocks');
    if (result.payload.type !== 'blocks') {
      return;
    }
    expect(result.payload.data.fallback).toBe('BTC $82,302');
  });

  it('rejects a link that is not https', () => {
    const result = buildBlocksPayload(
      {
        blocks: [{ kind: 'link', url: 'http://example.com', title: 'Example' }],
      },
      'Example link',
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain('https');
  });
});
