import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { AvatarControl, AvatarPicture } from './avatar-control';
import { HandleField } from './handle-field';
import type { AvatarPhase } from './profile-logic';

// The hook-free components render as plain elements with `react-native`
// stubbed (same pattern as `join-link.test.tsx`): Node only, no simulator,
// no new dependency.
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('expo-image', () => ({
  Image: 'Image',
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

const AVATAR_BASE = {
  ownerId: 'user-1',
  ownerName: 'Ada',
  busy: false,
  onPick: () => {},
  onSavePicked: () => {},
  onRemove: () => {},
};

function renderAvatar(phase: AvatarPhase, currentUrl?: string): string {
  return renderToStaticMarkup(createElement(AvatarControl, { ...AVATAR_BASE, phase, currentUrl }));
}

describe('AvatarControl phases', () => {
  it('invites a picture when idle without one', () => {
    const html = renderAvatar({ name: 'idle' });
    expect(html).toContain('Add picture');
    expect(html).toContain('Add a picture so friends recognize you.');
  });

  it('wraps the add-picture label in a Text element', () => {
    const html = renderAvatar({ name: 'idle' });
    expect(html).toContain('<Text>Add picture</Text>');
  });

  it('offers change and remove when a picture is set', () => {
    const html = renderAvatar({ name: 'idle' }, '/api/avatars/1');
    expect(html).toContain('Change picture');
    expect(html).toContain('Remove picture');
  });

  it('shows the picked preview with a save key', () => {
    const html = renderAvatar({ name: 'picked', uri: 'file:///a.jpg', mimeType: 'image/jpeg' });
    expect(html).toContain('Save picture');
    expect(html).toContain('ready');
  });

  it('shows the uploading progress', () => {
    const html = renderAvatar({
      name: 'uploading',
      uri: 'file:///a.jpg',
      mimeType: 'image/jpeg',
      progress: 0.5,
    });
    expect(html).toContain('Uploading… 50%');
  });

  it('shows the failure and the removal confirmation', () => {
    expect(renderAvatar({ name: 'failed', message: 'Too big' })).toContain('Too big');
    expect(renderAvatar({ name: 'removed' })).toContain('Picture removed.');
  });
});

const HANDLE_BASE = {
  value: 'ada',
  current: '',
  checking: false,
  busy: false,
  saveDisabled: false,
  saved: false,
  onChange: () => {},
  onSave: () => {},
};

describe('AvatarPicture fallback', () => {
  it('renders the resolved image with an error handler', () => {
    const onImageError = () => {};
    const element = AvatarPicture({
      source: { uri: 'http://127.0.0.1:3188/api/avatars/1' },
      ownerId: 'user-1',
      ownerName: 'Ada',
      imageFailed: false,
      onImageError,
    });

    expect(element.type).toBe('Image');
    expect(element.props.source).toMatchObject({
      uri: 'http://127.0.0.1:3188/api/avatars/1',
    });
    expect(element.props.onError).toBe(onImageError);
  });

  it('shows the initials after a load error', () => {
    const html = renderToStaticMarkup(
      createElement(AvatarPicture, {
        source: { uri: 'http://127.0.0.1:3188/api/avatars/1' },
        ownerId: 'user-1',
        ownerName: 'Ada Lovelace',
        imageFailed: true,
        onImageError: () => {},
      }),
    );

    // The initials avatar (no Image), with the owner's initials.
    expect(html).not.toContain('Image');
    expect(html).toContain('AL');
  });

  it('shows the initials without a picture', () => {
    const html = renderToStaticMarkup(
      createElement(AvatarPicture, {
        source: null,
        ownerId: 'user-1',
        ownerName: 'Ada',
        imageFailed: false,
        onImageError: () => {},
      }),
    );

    expect(html).not.toContain('Image');
  });
});

describe('HandleField states', () => {
  it('wraps the save label in a Text element', () => {
    const html = renderToStaticMarkup(
      createElement(HandleField, {
        ...HANDLE_BASE,
        availability: { state: 'idle' },
      }),
    );
    expect(html).toContain('<Text>Save username</Text>');
  });

  it('announces an available handle', () => {
    const html = renderToStaticMarkup(
      createElement(HandleField, {
        ...HANDLE_BASE,
        availability: { state: 'available', handle: 'ada' },
      }),
    );
    expect(html).toContain('@ada is available');
  });

  it('explains each unavailable reason', () => {
    for (const reason of ['invalid', 'reserved', 'taken', 'rate_limited'] as const) {
      const html = renderToStaticMarkup(
        createElement(HandleField, {
          ...HANDLE_BASE,
          availability: { state: 'unavailable', reason },
        }),
      );
      expect(html).toContain(
        reason === 'invalid'
          ? '3–32'
          : reason === 'reserved'
            ? 'reserved'
            : reason === 'rate_limited'
              ? 'Too many checks'
              : 'taken',
      );
    }
  });

  it('stays quiet while idle and shows the claim error and the saved note', () => {
    const idle = renderToStaticMarkup(
      createElement(HandleField, { ...HANDLE_BASE, availability: { state: 'idle' } }),
    );
    expect(idle).not.toContain('is available');
    const failed = renderToStaticMarkup(
      createElement(HandleField, {
        ...HANDLE_BASE,
        availability: { state: 'idle' },
        error: 'That username was just taken. Try another.',
      }),
    );
    expect(failed).toContain('just taken');
    const saved = renderToStaticMarkup(
      createElement(HandleField, { ...HANDLE_BASE, availability: { state: 'idle' }, saved: true }),
    );
    expect(saved).toContain('Saved.');
  });
});
