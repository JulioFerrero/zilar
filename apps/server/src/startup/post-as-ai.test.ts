// T-1765: the production post port must forward the card payload, not just
// the text; a dropped payload is the live bug this test pins.
import type { Payload } from '@zilar/protocol';
import { describe, expect, it, vi } from 'vitest';
import { postAsAi } from './components';

const blocksPayload: Payload = {
  v: 0,
  type: 'blocks',
  data: {
    fallback: 'BTC $81684.05',
    blocks: [{ kind: 'figure', rows: [{ label: 'BTC', value: '$81684.05' }] }],
  },
};

describe('postAsAi (T-1765)', () => {
  it('forwards the payload unchanged and returns the gateway answer', async () => {
    const postToChat = vi.fn(async () => true);
    const post = postAsAi(() => ({ postToChat }));

    const posted = await post({
      aiId: 'ai-1',
      groupId: 'group-1',
      topicId: 'topic-1',
      text: 'market-prices BTC $81684.05',
      payload: blocksPayload,
    });

    expect(posted).toBe(true);
    expect(postToChat).toHaveBeenCalledWith({
      aiId: 'ai-1',
      groupId: 'group-1',
      topicId: 'topic-1',
      text: 'market-prices BTC $81684.05',
      payload: blocksPayload,
    });
  });

  it('omits topicId and payload when they are not set', async () => {
    const postToChat = vi.fn(async () => false);
    const post = postAsAi(() => ({ postToChat }));

    const posted = await post({ aiId: 'ai-1', groupId: null, text: 'hello' });

    expect(posted).toBe(false);
    expect(postToChat).toHaveBeenCalledWith({ aiId: 'ai-1', groupId: null, text: 'hello' });
  });

  it('returns false and posts nothing while there is no gateway', async () => {
    const post = postAsAi(() => null);

    expect(await post({ aiId: 'ai-1', groupId: null, text: 'hello' })).toBe(false);
  });
});
