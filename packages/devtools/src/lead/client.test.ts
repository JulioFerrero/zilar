import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeOpenCodeClient, readDataPayload } from './client';

describe('readDataPayload', () => {
  it('returns the data property of the opencode2 envelope', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lead-client-')), 'api.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ data: [{ id: 'msg_1', type: 'idle' }], cursor: 'abc' }),
    );
    expect(readDataPayload(file)).toEqual([{ id: 'msg_1', type: 'idle' }]);
  });

  it('rejects a response without a data envelope', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lead-client-')), 'api.json');
    fs.writeFileSync(file, JSON.stringify({ error: 'nope' }));
    expect(() => readDataPayload(file)).toThrow(/no data envelope/);
  });
});

describe('FakeOpenCodeClient', () => {
  it('records replies and removes answered permissions', async () => {
    const client = new FakeOpenCodeClient();
    client.addSession('ses_1', {
      messages: [],
      permissions: [{ id: 'per_1', action: 'shell', resources: 'git push' }],
    });
    await client.replyPermission('ses_1', 'per_1', 'reject', 'no pushing');
    expect(client.replied).toEqual([
      { sessionId: 'ses_1', requestId: 'per_1', decision: 'reject', message: 'no pushing' },
    ]);
    expect(await client.listPermissions('ses_1')).toEqual([]);
  });
});
