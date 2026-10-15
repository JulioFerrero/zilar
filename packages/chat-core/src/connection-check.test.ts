import { describe, expect, it } from 'vitest';

import {
  abandonKeyCheck,
  checkKey,
  type KeyCheckApi,
  type KeyCheckInput,
} from './connection-check';

interface Recorder {
  api: KeyCheckApi;
  created: KeyCheckInput[];
  tested: string[];
  replaced: { id: string; key: string }[];
  deleted: string[];
}

function makeApi(tests: { ok: boolean; message?: string }[] = []): Recorder {
  const created: KeyCheckInput[] = [];
  const tested: string[] = [];
  const replaced: { id: string; key: string }[] = [];
  const deleted: string[] = [];
  let nextId = 0;

  const api: KeyCheckApi = {
    async createConnection(input) {
      created.push(input);
      nextId += 1;
      return { id: `c${nextId}` };
    },
    async testConnection(id) {
      tested.push(id);
      return tests.shift() ?? { ok: true };
    },
    async replaceConnectionKey(id, key) {
      replaced.push({ id, key });
      return { id };
    },
    async deleteConnection(id) {
      deleted.push(id);
    },
  };

  return { api, created, tested, replaced, deleted };
}

const EMPTY = { connectionId: null, created: false, verified: false };

describe('checkKey', () => {
  it('creates the connection and then tests it', async () => {
    const recorder = makeApi([{ ok: true }]);

    const result = await checkKey(recorder.api, EMPTY, { provider: 'openai', key: 'sk-secret' });

    expect(recorder.created).toEqual([{ provider: 'openai', key: 'sk-secret' }]);
    expect(recorder.tested).toEqual(['c1']);
    expect(recorder.replaced).toEqual([]);
    expect(result).toEqual({ connectionId: 'c1', created: true, verified: true });
  });

  it('replaces the key on a retry and never creates a second connection', async () => {
    const recorder = makeApi([
      { ok: false, message: 'The provider rejected the key' },
      { ok: true },
    ]);

    const first = await checkKey(recorder.api, EMPTY, { provider: 'deepseek', key: 'sk-bad' });
    expect(first.verified).toBe(false);
    expect(first.message).toBe(
      'DeepSeek did not accept this key. Check that you copied all of it.',
    );

    const second = await checkKey(recorder.api, first, { provider: 'deepseek', key: 'sk-good' });

    expect(recorder.created).toHaveLength(1);
    expect(recorder.replaced).toEqual([{ id: 'c1', key: 'sk-good' }]);
    expect(recorder.tested).toEqual(['c1', 'c1']);
    expect(second).toEqual({ connectionId: 'c1', created: true, verified: true });
  });
});

describe('abandonKeyCheck', () => {
  it('deletes an unverified connection this flow created', async () => {
    const recorder = makeApi([{ ok: false, message: 'The provider rejected the key' }]);
    const failed = await checkKey(recorder.api, EMPTY, { provider: 'openai', key: 'sk-bad' });

    await abandonKeyCheck(recorder.api, failed);

    expect(recorder.deleted).toEqual(['c1']);
  });

  it('leaves a verified connection alone', async () => {
    const recorder = makeApi([{ ok: true }]);
    const verified = await checkKey(recorder.api, EMPTY, { provider: 'openai', key: 'sk-good' });

    await abandonKeyCheck(recorder.api, verified);

    expect(recorder.deleted).toEqual([]);
  });

  it('leaves a connection this flow did not create alone', async () => {
    const recorder = makeApi();

    await abandonKeyCheck(recorder.api, {
      connectionId: 'preexisting',
      created: false,
      verified: false,
    });

    expect(recorder.deleted).toEqual([]);
  });
});
