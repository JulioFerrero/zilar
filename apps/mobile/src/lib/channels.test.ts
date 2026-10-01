import { describe, expect, it } from 'vitest';

import {
  channelAdminsOf,
  channelDescription,
  channelInfoSubtitle,
  channelSubscriberCount,
  channelSubscriberLabel,
  channelViewerRole,
  isChannelChat,
  mayManageChannel,
  mayPostInChannel,
} from './channels';

describe('channels helpers (T-0144)', () => {
  it('marks only chatKind channel rows as channels', () => {
    expect(isChannelChat({ chatKind: 'channel' })).toBe(true);
    expect(isChannelChat({ chatKind: 'group' })).toBe(false);
    expect(isChannelChat({})).toBe(false);
  });

  it('reads the viewer role from the row first, then the detail', () => {
    expect(channelViewerRole({ myRole: 'admin' }, undefined, 'me')).toBe('admin');
    expect(channelViewerRole({}, { members: [{ userId: 'me', role: 'member' }] }, 'me')).toBe(
      'member',
    );
    expect(channelViewerRole({}, undefined, 'me')).toBeUndefined();
    expect(channelViewerRole({}, { members: [] }, 'me')).toBeUndefined();
  });

  it('lets only owners and admins post; unknown reads as a subscriber', () => {
    expect(mayPostInChannel('owner')).toBe(true);
    expect(mayPostInChannel('admin')).toBe(true);
    expect(mayPostInChannel('member')).toBe(false);
    expect(mayPostInChannel(undefined)).toBe(false);
  });

  it('labels the subscriber count, singular for one', () => {
    expect(channelSubscriberLabel(1)).toBe('1 subscriber');
    expect(channelSubscriberLabel(4)).toBe('4 subscribers');
    expect(channelSubscriberLabel(0)).toBe('0 subscribers');
    expect(channelInfoSubtitle(6)).toBe('6 subscribers');
  });

  it('prefers subscriberCount, then memberCount, then the detail', () => {
    expect(channelSubscriberCount({ subscriberCount: 9, memberCount: 4 }, 2)).toBe(9);
    expect(channelSubscriberCount({ memberCount: 4 }, 2)).toBe(4);
    expect(channelSubscriberCount({}, 2)).toBe(2);
    expect(channelSubscriberCount({}, undefined)).toBe(0);
  });

  it('reads the blurb from the row first, then the detail', () => {
    expect(channelDescription({ description: 'Row' }, { description: 'Detail' })).toBe('Row');
    expect(channelDescription({ description: null }, { description: 'Detail' })).toBe('Detail');
    expect(channelDescription({}, { description: 'Detail' })).toBe('Detail');
    expect(channelDescription({}, undefined)).toBeNull();
    expect(channelDescription({}, {})).toBeNull();
  });

  it('slices only the posters (owner/admins), never the audience', () => {
    expect(
      channelAdminsOf([
        { userId: 'u-o', name: 'O', role: 'owner' },
        { userId: 'u-a', name: 'A', role: 'admin' },
        { userId: 'u-m', name: 'M', role: 'member' },
      ]),
    ).toEqual([
      { userId: 'u-o', name: 'O', role: 'owner' },
      { userId: 'u-a', name: 'A', role: 'admin' },
    ]);
  });

  it('lets only owners and admins manage a channel', () => {
    expect(mayManageChannel('owner')).toBe(true);
    expect(mayManageChannel('admin')).toBe(true);
    expect(mayManageChannel('member')).toBe(false);
    expect(mayManageChannel(undefined)).toBe(false);
  });
});
