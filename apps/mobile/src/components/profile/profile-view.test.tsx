import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProfileView, ProfileViewContent } from './profile-view';
import type { MyProfile } from '@/lib/profile-api';

// Hook-free assertions over the rendered markup with the seams stubbed (the
// `new-group-sheet.test.tsx` pattern): Node only, no simulator.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('@/lib/depth', () => ({
  KEY_PRIMARY_PRESSED_SHADOW: {},
  pressStyle: () => ({}),
  primaryKey: {},
}));

vi.mock('expo-image', () => ({
  Image: 'Image',
}));

vi.mock('lucide-react-native', () => ({
  Camera: 'Camera',
  Copy: 'Copy',
  Pencil: 'Pencil',
  Settings: 'Settings',
}));

vi.mock('@zilar/chat-core', () => ({
  initials: (name: string) =>
    name
      .split(' ')
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase(),
}));

vi.mock('@/components/settings/profile-logic', () => ({
  avatarImageSource: (url: string) => ({ uri: url }),
}));

const BASE: MyProfile = {
  id: 'user-1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  handle: 'ada',
};

function render(
  profile: MyProfile = BASE,
  handlers: Partial<{
    onSetPhoto: () => void;
    onEditInfo: () => void;
    onOpenSettings: () => void;
    onClaimUsername: () => void;
    onCopyUsername: (() => void) | undefined;
  }> = {},
): string {
  return renderToStaticMarkup(
    createElement(ProfileViewContent, {
      profile,
      imageFailed: false,
      onImageError: () => {},
      onSetPhoto: () => {},
      onEditInfo: () => {},
      onOpenSettings: () => {},
      onClaimUsername: () => {},
      ...handlers,
    }),
  );
}

interface TestElement {
  type: unknown;
  props: { children?: unknown; onPress?: () => void; [key: string]: unknown };
}

function collect(node: unknown, out: TestElement[] = []): TestElement[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      collect(child, out);
    }
    return out;
  }
  if (node === null || node === undefined || typeof node !== 'object') {
    return out;
  }
  const element = node as { type?: unknown; props?: { children?: unknown } };
  if (element.props === undefined) {
    return out;
  }
  if (typeof element.type === 'function') {
    const Component = element.type as (props: unknown) => unknown;
    return collect(Component(element.props), out);
  }
  out.push(element as TestElement);
  collect(element.props.children, out);
  return out;
}

function pressByLabel(node: unknown, label: string): void {
  const found = collect(node).find((element) => element.props['accessibilityLabel'] === label);
  expect(found?.props['onPress']).toBeTypeOf('function');
  found?.props['onPress']?.();
}

describe('ProfileView', () => {
  it('shows the avatar initials, name, presence, handle and email', () => {
    const html = render();
    expect(html).toContain('AL');
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('online');
    expect(html).toContain('@ada');
    expect(html).toContain('ada@example.com');
  });

  it('shows the claim row when the handle is null', () => {
    const html = render({ ...BASE, handle: null });
    expect(html).toContain('Claim a username');
    expect(html).not.toContain('@ada');
  });

  it('calls the three action handlers', () => {
    let photo = 0;
    let info = 0;
    let settings = 0;
    const node = createElement(ProfileViewContent, {
      profile: BASE,
      imageFailed: false,
      onImageError: () => {},
      onSetPhoto: () => {
        photo += 1;
      },
      onEditInfo: () => {
        info += 1;
      },
      onOpenSettings: () => {
        settings += 1;
      },
      onClaimUsername: () => {},
    });
    pressByLabel(node, 'Set photo');
    pressByLabel(node, 'Edit info');
    pressByLabel(node, 'Settings');
    expect(photo).toBe(1);
    expect(info).toBe(1);
    expect(settings).toBe(1);
  });

  it('renders the copy key only when a copy handler is given', () => {
    const without = collect(
      createElement(ProfileViewContent, {
        profile: BASE,
        imageFailed: false,
        onImageError: () => {},
        onSetPhoto: () => {},
        onEditInfo: () => {},
        onOpenSettings: () => {},
        onClaimUsername: () => {},
      }),
    ).some((element) => element.props['accessibilityLabel'] === 'Copy username');
    expect(without).toBe(false);
    const node = createElement(ProfileViewContent, {
      profile: BASE,
      imageFailed: false,
      onImageError: () => {},
      onSetPhoto: () => {},
      onEditInfo: () => {},
      onOpenSettings: () => {},
      onClaimUsername: () => {},
      onCopyUsername: () => {},
    });
    pressByLabel(node, 'Copy username');
  });

  it('stages the picked preview with Save and Discard, without uploading', () => {
    let saved = 0;
    let discarded = 0;
    const node = createElement(ProfileViewContent, {
      profile: BASE,
      imageFailed: false,
      onImageError: () => {},
      photoEdit: {
        stagedUri: 'file:///staged.png',
        busy: false,
        canRemove: true,
        onSave: () => {
          saved += 1;
        },
        onDiscard: () => {
          discarded += 1;
        },
        onRemove: () => {},
      },
      onSetPhoto: () => {},
      onEditInfo: () => {},
      onOpenSettings: () => {},
      onClaimUsername: () => {},
    });
    const html = renderToStaticMarkup(node);
    expect(html).toContain('new picture preview');
    pressByLabel(node, 'Save picture');
    pressByLabel(node, 'Discard picture');
    expect(saved).toBe(1);
    expect(discarded).toBe(1);
  });

  it('offers Remove picture only when there is a current picture', () => {
    const withPicture = collect(
      createElement(ProfileViewContent, {
        profile: { ...BASE, avatarUrl: '/api/avatars/u1' },
        imageFailed: false,
        onImageError: () => {},
        photoEdit: {
          busy: false,
          canRemove: true,
          onSave: () => {},
          onDiscard: () => {},
          onRemove: () => {},
        },
        onSetPhoto: () => {},
        onEditInfo: () => {},
        onOpenSettings: () => {},
        onClaimUsername: () => {},
      }),
    ).some((element) => element.props['accessibilityLabel'] === 'Remove picture');
    expect(withPicture).toBe(true);
    const without = collect(
      createElement(ProfileViewContent, {
        profile: BASE,
        imageFailed: false,
        onImageError: () => {},
        photoEdit: {
          busy: false,
          canRemove: false,
          onSave: () => {},
          onDiscard: () => {},
          onRemove: () => {},
        },
        onSetPhoto: () => {},
        onEditInfo: () => {},
        onOpenSettings: () => {},
        onClaimUsername: () => {},
      }),
    ).some((element) => element.props['accessibilityLabel'] === 'Remove picture');
    expect(without).toBe(false);
  });

  it('retries a changed avatar url after a load failure', () => {
    // The stateful wrapper derives the fallback from the failed url
    // (`failedUrl === profile.avatarUrl`), so a saved new url renders the
    // picture again instead of sticking on initials: a fresh wrapper with
    // the new url shows the picture, while the content with the failed
    // (stale) url still shows initials.
    const handlers = {
      onSetPhoto: () => {},
      onEditInfo: () => {},
      onOpenSettings: () => {},
      onClaimUsername: () => {},
    };
    const fresh = renderToStaticMarkup(
      createElement(ProfileView, {
        profile: { ...BASE, avatarUrl: '/api/avatars/u2' },
        ...handlers,
      }),
    );
    expect(fresh).toContain('<Image');
    expect(fresh).not.toContain('AL</Text>');
    const stale = renderToStaticMarkup(
      createElement(ProfileViewContent, {
        profile: { ...BASE, avatarUrl: '/api/avatars/u1' },
        imageFailed: true,
        onImageError: () => {},
        ...handlers,
      }),
    );
    expect(stale).toContain('AL');
    expect(stale).not.toContain('<Image');
  });
});
