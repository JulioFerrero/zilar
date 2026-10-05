import { describe, expect, it, vi } from 'vitest';

import {
  buildChannelCreateInput,
  channelCreateGuard,
  createErrorText,
  publicCreateError,
} from './visibility-fields';
import { GroupsApiError } from '@/lib/groups-api';
import { visibilityReasonText } from './visibility-sheet';

// The channel sheet is a stateful component (hooks need a renderer, which
// the mobile repo does not have), so Node tests cover its guard and payload
// builders plus the fixed error lines: the sheet wires them unchanged.
// `react-native` and `react-native-safe-area-context` are stubbed so
// importing the real builders never parses the native/safe-area layers,
// and `visibilityReasonText` is read from the real sheet so the reason
// assertions below verify the shared helper, not a hand copy.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('channel create guards (T-0228)', () => {
  it('blocks an empty name with the web sentence', () => {
    expect(channelCreateGuard('   ', 'private', '', null)).toEqual({
      error: 'Enter a channel name',
    });
  });

  it('blocks Public without a handle with the guard sentence', () => {
    expect(channelCreateGuard('Releases', 'public', '   ', null)).toEqual({
      error: 'Choose a handle for the public channel.',
    });
    expect(publicCreateError('public', '', null, 'channel')).toBe(
      'Choose a handle for the public channel.',
    );
  });

  it('repeats the shared unavailable-check reason sentence', () => {
    expect(
      channelCreateGuard('Releases', 'public', 'taken', { available: false, reason: 'taken' }),
    ).toEqual({ error: visibilityReasonText('taken') });
  });

  it('builds the Public payload with the trimmed title, description and handle', () => {
    expect(
      buildChannelCreateInput('  Releases  ', '  Notes  ', 'public', '  hiking_club  ', {
        available: true,
      }),
    ).toEqual({
      input: {
        title: 'Releases',
        visibility: 'public',
        handle: 'hiking_club',
        description: 'Notes',
      },
    });
  });

  it('builds the Private payload with neither visibility nor handle', () => {
    expect(buildChannelCreateInput('Releases', '   ', 'private', '', null)).toEqual({
      input: { title: 'Releases' },
    });
  });
});

describe('createErrorText (T-0228)', () => {
  it('maps the handle codes to their sentences', () => {
    expect(createErrorText(new GroupsApiError(400, 'handle_invalid', 'bad'), 'channel')).toContain(
      '3–32 characters',
    );
    expect(createErrorText(new GroupsApiError(409, 'handle_reserved', 'x'), 'channel')).toBe(
      'That handle is reserved. Try another.',
    );
    expect(createErrorText(new GroupsApiError(409, 'handle_taken', 'x'), 'channel')).toBe(
      'That handle was just taken. Try another.',
    );
    expect(createErrorText(new GroupsApiError(429, 'rate_limited', 'x'), 'channel')).toBe(
      'Too many tries — wait a little and try again.',
    );
  });

  it('falls back to the channel sentence, never server text', () => {
    expect(createErrorText(new GroupsApiError(500, 'boom', 'raw server text'), 'channel')).toBe(
      'Could not create the channel. Try again.',
    );
    expect(createErrorText(new Error('raw server text'), 'channel')).toBe(
      'Could not create the channel. Try again.',
    );
  });
});
