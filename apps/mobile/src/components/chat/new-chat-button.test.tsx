import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  NewChatButton,
  CREATE_SHEETS_SCROLL_TAPS_PERSIST,
  createSheetBottomPadding,
} from './new-chat-button';

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
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
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
  TextClassContext: { Provider: 'TextClassContextProvider' },
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

vi.mock('@/lib/use-keyboard-height', () => ({
  useKeyboardHeight: () => 0,
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

describe('createSheetBottomPadding', () => {
  it('pads the sheet by the keyboard height on Android', () => {
    expect(createSheetBottomPadding('android', 0)).toBe(16);
    expect(createSheetBottomPadding('android', 320)).toBe(336);
  });

  it('leaves the iOS padding to KeyboardAvoidingView', () => {
    expect(createSheetBottomPadding('ios', 320)).toBeUndefined();
  });
});
