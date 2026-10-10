import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { TopicInfoSheet } from './topic-sheets';
import type { ChatSummary } from '@/lib/types';

// Every tapped `Pressable` registers its label and handler here, so the test
// can press the memory button the sheet renders, like a tap would.
const presses = vi.hoisted(() => ({ handlers: new Map<string, () => void>() }));

interface CollectorPressableProps {
  accessibilityLabel?: string;
  onPress?: () => void;
  children?: ReactNode;
  [key: string]: unknown;
}

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  return {
    ActivityIndicator: 'ActivityIndicator',
    Modal: 'Modal',
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
    Pressable: (props: CollectorPressableProps) => {
      const { accessibilityLabel, onPress, children, ...rest } = props;
      if (typeof accessibilityLabel === 'string' && typeof onPress === 'function') {
        presses.handlers.set(accessibilityLabel, onPress);
      }
      return h('Pressable', { accessibilityLabel, ...rest }, children);
    },
    View: 'View',
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('lucide-react-native', () => ({
  Brain: 'Brain',
  Check: 'Check',
  Lock: 'Lock',
  CircleAlert: 'CircleAlert',
  Inbox: 'Inbox',
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

// The info sheet renders through the kit `BottomSheet` (T-0315); stub it
// as a host tag so the rows render under `renderToStaticMarkup`. The real
// shell is covered by `bottom-sheet.test.tsx`.
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: 'BottomSheet',
}));

vi.mock('@/lib/colors', () => ({
  DANGER: { dark: '#ef4444', light: '#ef4444' },
  FOREGROUND: '#fafafa',
  MUTED_FOREGROUND: '#8a8a8a',
}));

function chat(): ChatSummary {
  return {
    id: 't-hiring',
    title: 'Hiring: frontend role',
    kind: 'group',
    isAI: false,
    space: 'work',
    unread: 0,
    muted: false,
    memberCount: 2,
    groupId: 'g-devteam',
    groupTitle: 'Dev team',
    topic: {
      id: 't-devteam-hiring',
      glyph: 'H',
      kind: 'task',
      status: 'blocked',
      visibility: 'public',
      isGeneral: false,
      archived: false,
      owner: null,
      linkUrl: null,
      linkLabel: null,
    },
  };
}

const AIS = [
  { id: 'a-1', name: 'Dev-1' },
  { id: 'a-2', name: 'Helper-2' },
];

function sheet(overrides: Record<string, unknown> = {}): string {
  presses.handlers.clear();
  return renderToStaticMarkup(
    createElement(TopicInfoSheet, {
      chat: chat(),
      groupTitle: 'Dev team',
      members: [],
      ais: AIS,
      aiCount: AIS.length,
      canArchive: false,
      isMember: true,
      busy: false,
      error: '',
      onLeave: () => {},
      onArchive: () => {},
      onClose: () => {},
      roles: [],
      rolesError: '',
      rolesLoading: false,
      groupRolesError: '',
      approverRole: null,
      groupRoles: [],
      canManageRoles: false,
      onToggleTopicRole: () => {},
      onPickApprover: () => {},
      onRetryRoles: () => {},
      onRetryGroupRoles: () => {},
      ...overrides,
    }),
  );
}

describe('TopicInfoSheet AI memory buttons (T-0451)', () => {
  it('shows a memory button per AI and pressing it opens that AI', () => {
    const opened: { id: string; name: string }[] = [];
    const html = sheet({ onOpenAiMemory: (ai: { id: string; name: string }) => opened.push(ai) });

    expect(html).toContain('What Dev-1 remembers');
    expect(html).toContain('What Helper-2 remembers');

    presses.handlers.get('What Dev-1 remembers')?.();
    expect(opened).toEqual([{ id: 'a-1', name: 'Dev-1' }]);

    presses.handlers.get('What Helper-2 remembers')?.();
    expect(opened).toEqual([
      { id: 'a-1', name: 'Dev-1' },
      { id: 'a-2', name: 'Helper-2' },
    ]);
  });

  it('shows no memory button without onOpenAiMemory', () => {
    const html = sheet();

    expect(html).toContain('Dev-1');
    expect(html).not.toContain('remembers');
  });
});
