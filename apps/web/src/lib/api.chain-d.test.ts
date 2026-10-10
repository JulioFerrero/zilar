// The chain D groups (T-0895) over the derived contract client: the exact
// request bodies of the calls with optional fields, so an `undefined` input is
// never sent as `null` (which would clear the field on the server).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/mock/gate', () => ({
  isMockApiEnabled: vi.fn(() => false),
}));

import {
  createStickerPack,
  patchStickerPack,
  saveEmailSettings,
  saveTelegramBotToken,
  updateMe,
} from '@/lib/api';
import { isMockApiEnabled } from '@/mock/gate';
import { jsonResponseAt as jsonResponse } from '@/test/wait';

const mockEnabled = vi.mocked(isMockApiEnabled);

const PACK = {
  id: 'p1',
  ownerId: 'u1',
  title: 'Cats',
  visibility: 'private',
  stickers: [],
  createdAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
};

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(status, body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof stubFetch>): unknown {
  return JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
}

beforeEach(() => {
  mockEnabled.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sticker pack bodies', () => {
  it('create sends only the keys it set, with the trimmed title', async () => {
    const fetchMock = stubFetch(PACK, 201);
    await createStickerPack({ title: '  Cats ' });
    expect(bodyOf(fetchMock)).toEqual({ title: 'Cats' });
  });

  it('patch sends only the keys it set', async () => {
    const fetchMock = stubFetch(PACK);
    await patchStickerPack('p1', { title: ' Dogs ' });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'PATCH' });
    expect(bodyOf(fetchMock)).toEqual({ title: 'Dogs' });
  });
});

describe('integrations and profile bodies', () => {
  it('email omits an unset key and trims the set ones', async () => {
    const fetchMock = stubFetch({ ok: true });
    await saveEmailSettings({ from: ' Zilar <a@b.example> ', resendApiKey: undefined });
    expect(bodyOf(fetchMock)).toEqual({ from: 'Zilar <a@b.example>' });
  });

  it('telegram and rename send the trimmed value', async () => {
    const telegram = stubFetch({ ok: true });
    await saveTelegramBotToken(' 123:ABC ');
    expect(bodyOf(telegram)).toEqual({ botToken: '123:ABC' });

    const rename = stubFetch({ id: 'u1', email: 'a@b.example', name: 'Ada' });
    await updateMe(' Ada ');
    expect(bodyOf(rename)).toEqual({ name: 'Ada' });
  });
});
