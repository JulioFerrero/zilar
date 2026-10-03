import { describe, expect, it, vi } from 'vitest';

import * as ImagePicker from 'expo-image-picker';

import {
  AVATAR_UPLOAD_MAX_BYTES,
  createAvatarFileUploader,
  createPicturePicker,
  parseAvatarUploadBody,
  stagedAvatarName,
} from './avatar-native';

const mockedImagePicker = vi.mocked(ImagePicker, true);

vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: false })),
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: true })),
}));

vi.mock('expo-file-system', () => ({
  File: class {},
  Paths: { cache: 'file:///cache' },
  UploadType: { BINARY_CONTENT: 0 },
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

describe('createPicturePicker', () => {
  const asset = {
    uri: 'file:///cache/photo.jpg',
    width: 800,
    height: 800,
    fileSize: 100_000,
    mimeType: 'image/jpeg',
  };

  it('refuses when the permission is denied', async () => {
    mockedImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({
      granted: false,
    } as never);

    const result = await createPicturePicker().pickPicture();

    expect(result).toMatchObject({ status: 'error' });
  });

  it('asks for a square editable pick and returns the asset', async () => {
    const launch = vi.mocked(ImagePicker.launchImageLibraryAsync);
    mockedImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({
      granted: true,
    } as never);
    launch.mockResolvedValueOnce({ canceled: false, assets: [asset] } as never);

    const result = await createPicturePicker().pickPicture();

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ allowsEditing: true, aspect: [1, 1] }),
    );
    expect(result).toEqual({
      status: 'picked',
      picture: {
        uri: 'file:///cache/photo.jpg',
        mimeType: 'image/jpeg',
        width: 800,
        height: 800,
      },
    });
  });

  it('maps a cancelled pick to cancelled', async () => {
    mockedImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({
      granted: true,
    } as never);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: true,
    } as never);

    await expect(createPicturePicker().pickPicture()).resolves.toEqual({ status: 'cancelled' });
  });

  it('refuses an empty file and an over-cap file', async () => {
    mockedImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    const launch = vi.mocked(ImagePicker.launchImageLibraryAsync);
    launch.mockResolvedValueOnce({
      canceled: false,
      assets: [{ ...asset, fileSize: 0 }],
    } as never);
    await expect(createPicturePicker().pickPicture()).resolves.toMatchObject({ status: 'error' });

    launch.mockResolvedValueOnce({
      canceled: false,
      assets: [{ ...asset, fileSize: AVATAR_UPLOAD_MAX_BYTES + 1 }],
    } as never);
    await expect(createPicturePicker().pickPicture()).resolves.toMatchObject({ status: 'error' });
  });

  it('fails gracefully when the picker throws', async () => {
    mockedImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({
      granted: true,
    } as never);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockRejectedValueOnce(new Error('denied'));

    await expect(createPicturePicker().pickPicture()).resolves.toMatchObject({ status: 'error' });
  });
});

describe('createAvatarFileUploader', () => {
  it('is constructible without touching native modules', () => {
    expect(createAvatarFileUploader().upload).toBeTypeOf('function');
  });
});
