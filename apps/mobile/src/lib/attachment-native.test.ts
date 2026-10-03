import { describe, expect, it, vi } from 'vitest';

import * as ImagePicker from 'expo-image-picker';

import {
  cacheDestinationFor,
  createAttachmentOpener,
  createAttachmentPicker,
  createGifDownloader,
  createSizeReader,
} from './attachment-native';
import { cleanFilename } from './attachments';

const mockedImagePicker = vi.mocked(ImagePicker, true);

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
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: false })),
  requestCameraPermissionsAsync: vi.fn(async () => ({ granted: false })),
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: true })),
  launchCameraAsync: vi.fn(async () => ({ canceled: true })),
}));

vi.mock('expo-file-system', () => ({
  File: class {},
  Paths: { cache: 'file:///cache' },
  UploadType: { BINARY_CONTENT: 0 },
}));

vi.mock('react-native', () => ({
  Share: { share: async () => {} },
}));

describe('attachment picker unknown size (T-0157 item 1)', () => {
  const URI = 'file:///cache/stage.png';

  function pickerFor(getInfo: (uri: string) => Promise<unknown>) {
    const reader = createSizeReader(getInfo as never);
    return createAttachmentPicker(reader);
  }

  function libraryOk(fileSize: number | undefined) {
    mockedImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({
      granted: true,
    } as never);
    mockedImagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: URI,
          fileName: 'stage.png',
          mimeType: 'image/png',
          ...(fileSize === undefined ? {} : { fileSize }),
          width: 640,
          height: 420,
          type: 'image',
        },
      ],
    } as never);
  }

  it('reads the real size from the file when the picker reports none', async () => {
    libraryOk(undefined);
    const picker = pickerFor(async () => ({ exists: true, isDirectory: false, size: 240_000 }));
    const result = await picker.pickImageOrVideo();
    expect(result).toMatchObject({
      status: 'picked',
      file: { name: 'stage.png', mimeType: 'image/png', size: 240_000 },
    });
  });

  it('says "empty" only for a real zero, not for an unknown size', async () => {
    libraryOk(undefined);
    const picker = pickerFor(async () => ({ exists: true, isDirectory: false, size: 0 }));
    await expect(picker.pickImageOrVideo()).resolves.toMatchObject({
      status: 'error',
      message: 'That file is empty.',
    });
  });

  it('refuses an over-cap file found only by the stat', async () => {
    libraryOk(undefined);
    const picker = pickerFor(async () => ({
      exists: true,
      isDirectory: false,
      size: 60 * 1024 * 1024,
    }));
    await expect(picker.pickImageOrVideo()).resolves.toMatchObject({
      status: 'error',
      message: 'That file is larger than 50 MB.',
    });
  });

  it('treats an unreadable stat as unknown, not as empty', async () => {
    libraryOk(undefined);
    const picker = pickerFor(async () => {
      throw new Error('no stat');
    });
    const result = await picker.pickImageOrVideo();
    expect(result.status).toBe('picked');
    if (result.status === 'picked') {
      expect(result.file.size).toBe(0);
    }
  });

  it('keeps a reported zero as empty without a stat', async () => {
    libraryOk(0);
    const getInfo = vi.fn(async () => ({ exists: true, isDirectory: false, size: 999 }));
    const picker = pickerFor(getInfo as never);
    await expect(picker.pickImageOrVideo()).resolves.toMatchObject({
      status: 'error',
      message: 'That file is empty.',
    });
    expect(getInfo).not.toHaveBeenCalled();
  });
});

describe('attachment opener size cap (T-0157 item 2)', () => {
  const URL = 'https://upload.zilar.test/get/big.bin';

  function openerFor(
    download: (
      url: string,
      dest: unknown,
      options?: { onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void },
    ) => Promise<{ uri: string }>,
  ) {
    return createAttachmentOpener({
      apiUrl: 'http://127.0.0.1:3188',
      getToken: async () => undefined,
      download: download as never,
    });
  }

  it('refuses a file whose announced length exceeds the cap', async () => {
    // The progress callback fires with the announced total first: the
    // opener aborts before any share, reporting the plain over-cap line.
    let seenSignal: AbortSignal | undefined;
    const download = vi.fn(
      async (
        _url: string,
        _dest: unknown,
        options?: {
          signal?: AbortSignal;
          onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void;
        },
      ) => {
        seenSignal = options?.signal;
        options?.onProgress?.({ bytesWritten: 0, totalBytes: 60 * 1024 * 1024 });
        if (seenSignal?.aborted === true) {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          throw error;
        }
        return { uri: 'file:///cache/big.bin' };
      },
    );
    await expect(openerFor(download).open(URL, 'big.bin')).resolves.toMatchObject({
      status: 'error',
      message: 'That file is larger than 50 MB.',
    });
    expect(seenSignal?.aborted).toBe(true);
  });

  it('aborts mid-download once the written bytes pass the cap', async () => {
    let seenSignal: AbortSignal | undefined;
    const download = vi.fn(
      async (
        _url: string,
        _dest: unknown,
        options?: {
          signal?: AbortSignal;
          onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void;
        },
      ) => {
        seenSignal = options?.signal;
        options?.onProgress?.({ bytesWritten: 51 * 1024 * 1024, totalBytes: -1 });
        if (seenSignal?.aborted === true) {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          throw error;
        }
        return { uri: 'file:///cache/big.bin' };
      },
    );
    await expect(openerFor(download).open(URL, 'big.bin')).resolves.toMatchObject({
      status: 'error',
      message: 'That file is larger than 50 MB.',
    });
    expect(seenSignal?.aborted).toBe(true);
  });

  it('opens a file under the cap', async () => {
    const download = vi.fn(async () => ({ uri: 'file:///cache/small.bin' }));
    const opener = openerFor(download);
    await expect(opener.open(URL, 'small.bin')).resolves.toMatchObject({ status: 'opened' });
  });
});

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
