import { beforeEach, describe, expect, it } from 'vitest';

import { ProfileApiError } from '../lib/profile-api';

import {
  createMockProfileApi,
  mockAvatarUrlFor,
  profileMockScenario,
  resetProfileMock,
} from './profile';

describe('profileMockScenario', () => {
  it('returns null without mock env or param', () => {
    expect(profileMockScenario({}, {})).toBeNull();
    expect(profileMockScenario({ EXPO_PUBLIC_ZILAR_MOCK: '0' }, {})).toBeNull();
  });

  it('serves the default scenario for `1`', () => {
    expect(profileMockScenario({ EXPO_PUBLIC_ZILAR_MOCK: '1' }, {})).toBe('default');
  });

  it('narrows `1` to the error scenario', () => {
    expect(
      profileMockScenario(
        { EXPO_PUBLIC_ZILAR_MOCK: '1', EXPO_PUBLIC_ZILAR_MOCK_SCENARIO: 'error' },
        {},
      ),
    ).toBe('error');
  });

  it('honors the ?mock= param only when allowed', () => {
    expect(profileMockScenario({}, { mock: 'error' }, true)).toBe('error');
    expect(profileMockScenario({}, { mock: 'error' }, false)).toBeNull();
  });

  it('means the real API for unrecognized values', () => {
    expect(profileMockScenario({ EXPO_PUBLIC_ZILAR_MOCK: 'banana' }, {})).toBeNull();
  });
});

describe('createMockProfileApi', () => {
  beforeEach(() => {
    resetProfileMock();
  });

  it('serves the seeded profile (handle and avatar when set)', async () => {
    const api = createMockProfileApi();
    await expect(api.getMe()).resolves.toMatchObject({ id: 'user-1', name: 'Ada' });
    await api.claimHandle('newcomer');
    await expect(api.getMe()).resolves.toMatchObject({ handle: 'newcomer' });
    const blob = new Blob(['bytes'], { type: 'image/jpeg' });
    const { url } = await api.uploadAvatar('user-1', blob);
    await expect(api.getMe()).resolves.toMatchObject({ avatarUrl: url });
    await api.removeAvatar('user-1');
    await expect(api.getMe()).resolves.not.toHaveProperty('avatarUrl');
  });

  it('fails getMe in the error scenario', async () => {
    await expect(createMockProfileApi('error').getMe()).rejects.toMatchObject({
      code: 'internal_error',
    });
  });

  it('checks an available handle', async () => {
    await expect(createMockProfileApi().checkHandle('newcomer')).resolves.toEqual({
      available: true,
    });
  });

  it('classifies reserved and invalid handles like the server', async () => {
    await expect(createMockProfileApi().checkHandle('admin')).resolves.toEqual({
      available: false,
      reason: 'reserved',
    });
    await expect(createMockProfileApi().checkHandle('a')).resolves.toEqual({
      available: false,
      reason: 'invalid',
    });
    await expect(createMockProfileApi().checkHandle('ada')).resolves.toEqual({
      available: false,
      reason: 'taken',
    });
  });

  it('claims a handle and reports it taken afterwards', async () => {
    const api = createMockProfileApi();
    await expect(api.claimHandle('newcomer')).resolves.toEqual({ handle: 'newcomer' });
    await expect(api.checkHandle('newcomer')).resolves.toEqual({
      available: false,
      reason: 'taken',
    });
  });

  it('answers 409 handle_taken on a second claim', async () => {
    const api = createMockProfileApi();
    await api.claimHandle('newcomer');
    await expect(api.claimHandle('Newcomer')).rejects.toBeInstanceOf(ProfileApiError);
    await expect(api.claimHandle('Newcomer')).rejects.toMatchObject({
      status: 409,
      code: 'handle_taken',
    });
  });

  it('answers 409 handle_reserved and 400 handle_invalid on claim', async () => {
    const api = createMockProfileApi();
    await expect(api.claimHandle('admin')).rejects.toMatchObject({
      status: 409,
      code: 'handle_reserved',
    });
    await expect(api.claimHandle('a')).rejects.toMatchObject({
      status: 400,
      code: 'handle_invalid',
    });
  });

  it('uploads avatar bytes through fetch and serves its url until removed', async () => {
    const api = createMockProfileApi();
    const blob = new Blob(['bytes'], { type: 'image/jpeg' });
    const { url } = await api.uploadAvatar('user-1', blob);
    expect(url).toMatch(/^\/api\/avatars\//);
    expect(mockAvatarUrlFor('user-1')).toBe(url);
    await api.removeAvatar('user-1');
    expect(mockAvatarUrlFor('user-1')).toBeUndefined();
  });

  it('uploads a local file through the injected native uploader', async () => {
    const api = createMockProfileApi();
    const blob = new Blob(['bytes'], { type: 'image/jpeg' });
    const uploader = async () => ({ url: '/api/avatars/mock-native' });

    await expect(api.uploadAvatar('user-1', blob, uploader)).resolves.toEqual({
      url: '/api/avatars/mock-native',
    });
    expect(mockAvatarUrlFor('user-1')).toBe('/api/avatars/mock-native');
  });

  it('refuses an empty avatar like the server', async () => {
    const api = createMockProfileApi();
    await expect(
      api.uploadAvatar('user-1', new Blob([], { type: 'image/jpeg' })),
    ).rejects.toMatchObject({ status: 400, code: 'avatar_empty' });
  });

  it('fails every call in the error scenario', async () => {
    const api = createMockProfileApi('error');
    const blob = new Blob(['bytes'], { type: 'image/jpeg' });
    await expect(api.checkHandle('ada')).rejects.toMatchObject({ code: 'internal_error' });
    await expect(api.claimHandle('ada')).rejects.toMatchObject({ code: 'internal_error' });
    await expect(api.uploadAvatar('user-1', blob)).rejects.toMatchObject({
      code: 'internal_error',
    });
    await expect(api.removeAvatar('user-1')).rejects.toMatchObject({ code: 'internal_error' });
  });
});
