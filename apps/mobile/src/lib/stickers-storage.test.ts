import { describe, expect, it, vi } from 'vitest';

import {
  createMemoryRecentsBackend,
  readStoredRecents,
  RECENT_STICKERS_KEY,
  setRecentsBackend,
} from './stickers-storage';

vi.mock('react-native', () => ({
  Image: 'Image',
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
  ActivityIndicator: 'ActivityIndicator',
}));

vi.mock('@/lib/auth', () => ({
  API_URL: 'http://127.0.0.1:3188',
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

vi.mock('@/lib/stickers-api', () => ({
  createStickersApi: () => ({ listStickerPacks: async () => [] }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

import { persistRecent } from '../components/chat/sticker-panel';

const FILE = '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file';

describe('stickers storage', () => {
  it('exports the per-device key', () => {
    expect(RECENT_STICKERS_KEY).toBe('zilar:recentStickers');
  });

  it('reads an empty list from a fresh backend and hostile data', async () => {
    setRecentsBackend(createMemoryRecentsBackend());
    expect(await readStoredRecents()).toEqual([]);
    setRecentsBackend(createMemoryRecentsBackend('not json'));
    expect(await readStoredRecents()).toEqual([]);
  });

  it('persists recents per device and survives a failing write', async () => {
    const backend = createMemoryRecentsBackend();
    setRecentsBackend(backend);
    const next = await persistRecent({ read: backend.read, write: backend.write }, [], {
      id: 's1',
      packId: 'p1',
      url: FILE,
      emoji: '🐱',
      width: 200,
      height: 200,
      mime: 'image/png',
    });
    expect(next).toEqual([
      {
        stickerId: 's1',
        packId: 'p1',
        url: FILE,
        emoji: '🐱',
        width: 200,
        height: 200,
        mime: 'image/png',
      },
    ]);
    expect(await readStoredRecents()).toEqual(next);

    const failing = {
      read: async (): Promise<string | null> => null,
      write: async (): Promise<void> => {
        throw new Error('blocked');
      },
    };
    const kept = await persistRecent(failing, next, {
      stickerId: 's2',
      packId: 'p1',
      url: FILE,
      width: 200,
      height: 200,
      mime: 'image/png',
    });
    expect(kept.map((entry) => entry.stickerId)).toEqual(['s2', 's1']);
    setRecentsBackend(createMemoryRecentsBackend());
  });
});
