import { describe, expect, it, vi } from 'vitest';

import { cacheDestinationFor, createGifDownloader } from './attachment-native';
import { cleanFilename } from './attachments';

vi.mock('expo-document-picker', () => ({
  getDocumentAsync: async () => ({ canceled: true }),
}));

vi.mock('expo-file-system/legacy', () => ({
  downloadAsync: async () => {
    throw new Error('no network in tests');
  },
  getInfoAsync: async () => ({ exists: false }),
  cacheDirectory: 'file:///cache/',
}));

vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ granted: false }),
  requestCameraPermissionsAsync: async () => ({ granted: false }),
}));

vi.mock('expo-file-system', () => ({
  File: class {},
  Paths: { cache: 'file:///cache' },
  UploadType: { BINARY_CONTENT: 0 },
}));

vi.mock('react-native', () => ({
  Share: { share: async () => {} },
}));

describe('attachment opener destination (T-0150 review)', () => {
  it('sanitizes a traversal name to its bare file name', () => {
    expect(cacheDestinationFor('../../x.pdf')).toBe('x.pdf');
    expect(cacheDestinationFor('/tmp/evil.pdf')).toBe('evil.pdf');
    expect(cacheDestinationFor('C:\\Users\\a\\notes.pdf')).toBe('notes.pdf');
  });

  it('keeps an ordinary name untouched', () => {
    expect(cacheDestinationFor('tickets.pdf')).toBe('tickets.pdf');
    expect(cacheDestinationFor('stage photo.png')).toBe('stage photo.png');
  });

  it('matches cleanFilename exactly', () => {
    for (const name of ['../../x.pdf', '', '  ', 'a/b\\c.txt']) {
      expect(cacheDestinationFor(name)).toBe(cleanFilename(name));
    }
  });
});

describe('gif downloader (T-0148)', () => {
  const API = 'http://127.0.0.1:3188';
  const gif = {
    id: 'gif-1',
    url: `${API}/api/gifs/media/tok-1`,
    kind: 'image' as const,
    width: 200,
    height: 150,
  };

  type DownloadFn = (
    url: string,
    dest: string,
    options?: { headers?: Record<string, string> },
  ) => Promise<{ uri: string; headers: Record<string, string>; status: number }>;

  function apiFor(download: DownloadFn, size = 100) {
    return createGifDownloader({
      apiUrl: API,
      getToken: async () => 'tok',
      download: download as never,
      getInfo: (async () => ({ exists: true, isDirectory: false, size })) as never,
      cacheDir: 'file:///cache/',
    });
  }

  it('refuses a non-proxy URL without any fetch', async () => {
    const download = vi.fn(async () => ({ uri: 'x', headers: {}, status: 200 }));
    const result = await apiFor(download as never).download({
      ...gif,
      url: 'https://media.giphy.com/x.gif',
    });
    expect(result.status).toBe('error');
    expect(download).not.toHaveBeenCalled();
  });

  it('sends the bearer to the API origin and names the file gif-<id>.<ext>', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> | undefined;
    const download = vi.fn(
      async (url: string, dest: string, options?: { headers?: Record<string, string> }) => {
        seenUrl = url;
        seenHeaders = options?.headers;
        return {
          uri: dest,
          headers: { 'Content-Type': 'video/mp4' },
          status: 200,
        };
      },
    );
    const result = await apiFor(download as never).download({ ...gif, kind: 'video' });
    expect(seenUrl).toBe(`${API}/api/gifs/media/tok-1`);
    expect(seenHeaders?.['authorization']).toBe('Bearer tok');
    expect(result).toMatchObject({
      status: 'downloaded',
      file: { name: 'gif-gif-1.mp4', mimeType: 'video/mp4', size: 100 },
    });
  });

  it('maps the real content type, never the result kind', async () => {
    const download = vi.fn(async (_url: string, dest: string) => ({
      uri: dest,
      headers: { 'content-type': 'image/webp' },
      status: 200,
    }));
    const result = await apiFor(download as never).download({ ...gif, kind: 'video' });
    expect(result).toMatchObject({
      status: 'downloaded',
      file: { name: 'gif-gif-1.webp', mimeType: 'image/webp' },
    });
  });

  it('fails on an unexpected content type, an empty file, or a failed fetch', async () => {
    const html = vi.fn(async (_url: string, dest: string) => ({
      uri: dest,
      headers: { 'content-type': 'text/html' },
      status: 200,
    }));
    await expect(apiFor(html as never).download(gif)).resolves.toMatchObject({ status: 'error' });
    const empty = vi.fn(async (_url: string, dest: string) => ({
      uri: dest,
      headers: { 'content-type': 'image/gif' },
      status: 200,
    }));
    await expect(apiFor(empty as never, 0).download(gif)).resolves.toMatchObject({
      status: 'error',
    });
    const failing = vi.fn(async () => {
      throw new Error('down');
    });
    await expect(apiFor(failing as never).download(gif)).resolves.toMatchObject({
      status: 'error',
    });
  });
});
