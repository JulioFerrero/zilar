import { describe, expect, it, vi } from 'vitest';

import * as ImagePicker from 'expo-image-picker';

import {
  AVATAR_EXPORT_SIDE,
  AVATAR_UPLOAD_MAX_BYTES,
  centeredSquareCrop,
  createAvatarFileUploader,
  createAvatarTranscoder,
  createPicturePicker,
  parseAvatarUploadBody,
  stagedAvatarName,
  type AvatarTranscoder,
} from './avatar-native';

const mockedImagePicker = vi.mocked(ImagePicker, true);

vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: false })),
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: true })),
}));

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(async () => {
    throw new Error('no native modules in tests');
  }),
  SaveFormat: { PNG: 'png', JPEG: 'jpeg', WEBP: 'webp' },
}));

const uploadedBy = vi.fn(
  async (_url: string, _options?: unknown): Promise<{ status: number; body: string }> => ({
    status: 200,
    body: JSON.stringify({ url: '/api/avatars/1' }),
  }),
);

vi.mock('expo-file-system', () => ({
  File: class {
    upload(...args: [url: string, options?: unknown]) {
      return uploadedBy(...args);
    }
  },
  Paths: { cache: 'file:///cache' },
  UploadType: { BINARY_CONTENT: 0 },
}));

vi.mock('expo-file-system/legacy', () => ({
  getInfoAsync: vi.fn(async () => ({ exists: false })),
}));

describe('stagedAvatarName', () => {
  it('names the staged copy from its mime type', () => {
    expect(stagedAvatarName('image/png')).toBe('avatar-staged.png');
    expect(stagedAvatarName('image/webp')).toBe('avatar-staged.webp');
    expect(stagedAvatarName('image/jpeg')).toBe('avatar-staged.jpg');
  });
});

describe('parseAvatarUploadBody', () => {
  it('parses the server url', () => {
    expect(parseAvatarUploadBody(JSON.stringify({ url: '/api/avatars/1' }))).toEqual({
      url: '/api/avatars/1',
    });
  });

  it('rejects junk bodies', () => {
    expect(parseAvatarUploadBody('not json')).toBeNull();
    expect(parseAvatarUploadBody(JSON.stringify({ nope: true }))).toBeNull();
    expect(parseAvatarUploadBody(JSON.stringify({ url: 42 }))).toBeNull();
  });
});

describe('centeredSquareCrop', () => {
  it('centers the square on the source', () => {
    expect(centeredSquareCrop(800, 600)).toEqual({
      originX: 100,
      originY: 0,
      width: 600,
      height: 600,
    });
    expect(centeredSquareCrop(600, 800)).toEqual({
      originX: 0,
      originY: 100,
      width: 600,
      height: 600,
    });
    expect(centeredSquareCrop(400, 400)).toEqual({
      originX: 0,
      originY: 0,
      width: 400,
      height: 400,
    });
  });

  it('returns null for unusable dimensions', () => {
    expect(centeredSquareCrop(0, 400)).toBeNull();
    expect(centeredSquareCrop(400, NaN)).toBeNull();
  });
});

describe('createAvatarTranscoder', () => {
  it('crops to a centred square and resizes to a PNG', async () => {
    const manipulate = vi.fn(async () => ({ uri: 'file:///cache/avatar.png' }));
    const transcoder = createAvatarTranscoder(manipulate as never);

    await expect(transcoder.transcode('file:///cache/photo.jpg', 800, 600)).resolves.toEqual({
      uri: 'file:///cache/avatar.png',
    });

    expect(manipulate).toHaveBeenCalledWith(
      'file:///cache/photo.jpg',
      [
        { crop: { originX: 100, originY: 0, width: 600, height: 600 } },
        { resize: { width: AVATAR_EXPORT_SIDE, height: AVATAR_EXPORT_SIDE } },
      ],
      expect.objectContaining({ format: 'png' }),
    );
  });
});

describe('createPicturePicker', () => {
  const asset = {
    uri: 'file:///cache/photo.jpg',
    width: 800,
    height: 600,
    fileSize: 100_000,
    mimeType: 'image/jpeg',
  };

  function pickerFor(size: number | undefined, transcode?: AvatarTranscoder) {
    return createPicturePicker({
      sizeReader: { sizeOf: async () => size },
      transcoder: transcode ?? { transcode: async () => ({ uri: 'file:///cache/avatar.png' }) },
    });
  }

  function grantLibraryOnce() {
    mockedImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({
      granted: true,
    } as never);
  }

  it('refuses when the permission is denied', async () => {
    mockedImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({
      granted: false,
    } as never);

    const result = await pickerFor(undefined).pickPicture();

    expect(result).toMatchObject({ status: 'error' });
  });

  it('asks for a square editable pick, then re-encodes the JPEG to a PNG', async () => {
    const launch = vi.mocked(ImagePicker.launchImageLibraryAsync);
    grantLibraryOnce();
    launch.mockResolvedValueOnce({ canceled: false, assets: [asset] } as never);
    const transcode = vi.fn(async () => ({ uri: 'file:///cache/avatar.png' }));

    const result = await pickerFor(50_000, { transcode }).pickPicture();

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ allowsEditing: true, aspect: [1, 1] }),
    );
    // The JPEG asset goes through the manipulator with its dimensions; the
    // upload bytes are the transcoded PNG, not the picked file.
    expect(transcode).toHaveBeenCalledWith('file:///cache/photo.jpg', 800, 600);
    expect(result).toEqual({
      status: 'picked',
      picture: {
        uri: 'file:///cache/avatar.png',
        mimeType: 'image/png',
        width: AVATAR_EXPORT_SIDE,
        height: AVATAR_EXPORT_SIDE,
      },
    });
  });

  it('maps a cancelled pick to cancelled', async () => {
    grantLibraryOnce();
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: true,
    } as never);

    await expect(pickerFor(undefined).pickPicture()).resolves.toEqual({ status: 'cancelled' });
  });

  it('refuses an empty transcoded file and an over-cap one', async () => {
    mockedImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    const launch = vi.mocked(ImagePicker.launchImageLibraryAsync);
    launch.mockResolvedValue({
      canceled: false,
      assets: [asset],
    } as never);

    await expect(pickerFor(0).pickPicture()).resolves.toMatchObject({ status: 'error' });
    await expect(pickerFor(AVATAR_UPLOAD_MAX_BYTES + 1).pickPicture()).resolves.toMatchObject({
      status: 'error',
    });
  });

  it('shows the prepare message and does not pick when the manipulator fails', async () => {
    grantLibraryOnce();
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [asset],
    } as never);
    const transcode = vi.fn(async () => {
      throw new Error('manipulator broke');
    });

    const result = await pickerFor(50_000, { transcode }).pickPicture();

    expect(result).toEqual({
      status: 'error',
      message: 'Could not prepare that picture. Try another photo.',
    });
  });

  it('fails gracefully when the picker throws', async () => {
    grantLibraryOnce();
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockRejectedValueOnce(new Error('denied'));

    await expect(pickerFor(undefined).pickPicture()).resolves.toMatchObject({ status: 'error' });
  });
});

describe('createAvatarFileUploader', () => {
  it('PUTs the transcoded PNG with its content type and parses the url', async () => {
    uploadedBy.mockClear();
    const uploader = createAvatarFileUploader();

    await expect(
      uploader.upload(
        'http://127.0.0.1:3188/api/avatars/user/user-1',
        { uri: 'file:///cache/avatar.png', mimeType: 'image/png', width: 256, height: 256 },
        'token-1',
      ),
    ).resolves.toEqual({ url: '/api/avatars/1' });

    expect(uploadedBy).toHaveBeenCalledWith(
      'http://127.0.0.1:3188/api/avatars/user/user-1',
      expect.objectContaining({
        httpMethod: 'PUT',
        headers: expect.objectContaining({
          'content-type': 'image/png',
          authorization: 'Bearer token-1',
        }),
      }),
    );
  });
});
