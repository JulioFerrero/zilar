import { describe, expect, it, vi } from 'vitest';

import { JoinLinkBody, joinLinkViewFor, joinPreviewSubtitle, resolveGroupChat } from './join-link';
import type { JoinPreview } from '@/lib/invite-links-api';

// The hook-free body is called as a plain function with `react-native`
// stubbed (same pattern as `markdown-text.test.tsx`): Node only, no
// simulator, no new dependency.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('../../components/ui/text', () => ({
  Text: 'Text',
}));

interface TestElement {
  type: unknown;
  props: { children?: unknown; style?: unknown; onPress?: () => void; [key: string]: unknown };
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

function textOf(node: unknown): string {
  if (node === null || node === undefined) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('');
  }
  if (typeof node === 'object' && 'props' in (node as TestElement)) {
    const element = node as TestElement;
    if (typeof element.type === 'function') {
      const Component = element.type as (props: unknown) => unknown;
      return textOf(Component(element.props));
    }
    return textOf(element.props.children);
  }
  return '';
}

function preview(overrides: Partial<JoinPreview> = {}): JoinPreview {
  return { groupTitle: 'Dev team', memberCount: 6, alreadyMember: false, ...overrides };
}

describe('joinLinkViewFor', () => {
  it('is ready with the preview', () => {
    expect(joinLinkViewFor({ preview: preview(), failed: false, rateLimited: false })).toEqual({
      state: 'ready',
      preview: preview(),
    });
  });

  it('shows the same neutral message for every failure kind', () => {
    const view = joinLinkViewFor({ failed: true, rateLimited: false });
    expect(view.state).toBe('invalid');
    expect(view.error).toBe('This link does not work');
  });

  it('shows the retry text for rate limits', () => {
    const view = joinLinkViewFor({ failed: true, rateLimited: true });
    expect(view.state).toBe('invalid');
    expect(view.error).toBe('Too many attempts. Try again later.');
  });

  it('maps an unreachable server to the offline state, not the dead-link one', () => {
    const view = joinLinkViewFor({ failed: true, rateLimited: false, offline: true });
    expect(view).toEqual({ state: 'offline' });
  });

  it('keeps a join error on the ready preview', () => {
    const view = joinLinkViewFor({
      preview: preview(),
      failed: false,
      rateLimited: false,
      joinError: 'Could not join the group. Try again.',
    });
    expect(view.state).toBe('ready');
    expect(view.error).toBe('Could not join the group. Try again.');
  });

  it('never carries a token in any message', () => {
    const token = 'a'.repeat(64);
    const views = [
      joinLinkViewFor({ failed: true, rateLimited: false }),
      joinLinkViewFor({ failed: true, rateLimited: true }),
      joinLinkViewFor({
        preview: preview(),
        failed: false,
        rateLimited: false,
        joinError: 'Could not join the group. Try again.',
      }),
    ];
    for (const view of views) {
      expect(JSON.stringify(view)).not.toContain(token);
    }
  });
});

describe('joinPreviewSubtitle', () => {
  it('counts members, never names them', () => {
    expect(joinPreviewSubtitle(preview())).toBe('6 members');
    expect(joinPreviewSubtitle(preview({ memberCount: 1 }))).toBe('1 member');
  });
});

describe('resolveGroupChat', () => {
  const general = { id: 'general@rooms.test', groupId: 'g1', topic: { isGeneral: true } };
  const other = { id: 't-1@rooms.test', groupId: 'g1', topic: { isGeneral: false } };

  it('opens the General topic chat when present', () => {
    expect(resolveGroupChat([other, general], 'g1')).toEqual({
      kind: 'chat',
      chatId: 'general@rooms.test',
    });
  });

  it('falls back to the group screen when only non-General rows exist', () => {
    expect(resolveGroupChat([other], 'g1')).toEqual({ kind: 'group', groupId: 'g1' });
  });

  it('falls back to the chats list when the refresh has not landed yet', () => {
    expect(resolveGroupChat([], 'g1')).toEqual({ kind: 'list' });
    expect(resolveGroupChat([general], 'g2')).toEqual({ kind: 'list' });
  });

  it('finds a group that arrived after the Join press (fresh read)', () => {
    // The bug: the route resolved against the render-time chats, which never
    // contain the just-joined group. The route now reads the store fresh at
    // call time; this proves the resolution sees a group that appeared after
    // the press (the store refreshes chats before the join resolves).
    const before: (typeof general)[] = [];
    expect(resolveGroupChat(before, 'g1')).toEqual({ kind: 'list' });
    const after = [...before, general];
    expect(resolveGroupChat(after, 'g1')).toEqual({
      kind: 'chat',
      chatId: 'general@rooms.test',
    });
  });
});

describe('JoinLinkBody', () => {
  function body(
    view: Parameters<typeof JoinLinkBody>[0]['view'],
    handlers: { onJoin?: () => void; onCancel?: () => void; onRetry?: () => void } = {},
  ) {
    return JoinLinkBody({
      view,
      busy: false,
      onJoin: handlers.onJoin ?? (() => {}),
      onCancel: handlers.onCancel ?? (() => {}),
      onRetry: handlers.onRetry ?? (() => {}),
    });
  }

  it('renders the preview card with the title, count and Join', () => {
    const all = textOf(collect(body({ state: 'ready', preview: preview() })));
    expect(all).toContain('Dev team');
    expect(all).toContain('6 members');
    expect(all).toContain('Join the group');
  });

  it('renders Open the group for an existing member', () => {
    const all = textOf(
      collect(body({ state: 'ready', preview: preview({ alreadyMember: true }) })),
    );
    expect(all).toContain('Open the group');
    expect(all).toContain('already a member');
  });

  it('shows the checking state', () => {
    expect(textOf(collect(body({ state: 'checking' })))).toContain('Checking your invite link');
  });

  it('shows the retryable offline state, distinct from a dead link', () => {
    const calls: string[] = [];
    const elements = collect(body({ state: 'offline' }, { onRetry: () => calls.push('retry') }));
    const all = textOf(elements);
    expect(all).toContain('Could not load the link');
    expect(all).toContain('Check your connection');
    expect(all).not.toContain('This link does not work');
    const retry = elements.find(
      (element) => element.props.accessibilityLabel === 'Retry loading the link',
    );
    expect(retry).toBeDefined();
    const onPress = (retry as TestElement).props.onPress;
    expect(typeof onPress).toBe('function');
    (onPress as () => void)();
    expect(calls).toEqual(['retry']);
  });

  it('shows the same neutral message for every failure kind', () => {
    for (const error of ['This link does not work', 'Too many attempts. Try again later.']) {
      const all = textOf(collect(body({ state: 'invalid', error })));
      expect(all).toContain('This link does not work');
      if (error !== 'This link does not work') {
        expect(all).toContain(error);
      }
    }
  });

  it('never renders a token', () => {
    const token = 'a'.repeat(64);
    const all = textOf(collect(body({ state: 'invalid', error: 'This link does not work' })));
    expect(all).not.toContain(token);
  });

  it('joins and cancels on press', () => {
    const calls: string[] = [];
    const elements = collect(
      body(
        { state: 'ready', preview: preview() },
        { onJoin: () => calls.push('join'), onCancel: () => calls.push('cancel') },
      ),
    );
    const join = elements.find((element) => element.props.accessibilityLabel === 'Join the group');
    expect(join).toBeDefined();
    const joinPress = (join as TestElement).props.onPress;
    expect(typeof joinPress).toBe('function');
    (joinPress as () => void)();
    const cancel = elements.find((element) => element.props.accessibilityLabel === 'Cancel');
    const cancelPress = (cancel as TestElement).props.onPress;
    (cancelPress as () => void)();
    expect(calls).toEqual(['join', 'cancel']);
  });
});
