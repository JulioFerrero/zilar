import { describe, expect, it } from 'vitest';

import { ProfileApiError } from '../../lib/profile-api';
import {
  avatarImageSource,
  avatarPhaseLabel,
  friendlyAvatarError,
  friendlyClaimError,
  handleAvailabilityFor,
  handleAvailabilityText,
  isHandleRateLimited,
  reasonText,
  suggestHandleFor,
} from './profile-logic';

describe('handleAvailabilityFor', () => {
  it('maps an available check', () => {
    expect(handleAvailabilityFor('ada', { ok: true, available: true })).toEqual({
      state: 'available',
      handle: 'ada',
    });
  });

  it('maps each server reason', () => {
    expect(handleAvailabilityFor('a', { ok: true, available: false, reason: 'invalid' })).toEqual({
      state: 'unavailable',
      reason: 'invalid',
    });
    expect(
      handleAvailabilityFor('admin', { ok: true, available: false, reason: 'reserved' }),
    ).toEqual({ state: 'unavailable', reason: 'reserved' });
    expect(handleAvailabilityFor('ada', { ok: true, available: false })).toEqual({
      state: 'unavailable',
      reason: 'taken',
    });
  });

  it('maps a rate-limited check to the rate limit line', () => {
    expect(handleAvailabilityFor('ada', { ok: false, rateLimited: true })).toEqual({
      state: 'unavailable',
      reason: 'rate_limited',
    });
  });

  it('stays quiet on other check failures', () => {
    expect(handleAvailabilityFor('ada', { ok: false, rateLimited: false })).toEqual({
      state: 'idle',
    });
  });
});

describe('handleAvailabilityText', () => {
  it('announces an available handle', () => {
    expect(handleAvailabilityText({ state: 'available', handle: 'ada' })).toBe('@ada is available');
  });

  it('explains each unavailable reason', () => {
    expect(handleAvailabilityText({ state: 'unavailable', reason: 'invalid' })).toContain('3–32');
    expect(handleAvailabilityText({ state: 'unavailable', reason: 'reserved' })).toContain(
      'reserved',
    );
    expect(handleAvailabilityText({ state: 'unavailable', reason: 'taken' })).toContain('taken');
    expect(handleAvailabilityText({ state: 'unavailable', reason: 'rate_limited' })).toContain(
      'Too many checks',
    );
  });

  it('stays quiet while idle or checking', () => {
    expect(handleAvailabilityText({ state: 'idle' })).toBeNull();
    expect(handleAvailabilityText({ state: 'checking' })).toBeNull();
  });
});

describe('isHandleRateLimited', () => {
  it('detects the check rate limit only', () => {
    expect(isHandleRateLimited(new ProfileApiError(429, 'rate_limited', 'Slow down'))).toBe(true);
    expect(isHandleRateLimited(new ProfileApiError(409, 'handle_taken', 'Taken'))).toBe(false);
    expect(isHandleRateLimited(new Error('offline'))).toBe(false);
  });
});

describe('reasonText', () => {
  it('covers every reason', () => {
    expect(reasonText('invalid')).toContain('3–32');
    expect(reasonText('reserved')).toContain('reserved');
    expect(reasonText('taken')).toContain('taken');
    expect(reasonText('rate_limited')).toContain('Too many checks');
    expect(reasonText(undefined)).toContain('taken');
  });
});

describe('friendlyClaimError', () => {
  it('translates every claim code', () => {
    expect(
      friendlyClaimError(new ProfileApiError(400, 'handle_invalid', 'That username is not valid')),
    ).toContain('3–32');
    expect(
      friendlyClaimError(new ProfileApiError(409, 'handle_reserved', 'That username is reserved')),
    ).toContain('reserved');
    expect(
      friendlyClaimError(new ProfileApiError(409, 'handle_taken', 'That username is taken')),
    ).toContain('just taken');
    expect(
      friendlyClaimError(
        new ProfileApiError(
          409,
          'handle_change_too_soon',
          'You can change your username again',
          '2026-11-01T00:00:00.000Z',
        ),
      ),
    ).toContain('Next change possible on');
    expect(
      friendlyClaimError(
        new ProfileApiError(
          409,
          'handle_change_too_soon',
          'You can change your username again',
          '2026-11-01T00:00:00.000Z',
        ),
      ),
    ).toContain(new Date('2026-11-01T00:00:00.000Z').toLocaleDateString());
    expect(
      friendlyClaimError(
        new ProfileApiError(409, 'handle_change_too_soon', 'Next change possible on 10/10/2026'),
      ),
    ).toContain('10/10/2026');
    expect(
      friendlyClaimError(new ProfileApiError(429, 'rate_limited', 'Too many attempts')),
    ).toContain('Too many tries');
  });

  it('falls back to the server message, then to a generic one', () => {
    expect(friendlyClaimError(new ProfileApiError(500, 'boom', 'Server broke'))).toBe(
      'Server broke',
    );
    expect(friendlyClaimError(new Error('offline'))).toBe(
      'Could not save your username. Try again.',
    );
  });
});

describe('friendlyAvatarError', () => {
  it('translates every avatar code', () => {
    expect(friendlyAvatarError(new ProfileApiError(400, 'avatar_empty', 'empty'))).toContain(
      'empty',
    );
    expect(friendlyAvatarError(new ProfileApiError(413, 'avatar_too_large', 'big'))).toContain(
      '256 KiB',
    );
    expect(friendlyAvatarError(new ProfileApiError(400, 'avatar_animated', 'moving'))).toContain(
      'still image',
    );
    expect(friendlyAvatarError(new ProfileApiError(400, 'avatar_not_square', 'wide'))).toContain(
      'square',
    );
    expect(friendlyAvatarError(new ProfileApiError(400, 'avatar_bad_size', 'tiny'))).toContain(
      '64 and 512',
    );
    expect(friendlyAvatarError(new ProfileApiError(400, 'avatar_not_image', 'text'))).toContain(
      'not a picture we can use',
    );
    expect(friendlyAvatarError(new ProfileApiError(400, 'avatar_not_image', 'text'))).not.toContain(
      'JPEG',
    );
    expect(friendlyAvatarError(new ProfileApiError(429, 'rate_limited', 'slow'))).toContain(
      'Too many uploads',
    );
    expect(friendlyAvatarError(new ProfileApiError(0, 'network_error', 'offline'))).toContain(
      'Could not reach the server',
    );
  });

  it('falls back to a generic message', () => {
    expect(friendlyAvatarError(new Error('offline'))).toBe(
      'Could not save the picture. Try again.',
    );
  });
});

describe('suggestHandleFor', () => {
  it('shapes a display name into a handle', () => {
    expect(suggestHandleFor('Ada Lovelace')).toBe('ada_lovelace');
  });

  it('falls back to the email local part', () => {
    expect(suggestHandleFor('!!!', 'grace.hopper@example.com')).toBe('grace_hopper');
  });

  it('falls back to `user` when nothing shapes', () => {
    expect(suggestHandleFor('!!!')).toBe('user');
  });

  it('rejects reserved words', () => {
    expect(suggestHandleFor('admin')).toBe('user');
  });

  it('pads short names and prefixes digit starts', () => {
    expect(suggestHandleFor('Al')).toBe('al0');
    expect(suggestHandleFor('3po')).toBe('u_3po');
  });
});

describe('avatarImageSource', () => {
  const API = 'http://127.0.0.1:3188';

  it('resolves a relative server path against the API origin with the bearer', () => {
    expect(avatarImageSource('/api/avatars/abc', API, 'token-1')).toEqual({
      uri: 'http://127.0.0.1:3188/api/avatars/abc',
      headers: { authorization: 'Bearer token-1' },
    });
  });

  it('sends no headers without a token', () => {
    expect(avatarImageSource('/api/avatars/abc', API, undefined)).toEqual({
      uri: 'http://127.0.0.1:3188/api/avatars/abc',
    });
  });

  it('passes a picked file uri unchanged with no headers', () => {
    expect(avatarImageSource('file:///cache/photo.jpg', API, 'token-1')).toEqual({
      uri: 'file:///cache/photo.jpg',
    });
  });

  it('keeps a same-origin absolute url with the bearer', () => {
    expect(avatarImageSource('http://127.0.0.1:3188/api/avatars/abc', API, 'token-1')).toEqual({
      uri: 'http://127.0.0.1:3188/api/avatars/abc',
      headers: { authorization: 'Bearer token-1' },
    });
  });

  it('never sends the bearer to another origin', () => {
    expect(avatarImageSource('https://evil.test/avatar.png', API, 'token-1')).toEqual({
      uri: 'https://evil.test/avatar.png',
    });
  });
});

describe('avatarPhaseLabel', () => {
  it('labels every phase of the avatar flow', () => {
    expect(avatarPhaseLabel({ name: 'idle' }, false)).toContain('Add a picture');
    expect(avatarPhaseLabel({ name: 'idle' }, true)).toContain('Change or remove');
    expect(
      avatarPhaseLabel({ name: 'picked', uri: 'file:///a.jpg', mimeType: 'image/jpeg' }, false),
    ).toContain('ready');
    expect(
      avatarPhaseLabel(
        { name: 'uploading', uri: 'file:///a.jpg', mimeType: 'image/jpeg', progress: 0.5 },
        false,
      ),
    ).toBe('Uploading… 50%');
    expect(avatarPhaseLabel({ name: 'failed', message: 'Too big' }, false)).toBe('Too big');
    expect(avatarPhaseLabel({ name: 'removed' }, false)).toBe('Picture removed.');
  });
});
