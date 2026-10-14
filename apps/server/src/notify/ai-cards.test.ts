// The one live-AI-UI rule (T-1400): an `<agent>` payload of type `progress` is
// the card, a correction or retraction that edits a card in the same batch is
// its edit, and anything else is a message.

import { describe, expect, it } from 'vitest';
import {
  cardEditTarget,
  decodeAgentPayload,
  isLiveAiUiEdit,
  isLiveAiUiRow,
  liveAiUiIds,
} from './ai-cards';

function progressXml(stage = 'Searching the web'): string {
  return `<message type="chat" from="ai@zilar.test/desk"><body>${stage}</body><agent xmlns="urn:zilar:agent:0">{"v":0,"type":"progress","data":{"ai":"ai@zilar.test","stage":"${stage}"}}</agent></message>`;
}

function correctionXml(target: string): string {
  return `<message type="chat" from="ai@zilar.test/desk"><body>Working</body><replace xmlns="urn:xmpp:message-correct:0" id="${target}"/></message>`;
}

function retractionXml(target: string): string {
  return `<message type="chat" from="ai@zilar.test/desk"><body>…</body><retract xmlns="urn:xmpp:message-retract:1" id="${target}"/></message>`;
}

describe('ai-cards', () => {
  it('decodes a progress row and reads it as the live AI UI', () => {
    const xml = progressXml();
    expect(decodeAgentPayload(xml)).toMatchObject({ type: 'progress' });
    expect(isLiveAiUiRow(xml)).toBe(true);
  });

  it('decodes an XML-escaped payload', () => {
    const xml = `<message><body>Searching</body><agent xmlns="urn:zilar:agent:0">{&quot;v&quot;:0,&quot;type&quot;:&quot;progress&quot;,&quot;data&quot;:{&quot;ai&quot;:&quot;ai@zilar.test&quot;,&quot;stage&quot;:&quot;Searching&quot;}}</agent></message>`;
    expect(decodeAgentPayload(xml)).toMatchObject({ type: 'progress' });
    expect(isLiveAiUiRow(xml)).toBe(true);
  });

  it('reads a normal message as not the live AI UI', () => {
    const xml = '<message type="chat" from="ana@zilar.test/phone"><body>hello</body></message>';
    expect(decodeAgentPayload(xml)).toBeNull();
    expect(isLiveAiUiRow(xml)).toBe(false);
  });

  it('reads a body-less reaction as not the live AI UI', () => {
    const xml =
      '<message type="chat" from="ana@zilar.test/phone"><reactions xmlns="urn:xmpp:reactions:0" id="m-1"><reaction>👍</reaction></reactions></message>';
    expect(isLiveAiUiRow(xml)).toBe(false);
  });

  it('takes a correction or retraction as a card edit when its target is a card', () => {
    const liveIds = liveAiUiIds([
      { originId: 'p-1', xml: progressXml() },
      { originId: 'm-1', xml: '<message><body>hi</body></message>' },
    ]);

    expect(liveIds).toEqual(new Set(['p-1']));
    expect(cardEditTarget(correctionXml('p-1'))).toBe('p-1');
    expect(isLiveAiUiEdit(correctionXml('p-1'), liveIds)).toBe(true);
    expect(isLiveAiUiEdit(retractionXml('p-1'), liveIds)).toBe(true);
    // An edit of a real message, or of a target outside the batch, is not.
    expect(isLiveAiUiEdit(correctionXml('m-1'), liveIds)).toBe(false);
    expect(isLiveAiUiEdit(correctionXml('other'), liveIds)).toBe(false);
    // A row that edits nothing is not an edit.
    expect(cardEditTarget(progressXml())).toBeNull();
    expect(isLiveAiUiEdit(progressXml(), liveIds)).toBe(false);
  });
});
