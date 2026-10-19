// The one live-AI-UI rule (T-1400): an `<agent>` payload of type `progress` is
// the card, and anything else is a message.

import { describe, expect, it } from 'vitest';
import { decodeAgentPayload, isLiveAiUiRow } from './ai-cards';

const AI = 'ai-bot@zilar.test';

function progressXml(stage = 'Searching the web'): string {
  return `<message type="chat" from="${AI}/desk"><body>${stage}</body><agent xmlns="urn:zilar:agent:0">{"v":0,"type":"progress","data":{"ai":"${AI}","stage":"${stage}"}}</agent></message>`;
}

describe('ai-cards', () => {
  it('decodes a progress row and reads it as the live AI UI', () => {
    const xml = progressXml();
    expect(decodeAgentPayload(xml)).toMatchObject({ type: 'progress' });
    expect(isLiveAiUiRow(xml, '')).toBe(true);
  });
});
