import { describe, expect, it, vi } from 'vitest';

import { createPinsApi, parsePin, type Pin } from './pins-api';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const ROW: Pin = {
  id: 'pin-1',
  chat: 'ana',
  messageId: 'ana-11',
  senderName: 'You',
  text: 'Booked for 21:00 ✅',
  kind: 'text',
  pinnedBy: 'me',
  pinnedAt: '2026-09-30T11:00:00Z',
};

describe('pins schema', () => {
  it('decodes an unknown kind to text', () => {
    expect(parsePin({ ...ROW, kind: 'sticker' })).toMatchObject({ kind: 'text' });
  });

  it('drops an unknown extra field', () => {
    expect(parsePin({ ...ROW, extra: 'ignored' })).toEqual(ROW);
  });
});

describe('pins api effect pipeline', () => {
  it('fails listPins with invalid_response when one row is malformed', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ pins: [ROW, { ...ROW, id: 7 }] }));
    const api = createPinsApi(
      async () => 'tok',
      fetchImpl as typeof fetch,
      'http://127.0.0.1:3188',
    );
    await expect(api.listPins('ana')).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
      message: 'The server sent an unexpected response',
    });
  });

  it('maps a network throw to network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const api = createPinsApi(
      async () => 'tok',
      fetchImpl as typeof fetch,
      'http://127.0.0.1:3188',
    );
    await expect(api.listPins('ana')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
      message: 'Could not reach the server',
    });
  });
});
