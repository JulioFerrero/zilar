import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AiMemoryApi } from '@/lib/ai-memory-api';

import { AiMemorySheet } from './ai-memory-sheet';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Keyboard: { addListener: vi.fn(() => ({ remove: vi.fn() })) },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'light' }),
}));

vi.mock('lucide-react-native', () => ({
  Brain: 'Brain',
  CircleAlert: 'CircleAlert',
  Inbox: 'Inbox',
  Trash2: 'Trash2',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/button', () => ({
  Button: 'Button',
}));

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: 'ConfirmDialog',
}));

vi.mock('@/lib/color-scheme', () => ({
  asColorScheme: () => 'light',
}));

vi.mock('@/lib/colors', () => ({
  DANGER: { dark: '#ef4444', light: '#ef4444' },
  FOREGROUND: { dark: '#fafafa', light: '#fafafa' },
  MUTED_FOREGROUND: { dark: '#8a8a8a', light: '#8a8a8a' },
}));

function stubApi(): AiMemoryApi {
  return {
    getMemory: async () => ({ facts: [], lines: [], canChange: true }),
    forgetFact: async () => undefined,
    clear: async () => undefined,
  };
}

describe('AiMemorySheet', () => {
  it('titles the sheet and mounts the memory already open', () => {
    const html = renderToStaticMarkup(
      createElement(AiMemorySheet, {
        api: stubApi(),
        chat: 'room-1@zilar.test',
        ai: { id: 'a-1', name: 'Dev-1' },
        onClose: () => {},
      }),
    );

    expect(html).toContain('What Dev-1 remembers');
    expect(html).toContain('Close memory');
    // initiallyOpen: the section loads at once, with no Show/Hide toggle.
    expect(html).toContain('Loading the memory…');
    expect(html).not.toContain('Show memory');
    expect(html).not.toContain('Hide memory');
  });

  it('renders no title and no section when ai is null', () => {
    const html = renderToStaticMarkup(
      createElement(AiMemorySheet, {
        api: stubApi(),
        chat: 'room-1@zilar.test',
        ai: null,
        onClose: () => {},
      }),
    );

    expect(html).not.toContain('remembers');
    expect(html).not.toContain('Loading the memory…');
  });
});
