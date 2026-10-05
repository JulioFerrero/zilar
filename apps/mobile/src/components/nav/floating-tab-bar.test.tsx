import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { avatarFailedFor, FloatingTabBar, TabProfileFace } from './floating-tab-bar';

// Hook-free assertions over the rendered markup with the seams stubbed (the
// `new-group-sheet.test.tsx` pattern): Node only, no simulator.
vi.mock('react-native', () => ({
  Image: 'Image',
  Keyboard: { addListener: () => ({ remove: () => {} }) },
  Pressable: 'Pressable',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('expo-router/ui', () => ({
  TabTrigger: 'TabTrigger',
  useTabTrigger: ({ name }: { name: string }) => ({
    trigger: { isFocused: name === 'index' },
    triggerProps: {},
  }),
}));

vi.mock('lucide-react-native', () => ({
  Bot: 'Bot',
  MessagesSquare: 'MessagesSquare',
  Settings: 'Settings',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/settings/profile-logic', () => ({
  avatarImageSource: (url: string, apiUrl: string, token: string | undefined) => ({
    uri: url.startsWith('/') ? `https://api.example${url}` : url,
    ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
  }),
}));

vi.mock('@/lib/auth', () => ({
  API_URL: 'https://api.example',
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

function render(unreadTotal: number): string {
  return renderToStaticMarkup(
    createElement(FloatingTabBar, {
      unreadTotal,
      profile: { id: 'user-1', name: 'Ada Lovelace' },
    }),
  );
}

interface FaceElement {
  type: unknown;
  props: { [key: string]: unknown };
}

// The face is hook-free, so calling it directly yields the host element
// whose `source` prop carries the resolved uri.
function collectFace(node: unknown): FaceElement | null {
  if (node === null || node === undefined || typeof node !== 'object') {
    return null;
  }
  const element = node as { type?: unknown; props?: { [key: string]: unknown } };
  if (element.props === undefined) {
    return null;
  }
  if (typeof element.type === 'function') {
    const Component = element.type as (props: unknown) => unknown;
    return collectFace(Component(element.props));
  }
  return element as FaceElement;
}

describe('FloatingTabBar', () => {
  it('renders the four tabs with their labels', () => {
    const html = render(0);
    for (const label of ['Chats', 'AIs', 'Settings', 'Profile']) {
      expect(html).toContain(label);
    }
  });

  it('marks the selected tab and the others as tabs', () => {
    const html = render(0);
    // `accessibilityState={{ selected }}` reads through the static markup
    // as an object; the selected label paints bright while the others mute.
    expect(html).toContain('accessibilityRole="tab"');
    expect(html).toContain('color:#ededed">Chats');
    expect(html).toContain('color:#a1a1a1">AIs');
  });

  it('shows the unread total on the Chats tab and hides it at 0', () => {
    const html = render(7);
    expect(html).toContain('>7<');
    expect(html).toContain('unread chats');
    const empty = render(0);
    expect(empty).not.toContain('unread chats');
  });

  it('shows the profile initials', () => {
    expect(render(0)).toContain('AL');
  });

  it('resolves a relative avatar url against the API origin', () => {
    const node = createElement(TabProfileFace, {
      profile: { id: 'user-1', name: 'Ada Lovelace', avatarUrl: '/api/avatars/u1' },
      fallback: createElement('Text', null, 'AL'),
      imageFailed: false,
      onImageError: () => {},
    });
    const rendered = collectFace(node);
    expect(rendered?.props['accessibilityLabel']).toBe('Profile');
    const source = rendered?.props['source'] as { uri: string } | undefined;
    expect(source?.uri).toBe('https://api.example/api/avatars/u1');
    const bar = renderToStaticMarkup(
      createElement(FloatingTabBar, {
        unreadTotal: 0,
        profile: { id: 'user-1', name: 'Ada Lovelace', avatarUrl: '/api/avatars/u1' },
      }),
    );
    expect(bar).not.toContain('AL');
  });

  it('falls back to initials when the avatar image fails to load', () => {
    const failed = renderToStaticMarkup(
      createElement(TabProfileFace, {
        profile: {
          id: 'user-1',
          name: 'Ada Lovelace',
          avatarUrl: '/api/avatars/u1',
        },
        fallback: createElement('Text', null, 'AL'),
        imageFailed: true,
        onImageError: () => {},
      }),
    );
    expect(failed).toContain('AL');
    expect(failed).not.toContain('api/avatars');
  });

  it('clears the avatar fallback when the url changes after a failure', () => {
    // A 404 for a stale url must not stick on initials: once Set photo
    // saves and the profile carries the new url, the flag clears.
    expect(avatarFailedFor('/api/avatars/old', '/api/avatars/old')).toBe(true);
    expect(avatarFailedFor('/api/avatars/old', '/api/avatars/new')).toBe(false);
    expect(avatarFailedFor(undefined, '/api/avatars/new')).toBe(false);
  });
});
