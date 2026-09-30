import { describe, expect, it, vi } from 'vitest';

import { JoinLinkBody, joinLinkViewFor, joinPreviewSubtitle } from './join-link';
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

describe('JoinLinkBody', () => {
  it('renders the preview card with the title, count and Join', () => {
    const all = textOf(
      collect(
        JoinLinkBody({
          view: { state: 'ready', preview: preview() },
          busy: false,
          onJoin: () => {},
          onCancel: () => {},
        }),
      ),
    );
    expect(all).toContain('Dev team');
    expect(all).toContain('6 members');
    expect(all).toContain('Join the group');
  });

  it('renders Open the group for an existing member', () => {
    const all = textOf(
      collect(
        JoinLinkBody({
          view: { state: 'ready', preview: preview({ alreadyMember: true }) },
          busy: false,
          onJoin: () => {},
          onCancel: () => {},
        }),
      ),
    );
    expect(all).toContain('Open the group');
    expect(all).toContain('already a member');
  });

  it('shows the checking state', () => {
    expect(
      textOf(
        collect(
          JoinLinkBody({
            view: { state: 'checking' },
            busy: false,
            onJoin: () => {},
            onCancel: () => {},
          }),
        ),
      ),
    ).toContain('Checking your invite link');
  });

  it('shows the same neutral message for every failure kind', () => {
    for (const error of ['This link does not work', 'Too many attempts. Try again later.']) {
      const all = textOf(
        collect(
          JoinLinkBody({
            view: { state: 'invalid', error },
            busy: false,
            onJoin: () => {},
            onCancel: () => {},
          }),
        ),
      );
      expect(all).toContain('This link does not work');
      if (error !== 'This link does not work') {
        expect(all).toContain(error);
      }
    }
  });

  it('never renders a token', () => {
    const token = 'a'.repeat(64);
    const all = textOf(
      collect(
        JoinLinkBody({
          view: { state: 'invalid', error: 'This link does not work' },
          busy: false,
          onJoin: () => {},
          onCancel: () => {},
        }),
      ),
    );
    expect(all).not.toContain(token);
  });

  it('joins and cancels on press', () => {
    const calls: string[] = [];
    const elements = collect(
      JoinLinkBody({
        view: { state: 'ready', preview: preview() },
        busy: false,
        onJoin: () => calls.push('join'),
        onCancel: () => calls.push('cancel'),
      }),
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
