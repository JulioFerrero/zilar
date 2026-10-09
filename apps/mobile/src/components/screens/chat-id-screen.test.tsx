// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatScreen from '@/app/chat/[id]';
import { ROLE_GONE_MESSAGE, ROLE_SAVE_FAILED_MESSAGE } from '@/lib/roles';

// The chat screen (`app/chat/[id].tsx`) is mounted for real in jsdom; every
// child component is a stub that records its latest props, so a test fires a
// child's callback (`onPin`, `onUnpin`, `onLeave`, ...) the way a tap would
// and reads what the screen passes back down. The store is a plain object of
// `vi.fn`s read through the selector.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const h = await vi.hoisted(async () => {
  const { createElement: element } = await import('react');
  const props = new Map<string, Record<string, unknown>>();
  return {
    props,
    stub: (name: string) => (stubProps: Record<string, unknown>) => {
      props.set(name, stubProps);
      return element('div', { 'data-stub': name });
    },
    state: {} as Record<string, unknown>,
    params: {} as Record<string, string>,
    router: {
      back: () => {},
      push: () => {},
      replace: () => {},
    } as Record<string, (...args: unknown[]) => void>,
    opener: { open: (() => {}) as (...args: unknown[]) => unknown },
  };
});

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => h.params,
  useRouter: () => h.router,
}));

vi.mock('react-native', () => ({
  KeyboardAvoidingView: ({ children }: { children?: ReactNode }) =>
    createElement('div', null, children),
  View: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock('@/components/ui/text', () => ({
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
}));

function stub(name: string) {
  return h.stub(name);
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

vi.mock('@/components/chat/dismiss-banner', () => ({
  DismissBanner: ({
    tone,
    message,
    onDismiss,
  }: {
    tone: string;
    message: string;
    onDismiss: () => void;
  }) => createElement('button', { 'data-banner': tone, onClick: onDismiss }, message),
}));

vi.mock('@/lib/auth', () => ({ API_URL: 'https://api.test' }));
vi.mock('@/lib/session-token', () => ({ getSessionToken: () => null }));
vi.mock('@/lib/attachment-native', () => ({ createAttachmentOpener: () => h.opener }));
vi.mock('@/mock/stickers', () => ({ mockDemoStickerPacks: () => [] }));
vi.mock('@/mock/attachments', () => ({ mockDemoAttachments: () => undefined }));
vi.mock('@/mock/gifs', () => ({ mockDemoGifs: () => undefined }));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) => selector(h.state),
}));

type Fn = (...args: unknown[]) => unknown;

const prop = (name: string, key: string): Fn => {
  const value = h.props.get(name)?.[key];
  if (typeof value !== 'function') {
    throw new Error(`${name}.${key} is not a function`);
  }
  return value as Fn;
};

const plain = (name: string, key: string): unknown => h.props.get(name)?.[key];

const NO_PINS: unknown[] = [];
const MESSAGES = [{ id: 'm1' }, { id: 'm2' }];

const topicChat = (extra: Record<string, unknown> = {}) => ({
  id: 'c1',
  title: 'Launch',
  kind: 'group',
  groupId: 'g1',
  groupTitle: 'Team',
  topic: { status: 'open', owner: null, visibility: 'public', linkUrl: null, linkLabel: null },
  ...extra,
});

const makeState = (chat: unknown): Record<string, unknown> => {
  const fns = [
    'openChat',
    'sendText',
    'sendAttachment',
    'retryAttachment',
    'cancelAttachment',
    'sendVoice',
    'retryVoice',
    'cancelVoice',
    'sendSticker',
    'retrySticker',
    'sendTyping',
    'react',
    'startEdit',
    'deleteForEveryone',
    'dismissPinsError',
    'dismissActionError',
    'cancelEdit',
    'ensureGroupDetail',
    'stopPinsPoll',
  ];
  const state: Record<string, unknown> = {
    chats: chat === undefined ? [] : [chat],
    chatsLoad: 'loaded',
    pinMessage: vi.fn(() => Promise.resolve()),
    unpinMessage: vi.fn(() => Promise.resolve()),
    patchTopic: vi.fn(() => Promise.resolve()),
    removeTopicMember: vi.fn(() => Promise.resolve()),
    listTopicMembers: vi.fn(() => Promise.resolve([{ userId: 'u1', name: 'Ann' }])),
    listTopicAis: vi.fn(() => Promise.resolve([{ id: 'a1', name: 'Bot' }])),
    setTopicRoles: vi.fn(() => Promise.resolve()),
    refreshTopicRoles: vi.fn(() => Promise.resolve()),
    refreshGroupRoles: vi.fn(() => Promise.resolve()),
    canPin: () => true,
    pinFor: (_chatId: string, messageId: string) =>
      messageId === 'm1' ? { id: 'p1', messageId: 'm1' } : undefined,
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
  for (const name of fns) {
    state[name] = vi.fn();
  }
  return state;
};

const fn = (name: string) => h.state[name] as ReturnType<typeof vi.fn>;

const deferred = () => {
  let resolve: () => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const wait = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

const mounted: Array<() => void> = [];
let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

const mount = () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  act(() => root.render(createElement(ChatScreen)));
};

const rerender = () => act(() => root.render(createElement(ChatScreen)));

const banners = (): string[] =>
  [...container.querySelectorAll('[data-banner]')].map(
    (node) => `${node.getAttribute('data-banner')}:${node.textContent}`,
  );

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  h.props.clear();
  h.params = { id: 'c1' };
  h.state = makeState(topicChat());
  h.opener.open = vi.fn(() => Promise.resolve({ status: 'opened' }));
});

afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()?.();
  }
});

describe('chat screen layout', () => {
  it('shows the skeleton while the chats load and "Chat not found" after', () => {
    h.state = makeState(undefined);
    h.state['chatsLoad'] = 'loading';
    mount();
    expect(container.querySelector('[data-stub="Skeleton"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Chat not found');
    h.state['chatsLoad'] = 'loaded';
    rerender();
    expect(container.textContent).toContain('Chat not found');
  });

  it('opens the chat and loads the group detail on mount, and stops the pins poll on leave', () => {
    mount();
    expect(fn('openChat')).toHaveBeenCalledWith('c1');
    expect(fn('ensureGroupDetail')).toHaveBeenCalledWith('g1');
    expect(fn('stopPinsPoll')).not.toHaveBeenCalled();
    mounted.pop()?.();
    expect(fn('stopPinsPoll')).toHaveBeenCalled();
    expect(fn('cancelEdit')).toHaveBeenCalled();
  });

  it('renders the task strip and the full composer for a topic', () => {
    mount();
    expect(container.querySelector('[data-stub="TaskStrip"]')).not.toBeNull();
    expect(container.querySelector('[data-stub="Composer"]')).not.toBeNull();
    expect(container.querySelector('[data-stub="TopicInfoSheet"]')).not.toBeNull();
  });

  it('renders the channel bar for a channel and the composer for a legacy group', () => {
    h.state = makeState(topicChat({ chatKind: 'channel' }));
    mount();
    expect(container.querySelector('[data-stub="ChannelComposerBar"]')).not.toBeNull();
    expect(container.querySelector('[data-stub="TaskStrip"]')).toBeNull();
    mounted.pop()?.();
    h.state = makeState({ id: 'c1', title: 'Old', kind: 'group', groupId: 'g1' });
    mount();
    expect(container.querySelector('[data-stub="Composer"]')).not.toBeNull();
    expect(container.querySelector('[data-stub="TaskStrip"]')).toBeNull();
  });

  it('redirects to the group screen when the topic disappears', () => {
    const replace = vi.fn();
    h.router['replace'] = replace;
    h.state['topicNotice'] = { groupId: 'g1' };
    mount();
    expect(replace).toHaveBeenCalledWith({ pathname: '/group/[id]', params: { id: 'g1' } });
  });

  it('shows the "Message not found" notice after a failed search jump, once', () => {
    h.params = { id: 'c1', notFound: '1' };
    mount();
    expect(banners()).toEqual(['notice:Message not found']);
    act(() => container.querySelector<HTMLElement>('[data-banner]')?.click());
    expect(banners()).toEqual([]);
  });

  it('sends text with the reply and clears the reply', () => {
    mount();
    act(() => {
      prop('MessageList', 'onReply')({ id: 'm1', senderId: 'u1', senderName: 'Ann', text: 'hi' });
    });
    expect(plain('Composer', 'replyTo')).toMatchObject({ id: 'm1', senderName: 'Ann' });
    act(() => {
      prop('Composer', 'onSend')('hello', undefined);
    });
    expect(fn('sendText')).toHaveBeenCalledWith('c1', 'hello', {
      replyTo: expect.objectContaining({ id: 'm1' }),
    });
    expect(plain('Composer', 'replyTo')).toBeUndefined();
  });

  it('jumps to a loaded message and reports a missing one', () => {
    mount();
    act(() => {
      prop('PinnedBanner', 'onTapPin')({ messageId: 'm2' });
    });
    expect(plain('MessageList', 'jumpToMessageId')).toBe('m2');
    act(() => {
      prop('PinnedBanner', 'onTapPin')({ messageId: 'gone' });
    });
    expect(plain('PinnedBanner', 'jumpError')).toBe('Message not found');
  });

  it('selects messages, forwards them in order and clears the selection', () => {
    mount();
    act(() => {
      (plain('MessageList', 'selection') as { onStart: Fn }).onStart({ id: 'm2' });
    });
    act(() => {
      (plain('MessageList', 'selection') as { onToggle: Fn }).onToggle({ id: 'm1' });
    });
    expect(plain('SelectionBar', 'count')).toBe(2);
    act(() => {
      prop('SelectionBar', 'onForward')();
    });
    expect(plain('ForwardSheet', 'messages')).toEqual([{ id: 'm1' }, { id: 'm2' }]);
    expect(container.querySelector('[data-stub="SelectionBar"]')).toBeNull();
  });
});

describe('opening an attachment', () => {
  const message = { id: 'm1', attachment: { url: 'https://api.test/f/1', name: 'a.pdf' } };

  it('opens a safe URL and shows the opening id only while it runs', async () => {
    const gate = deferred();
    h.opener.open = vi.fn(() => gate.promise.then(() => ({ status: 'opened' })));
    mount();
    act(() => {
      prop('MessageList', 'onOpenAttachment')(message);
    });
    expect(h.opener.open).toHaveBeenCalledWith('https://api.test/f/1', 'a.pdf');
    expect(plain('MessageList', 'openingAttachmentId')).toBe('m1');
    gate.resolve();
    await wait();
    expect(plain('MessageList', 'openingAttachmentId')).toBeUndefined();
    expect(banners()).toEqual([]);
  });

  it('shows the opener error message', async () => {
    h.opener.open = vi.fn(() => Promise.resolve({ status: 'error', message: 'No app for that.' }));
    mount();
    act(() => {
      prop('MessageList', 'onOpenAttachment')(message);
    });
    await wait();
    expect(banners()).toEqual(['error:No app for that.']);
    expect(plain('MessageList', 'openingAttachmentId')).toBeUndefined();
  });

  it('shows a fixed sentence when the opener rejects', async () => {
    h.opener.open = vi.fn(() => Promise.reject(new Error('boom: secret')));
    mount();
    act(() => {
      prop('MessageList', 'onOpenAttachment')(message);
    });
    await wait();
    expect(banners()).toEqual(['error:Could not open that file. Try again.']);
    expect(plain('MessageList', 'openingAttachmentId')).toBeUndefined();
  });

  it('refuses a non-http address without calling the opener', () => {
    mount();
    act(() => {
      prop(
        'MessageList',
        'onOpenAttachment',
      )({
        id: 'm1',
        attachment: { url: 'file:///etc/passwd', name: 'x' },
      });
    });
    expect(h.opener.open).not.toHaveBeenCalled();
    expect(banners()).toEqual(['error:That file cannot be opened here.']);
  });

  it('ignores a message with no attachment', () => {
    mount();
    act(() => {
      prop('MessageList', 'onOpenAttachment')({ id: 'm1' });
    });
    expect(h.opener.open).not.toHaveBeenCalled();
    expect(banners()).toEqual([]);
  });
});

describe('pinning', () => {
  it('pins a message and keeps the banner empty on success', async () => {
    mount();
    act(() => {
      prop('MessageList', 'onPin')({ id: 'm2' });
    });
    await wait();
    expect(fn('pinMessage')).toHaveBeenCalledWith('c1', 'm2');
    expect(banners()).toEqual([]);
  });

  it('shows a fixed sentence when the pin fails, and dismisses it', async () => {
    fn('pinMessage').mockRejectedValue(new Error('server text'));
    mount();
    act(() => {
      prop('MessageList', 'onPin')({ id: 'm2' });
    });
    await wait();
    expect(banners()).toEqual(['error:Could not pin the message. Try again.']);
    act(() => container.querySelector<HTMLElement>('[data-banner]')?.click());
    expect(banners()).toEqual([]);
  });

  it('unpins through the pin row, and does nothing for an unpinned message', async () => {
    mount();
    act(() => {
      prop('MessageList', 'onUnpin')({ id: 'm2' });
    });
    await wait();
    expect(fn('unpinMessage')).not.toHaveBeenCalled();
    act(() => {
      prop('MessageList', 'onUnpin')({ id: 'm1' });
    });
    await wait();
    expect(fn('unpinMessage')).toHaveBeenCalledWith('c1', 'p1');
    expect(banners()).toEqual([]);
  });

  it('shows a fixed sentence when the unpin fails', async () => {
    fn('unpinMessage').mockRejectedValue(new Error('server text'));
    mount();
    act(() => {
      prop('MessageList', 'onUnpin')({ id: 'm1' });
    });
    await wait();
    expect(banners()).toEqual(['error:Could not unpin the message. Try again.']);
  });

  it('unpins from the sheet with a busy id, then clears it', async () => {
    const gate = deferred();
    fn('unpinMessage').mockReturnValue(gate.promise);
    mount();
    act(() => {
      prop('PinsSheet', 'onUnpin')({ id: 'p9', messageId: 'm1' });
    });
    expect(fn('unpinMessage')).toHaveBeenCalledWith('c1', 'p9');
    expect(plain('PinsSheet', 'unpinningId')).toBe('p9');
    gate.resolve();
    await wait();
    expect(plain('PinsSheet', 'unpinningId')).toBeNull();
    expect(plain('PinsSheet', 'error')).toBe('');
  });

  it('shows a fixed sentence in the sheet when its unpin fails', async () => {
    fn('unpinMessage').mockRejectedValue(new Error('server text'));
    mount();
    act(() => {
      prop('PinsSheet', 'onUnpin')({ id: 'p9', messageId: 'm1' });
    });
    await wait();
    expect(plain('PinsSheet', 'error')).toBe('Could not unpin. Try again.');
    expect(plain('PinsSheet', 'unpinningId')).toBeNull();
  });
});

describe('the task strip', () => {
  it('patches the status and skips an unchanged one', async () => {
    mount();
    act(() => {
      prop('TaskStrip', 'onChooseStatus')('open');
    });
    await wait();
    expect(fn('patchTopic')).not.toHaveBeenCalled();
    act(() => {
      prop('TaskStrip', 'onChooseStatus')('done');
    });
    await wait();
    expect(fn('patchTopic')).toHaveBeenCalledWith('c1', { status: 'done' });
    expect(plain('TaskStrip', 'error')).toBe('');
  });

  it('shows a fixed sentence when the patch fails, and clears it on the next try', async () => {
    fn('patchTopic').mockRejectedValueOnce(new Error('server text'));
    mount();
    act(() => {
      prop('TaskStrip', 'onChooseStatus')('done');
    });
    await wait();
    expect(plain('TaskStrip', 'error')).toBe('Could not save. Try again.');
    act(() => {
      prop('TaskStrip', 'onChooseStatus')('done');
    });
    await wait();
    expect(plain('TaskStrip', 'error')).toBe('');
  });

  it('patches the owner, and skips the same owner', async () => {
    h.state = makeState(
      topicChat({
        topic: { status: 'open', owner: { kind: 'user', id: 'u1' }, visibility: 'public' },
      }),
    );
    mount();
    act(() => {
      prop('TaskStrip', 'onChooseOwner')({ kind: 'user', id: 'u1', name: 'Ann' });
    });
    await wait();
    expect(fn('patchTopic')).not.toHaveBeenCalled();
    act(() => {
      prop('TaskStrip', 'onChooseOwner')({ kind: 'ai', id: 'a1', name: 'Bot' });
    });
    await wait();
    expect(fn('patchTopic')).toHaveBeenCalledWith('c1', { owner: { kind: 'ai', id: 'a1' } });
    act(() => {
      prop('TaskStrip', 'onChooseOwner')(null);
    });
    await wait();
    expect(fn('patchTopic')).toHaveBeenLastCalledWith('c1', { owner: null });
  });

  it('rejects a link that is not https and saves a trimmed one', async () => {
    mount();
    act(() => {
      prop('TaskStrip', 'onChangeLinkUrl')('http://example.com');
    });
    act(() => {
      prop('TaskStrip', 'onSaveLink')();
    });
    expect(plain('TaskStrip', 'error')).toBe('Link must be an https URL.');
    expect(fn('patchTopic')).not.toHaveBeenCalled();
    act(() => {
      prop('TaskStrip', 'onChangeLinkUrl')(' https://example.com/a ');
      prop('TaskStrip', 'onChangeLinkLabel')('  Docs  ');
    });
    act(() => {
      prop('TaskStrip', 'onSaveLink')();
    });
    await wait();
    expect(fn('patchTopic')).toHaveBeenCalledWith('c1', {
      linkUrl: 'https://example.com/a',
      linkLabel: 'Docs',
    });
    expect(plain('TaskStrip', 'error')).toBe('');
  });
});

describe('the topic info sheet', () => {
  const open = async () => {
    mount();
    act(() => {
      prop('ChatHeader', 'onOpenInfo')();
    });
    await wait();
  };

  it('loads members, AIs and roles when it opens', async () => {
    await open();
    expect(fn('listTopicMembers')).toHaveBeenCalledWith('c1');
    expect(fn('listTopicAis')).toHaveBeenCalledWith('c1');
    expect(fn('refreshTopicRoles')).toHaveBeenCalledWith('c1');
    expect(fn('refreshGroupRoles')).toHaveBeenCalledWith('g1');
    expect(plain('TopicInfoSheet', 'members')).toEqual([{ userId: 'u1', name: 'Ann' }]);
    expect(plain('TopicInfoSheet', 'ais')).toEqual([{ id: 'a1', name: 'Bot' }]);
    expect(plain('TopicInfoSheet', 'chat')).not.toBeNull();
    expect(plain('TopicInfoSheet', 'rolesError')).toBe('');
  });

  it('falls back to empty lists and role messages when the loads fail', async () => {
    fn('listTopicMembers').mockRejectedValue(new Error('x'));
    fn('listTopicAis').mockRejectedValue(new Error('x'));
    fn('refreshTopicRoles').mockRejectedValue({ status: 404 });
    fn('refreshGroupRoles').mockRejectedValue(new Error('x'));
    await open();
    expect(plain('TopicInfoSheet', 'members')).toEqual([]);
    expect(plain('TopicInfoSheet', 'ais')).toEqual([]);
    expect(plain('TopicInfoSheet', 'rolesError')).toBe(ROLE_GONE_MESSAGE);
    expect(plain('TopicInfoSheet', 'groupRolesError')).not.toBe('');
  });

  it('retries the roles loads', async () => {
    await open();
    fn('refreshTopicRoles').mockClear();
    fn('refreshGroupRoles').mockClear();
    fn('refreshTopicRoles').mockRejectedValueOnce({ status: 404 });
    act(() => {
      prop('TopicInfoSheet', 'onRetryRoles')();
    });
    await wait();
    expect(plain('TopicInfoSheet', 'rolesError')).toBe(ROLE_GONE_MESSAGE);
    act(() => {
      prop('TopicInfoSheet', 'onRetryGroupRoles')();
    });
    await wait();
    expect(fn('refreshGroupRoles')).toHaveBeenCalledWith('g1');
    expect(plain('TopicInfoSheet', 'groupRolesError')).toBe('');
  });

  it('saves the approver role and maps a write failure to a fixed line', async () => {
    await open();
    act(() => {
      prop('TopicInfoSheet', 'onPickApprover')('r1');
    });
    await wait();
    expect(fn('setTopicRoles')).toHaveBeenCalledWith('c1', { roleIds: [], approverRoleId: 'r1' });
    fn('setTopicRoles').mockRejectedValue(new Error('x'));
    act(() => {
      prop('TopicInfoSheet', 'onToggleTopicRole')('r2');
    });
    await wait();
    expect(fn('setTopicRoles')).toHaveBeenLastCalledWith('c1', {
      roleIds: ['r2'],
      approverRoleId: null,
    });
    expect(plain('TopicInfoSheet', 'rolesError')).toBe(ROLE_SAVE_FAILED_MESSAGE);
  });

  it('leaves the topic: busy while it runs, then closed', async () => {
    const gate = deferred();
    fn('removeTopicMember').mockReturnValue(gate.promise);
    await open();
    act(() => {
      prop('TopicInfoSheet', 'onLeave')();
    });
    expect(fn('removeTopicMember')).toHaveBeenCalledWith('c1', 'me');
    expect(plain('TopicInfoSheet', 'busy')).toBe(true);
    gate.resolve();
    await wait();
    expect(plain('TopicInfoSheet', 'busy')).toBe(false);
    expect(plain('TopicInfoSheet', 'chat')).toBeNull();
    expect(plain('TopicInfoSheet', 'error')).toBe('');
  });

  it('shows a fixed sentence when leaving fails and keeps the sheet open', async () => {
    fn('removeTopicMember').mockRejectedValue(new Error('server text'));
    await open();
    act(() => {
      prop('TopicInfoSheet', 'onLeave')();
    });
    await wait();
    expect(plain('TopicInfoSheet', 'error')).toBe('Could not leave the topic. Try again.');
    expect(plain('TopicInfoSheet', 'busy')).toBe(false);
    expect(plain('TopicInfoSheet', 'chat')).not.toBeNull();
  });

  it('archives the topic, and shows a fixed sentence when that fails', async () => {
    await open();
    act(() => {
      prop('TopicInfoSheet', 'onArchive')();
    });
    await wait();
    expect(fn('patchTopic')).toHaveBeenCalledWith('c1', { archived: true });
    expect(plain('TopicInfoSheet', 'chat')).toBeNull();
    act(() => {
      prop('ChatHeader', 'onOpenInfo')();
    });
    await wait();
    fn('patchTopic').mockRejectedValue(new Error('server text'));
    act(() => {
      prop('TopicInfoSheet', 'onArchive')();
    });
    await wait();
    expect(plain('TopicInfoSheet', 'error')).toBe('Could not archive the topic. Try again.');
    expect(plain('TopicInfoSheet', 'busy')).toBe(false);
  });

  it('does not close while busy', async () => {
    const gate = deferred();
    fn('removeTopicMember').mockReturnValue(gate.promise);
    await open();
    act(() => {
      prop('TopicInfoSheet', 'onLeave')();
    });
    act(() => {
      prop('TopicInfoSheet', 'onClose')();
    });
    expect(plain('TopicInfoSheet', 'chat')).not.toBeNull();
    gate.reject(new Error('x'));
    await wait();
    act(() => {
      prop('TopicInfoSheet', 'onClose')();
    });
    expect(plain('TopicInfoSheet', 'chat')).toBeNull();
  });
});
