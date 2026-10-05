import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { NewChatButton, CREATE_SHEETS_SCROLL_TAPS_PERSIST } from './new-chat-button';

// The mobile app has no React Native testing library, so the button is
// rendered to static markup with its seams stubbed (the `AuthFlow.test.tsx`
// pattern). `renderToStaticMarkup` never runs effects or taps, so the menu
// and the dialogs stay closed — the test only proves the entry renders.
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: () => {} }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('react-native', () => ({
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Share: { share: () => Promise.resolve({ action: 'dismissedAction' }) },
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('lucide-react-native', () => ({
  Plus: 'Plus',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/chat/join-link', () => ({
  JoinLinkForm: 'JoinLinkForm',
}));

vi.mock('@/components/chat/new-channel-sheet', () => ({
  NewChannelSheet: 'NewChannelSheet',
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({ createChannel: async () => 'g-1' }),
}));

vi.mock('@/lib/depth', () => ({
  ACCENT_FOREGROUND: '#0a0a0a',
  KEY_PRIMARY_PRESSED_SHADOW: {},
  pressStyle: () => ({}),
  primaryKey: {},
}));

describe('NewChatButton', () => {
  it('renders the New chat entry', () => {
    const html = renderToStaticMarkup(createElement(NewChatButton));
    expect(html).toContain('New chat');
  });

  it('no longer lists Add contact: people search lives in the search bar', () => {
    const html = renderToStaticMarkup(createElement(NewChatButton));
    expect(html).not.toContain('Add contact');
  });

  it('never renders a bearer token', () => {
    const html = renderToStaticMarkup(createElement(NewChatButton));
    expect(html).not.toMatch(/Bearer/i);
  });

  it('keeps first taps while the sheet keyboard is open', () => {
    expect(CREATE_SHEETS_SCROLL_TAPS_PERSIST).toBe('handled');
    const html = renderToStaticMarkup(createElement(NewChatButton));
    expect(html).toContain('keyboardShouldPersistTaps="handled"');
  });
});
