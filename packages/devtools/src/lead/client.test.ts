import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeOpenCodeClient, OpencodeCliClient, readDataPayload } from './client';

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

  it('switchModel posts the model to the session id', async () => {
    const client = new FakeOpenCodeClient();
    client.addSession('ses_1', { messages: [], permissions: [] });
    await client.switchModel('ses_1', { providerID: 'meta', id: 'muse-spark-1.3-contributor' });
    expect(client.switched).toEqual([
      {
        sessionId: 'ses_1',
        model: { providerID: 'meta', id: 'muse-spark-1.3-contributor' },
      },
    ]);
  });

  it('switchModel throws for an unknown session', async () => {
    const client = new FakeOpenCodeClient();
    await expect(
      client.switchModel('ses_missing', { providerID: 'meta', id: 'muse-spark-1.3-contributor' }),
    ).rejects.toThrow(/unknown fake session/);
  });
});

describe('OpencodeCliClient', () => {
  // A stand-in `opencode2` that prints `output` and exits with `code`.
  // Mimics how the real CLI responds for `session.interrupt` (no envelope)
  // and how it might respond to other exit codes.
  function fakeBinary(output: string, code = '0'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-bin-'));
    const bin = path.join(dir, 'opencode2');
    fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s' '${output}'\nexit ${code}\n`, { mode: 0o755 });
    return bin;
  }

  it('interrupts a session whose reply has no data envelope', async () => {
    const client = new OpencodeCliClient(fakeBinary('{"interrupted":false}'));
    await expect(client.interrupt('ses_1')).resolves.toBeUndefined();
  });

  it('still rejects a missing envelope where data is needed', async () => {
    const client = new OpencodeCliClient(fakeBinary('{"interrupted":false}'));
    await expect(client.listMessages('ses_1', 2)).rejects.toThrow('no data envelope');
  });

  it('tryInterrupt returns ok for a 0 exit', async () => {
    const client = new OpencodeCliClient(fakeBinary('{"interrupted":true}'));
    await expect(client.tryInterrupt('ses_1')).resolves.toEqual({ kind: 'ok' });
  });

  it('tryInterrupt returns already_idle for {"interrupted":false}', async () => {
    const client = new OpencodeCliClient(fakeBinary('{"interrupted":false}'));
    await expect(client.tryInterrupt('ses_1')).resolves.toEqual({ kind: 'already_idle' });
  });

  it('tryInterrupt returns not_found for an exit-404 with "not found" stderr', async () => {
    const client = new OpencodeCliClient(fakeBinary('{"error":"session not found"}', '404'));
    await expect(client.tryInterrupt('ses_1')).resolves.toEqual({ kind: 'not_found' });
  });

  it('tryInterrupt returns error for an unexpected non-zero exit', async () => {
    // sh's `exit N` returns `N mod 256`, so pick a value below that to land
    // exactly where we want. 500 maps to 244 on the kernel side.
    const client = new OpencodeCliClient(fakeBinary('{"error":"upstream timeout"}', '42'));
    const outcome = await client.tryInterrupt('ses_1');
    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') {
      expect(outcome.message).toContain('42');
      expect(outcome.message).toContain('upstream timeout');
    }
  });

  it('interrupt re-throws an error outcome so old call sites still see the failure', async () => {
    const client = new OpencodeCliClient(fakeBinary('{"error":"upstream timeout"}', '42'));
    await expect(client.interrupt('ses_1')).rejects.toThrow(/42/);
  });

  it('switchModel calls api session.switchModel with the session id and model', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-bin-'));
    const bin = path.join(dir, 'opencode2');
    const capture = path.join(dir, 'args.txt');
    fs.writeFileSync(bin, `#!/bin/sh\necho "$@" > ${capture}\nprintf '{}'\nexit 0\n`, {
      mode: 0o755,
    });
    const client = new OpencodeCliClient(bin);
    await client.switchModel('ses_9', {
      providerID: 'meta',
      id: 'muse-spark-1.3-contributor',
      variant: 'low',
    });
    const args = fs.readFileSync(capture, 'utf8').trim();
    expect(args).toBe(
      'api session.switchModel --param sessionID=ses_9 -d {"model":{"providerID":"meta","id":"muse-spark-1.3-contributor","variant":"low"}}',
    );
  });
});

describe('FakeOpenCodeClient.tryInterrupt', () => {
  it('records an ok outcome for known sessions', async () => {
    const client = new FakeOpenCodeClient();
    client.addSession('ses_1', { messages: [], permissions: [] });
    await expect(client.tryInterrupt('ses_1')).resolves.toEqual({ kind: 'ok' });
    expect(client.interrupted).toEqual(['ses_1']);
    expect(client.interruptOutcomes).toEqual([{ sessionId: 'ses_1', outcome: { kind: 'ok' } }]);
  });

  it('returns not_found for unknown sessions without recording an interrupt', async () => {
    const client = new FakeOpenCodeClient();
    await expect(client.tryInterrupt('ses_missing')).resolves.toEqual({ kind: 'not_found' });
    expect(client.interrupted).toEqual([]);
    expect(client.interruptOutcomes).toEqual([
      { sessionId: 'ses_missing', outcome: { kind: 'not_found' } },
    ]);
  });

  it('returns scripted outcomes in queue order', async () => {
    const client = new FakeOpenCodeClient();
    client.addSession('ses_1', { messages: [], permissions: [] });
    client.scriptInterrupt('ses_1', { kind: 'already_idle' });
    client.scriptInterrupt('ses_1', {
      kind: 'error',
      message: 'boom',
    });
    await expect(client.tryInterrupt('ses_1')).resolves.toEqual({ kind: 'already_idle' });
    await expect(client.tryInterrupt('ses_1')).resolves.toEqual({
      kind: 'error',
      message: 'boom',
    });
    // The error outcome must not have pushed to `interrupted`.
    expect(client.interrupted).toEqual([]);
  });
});

describe('FakeOpenCodeClient.interrupt (strict)', () => {
  // `interrupt` mirrors OpencodeCliClient.interrupt exactly: it throws on
  // any non-ok outcome so old call sites (lead reply, autopilot) fail
  // fast when a session is gone.
  it('throws on a scripted error outcome', async () => {
    const client = new FakeOpenCodeClient();
    client.addSession('ses_1', { messages: [], permissions: [] });
    client.scriptInterrupt('ses_1', { kind: 'error', message: 'upstream timeout' });
    await expect(client.interrupt('ses_1')).rejects.toThrow(/upstream timeout/);
  });

  it('throws on a scripted already_idle outcome (real strict method would too)', async () => {
    const client = new FakeOpenCodeClient();
    client.addSession('ses_1', { messages: [], permissions: [] });
    client.scriptInterrupt('ses_1', { kind: 'already_idle' });
    await expect(client.interrupt('ses_1')).rejects.toThrow(/already_idle/);
  });

  it('throws on a not_found outcome for an unknown session id', async () => {
    const client = new FakeOpenCodeClient();
    await expect(client.interrupt('ses_missing')).rejects.toThrow(/not_found/);
  });

  it('resolves only on an ok outcome', async () => {
    const client = new FakeOpenCodeClient();
    client.addSession('ses_1', { messages: [], permissions: [] });
    await expect(client.interrupt('ses_1')).resolves.toBeUndefined();
    expect(client.interrupted).toEqual(['ses_1']);
  });
});
