import { describe, expect, it } from 'vitest';
import { buildBlocksPayload } from './build';

// T-1751: the server turns unchecked blocks into a checked payload, or a short
// reason the model can read. The message pipeline depends on both paths.
describe('buildBlocksPayload', () => {
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
