// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatScreen from '@/app/chat/[id]';

// Android layout rule (2026-10-03): with edge-to-edge (Expo SDK 57) Android no
// longer resizes the window for the keyboard, so `behavior` must be `padding`
// on every platform and in every layout of the chat screen, or the input sits
// under the keyboard. The screen is mounted for real in jsdom; every child is
// a stub.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

type Kids = { children?: ReactNode };

const h = vi.hoisted(() => ({
  behaviors: [] as Array<string | undefined>,
  state: {} as Record<string, unknown>,
  router: { back: () => {}, push: () => {}, replace: () => {} },
}));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'c1' }),
  useRouter: () => h.router,
}));

vi.mock('react-native', () => ({
  KeyboardAvoidingView: ({ children, behavior }: Kids & { behavior?: string }) => {
    h.behaviors.push(behavior);
    return createElement('div', null, children);
  },
  View: ({ children }: Kids) => createElement('div', null, children),
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: Kids) => createElement('div', null, children),
}));

vi.mock('@/auth/RequireAuth', () => ({ RequireAuth: ({ children }: Kids) => children }));

vi.mock('@/components/ui/text', () => ({
  Text: ({ children }: Kids) => createElement('span', null, children),
}));

function stub(name: string) {
  return () => createElement('div', { 'data-stub': name });
}

vi.mock('@/components/chat/chat-background', () => ({ ChatBackground: () => null }));
vi.mock('@/components/chat/channel-composer-bar', () => ({
  ChannelComposerBar: stub('ChannelComposerBar'),
}));
vi.mock('@/components/chat/chat-header', () => ({ ChatHeader: stub('ChatHeader') }));
vi.mock('@/components/chat/composer', () => ({ Composer: stub('Composer') }));
vi.mock('@/components/chat/forward-sheet', () => ({ ForwardSheet: stub('ForwardSheet') }));
vi.mock('@/components/chat/message-list', () => ({ MessageList: stub('MessageList') }));
vi.mock('@/components/chat/skeleton', () => ({ MessageListSkeleton: stub('Skeleton') }));
vi.mock('@/components/chat/media-sheet', () => ({ MediaSheet: stub('MediaSheet') }));
vi.mock('@/components/chat/pinned-banner', () => ({ PinnedBanner: stub('PinnedBanner') }));
vi.mock('@/components/chat/pins-sheet', () => ({ PinsSheet: stub('PinsSheet') }));
vi.mock('@/components/chat/selection-bar', () => ({ SelectionBar: stub('SelectionBar') }));
vi.mock('@/components/chat/task-strip', () => ({ TaskStrip: stub('TaskStrip') }));
vi.mock('@/components/chat/topic-sheets', () => ({ TopicInfoSheet: stub('TopicInfoSheet') }));
vi.mock('@/components/ais/ai-memory-sheet', () => ({ AiMemorySheet: stub('AiMemorySheet') }));
vi.mock('@/components/ais/use-ai-memory-api', () => ({ useAiMemoryApi: () => ({ api: {} }) }));
vi.mock('@/components/chat/voice-player', () => ({ useVoicePlayerHost: () => ({}) }));
vi.mock('@/components/chat/dismiss-banner', () => ({ DismissBanner: stub('DismissBanner') }));

vi.mock('@/lib/auth', () => ({ API_URL: 'https://api.test' }));
vi.mock('@/lib/session-token', () => ({ getSessionToken: () => null }));
vi.mock('@/lib/attachment-native', () => ({ createAttachmentOpener: () => ({}) }));
vi.mock('@/mock/stickers', () => ({ mockDemoStickerPacks: () => [] }));
vi.mock('@/mock/attachments', () => ({ mockDemoAttachments: () => undefined }));
vi.mock('@/mock/gifs', () => ({ mockDemoGifs: () => undefined }));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) => selector(h.state),
}));

const NO_PINS: unknown[] = [];
const MESSAGES = [{ id: 'm1' }];

function makeState(chat: unknown): Record<string, unknown> {
  const state: Record<string, unknown> = {
    chats: [chat],
    chatsLoad: 'loaded',
    canPin: () => true,
    pinFor: () => undefined,
    pins: () => NO_PINS,
    pinsError: undefined,
    messagesByChat: { c1: MESSAGES },
    actionError: undefined,
    currentUserId: 'me',
    topicRoles: () => undefined,
    groupDetail: () => undefined,
    groupRoles: () => undefined,
    me: { id: 'me', jid: 'me@x' },
    topicNotice: undefined,
    groupMembers: () => [],
    groupIdForChat: () => 'g1',
  };
  for (const name of ['openChat', 'ensureGroupDetail', 'stopPinsPoll', 'cancelEdit']) {
    state[name] = vi.fn();
  }
  return state;
}

const TOPIC = {
  id: 'c1',
  title: 'Launch',
  kind: 'group',
  groupId: 'g1',
  groupTitle: 'Team',
  topic: { status: 'open', owner: null, visibility: 'public', linkUrl: null, linkLabel: null },
};

const mounted: Array<() => void> = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  h.behaviors.length = 0;
});

afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()?.();
  }
});

function mount(chat: unknown): void {
  h.state = makeState(chat);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  act(() => root.render(createElement(ChatScreen)));
}

describe('chat screen keyboard avoidance', () => {
  it.each([
    ['a topic', TOPIC],
    ['a channel', { ...TOPIC, chatKind: 'channel' }],
    ['a chat without a topic', { id: 'c1', title: 'Ana', kind: 'dm' }],
  ])('pads the input above the keyboard on %s', (_name, chat) => {
    mount(chat);
    expect(h.behaviors.length).toBeGreaterThan(0);
    expect(new Set(h.behaviors)).toEqual(new Set(['padding']));
  });
});
