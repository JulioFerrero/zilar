import { createElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { createMockAuditApi } from '@/mock/audit';
import { AuditApiError, type AuditApi, type PublicAuditEntry } from '@/lib/audit-api';

import {
  ACTIVITY_EMPTY_MESSAGE,
  ACTIVITY_LOAD_FAILED_MESSAGE,
  ACTIVITY_MORE_FAILED_MESSAGE,
  AiActivity,
  AiActivityContent,
  AiActivityHeader,
  appendAiActivity,
  loadAiActivity,
  type AiActivityState,
} from './ai-activity';

vi.mock('react-native', () => ({
  View: 'View',
  Pressable: 'Pressable',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/button', () => ({
  Button: 'Button',
}));

vi.mock('lucide-react-native', () => ({
  RefreshCw: 'RefreshCw',
}));

const NOW = new Date('2026-10-03T10:00:00.000Z');

function content(
  state: AiActivityState,
  overrides: { onRetry?: () => void; onLoadMore?: () => void } = {},
): string {
  return renderToStaticMarkup(
    createElement(AiActivityContent, {
      state,
      now: NOW,
      onRetry: overrides.onRetry ?? (() => {}),
      onLoadMore: overrides.onLoadMore ?? (() => {}),
    }),
  );
}

function pressablesOf(tree: ReactElement): { onPress?: () => void }[] {
  const found: { onPress?: () => void }[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === 'object' && node !== null && 'props' in node) {
      const props = (node as { props: Record<string, unknown> }).props;
      const onPress = props['onPress'];
      if (typeof onPress === 'function') {
        found.push({ onPress: onPress as () => void });
      }
      visit(props['children']);
    }
  };
  visit(tree);
  return found;
}

describe('AiActivityContent', () => {
  it('shows three placeholder bars while loading', () => {
    const html = content({
      status: 'loading',
      entries: [],
      next: null,
      message: '',
      loadingMore: false,
    });
    expect(html).toContain('Loading activity');
  });

  it('shows the rows with web descriptions and relative times', async () => {
    const api = createMockAuditApi();
    const first = await api.listAiAudit('ai-1');
    expect(first.entries).toHaveLength(20);
    const html = content({
      status: 'ready',
      entries: first.entries,
      next: first.next,
      message: '',
      loadingMore: false,
    });
    expect(html).toContain('A request was approved');
    expect(html).toContain('A request was denied');
    expect(html).toContain('Stopped');
    expect(html).toContain('Resumed');
    expect(html).toContain('Tool run');
    expect(html).toContain('just now');
    expect(html).toContain('3 min ago');
    expect(html).not.toContain('Could not load');
  });

  it('shows the empty sentence when the list is empty', () => {
    const html = content({
      status: 'ready',
      entries: [],
      next: null,
      message: '',
      loadingMore: false,
    });
    expect(html).toContain(ACTIVITY_EMPTY_MESSAGE);
  });

  it('shows the fixed error line with a Retry button on first-load failure', () => {
    const html = content({
      status: 'error',
      entries: [],
      next: null,
      message: ACTIVITY_LOAD_FAILED_MESSAGE,
      loadingMore: false,
    });
    expect(html).toContain(ACTIVITY_LOAD_FAILED_MESSAGE);
    expect(html).toContain('Retry');
  });

  it('wires Retry to the reload callback', () => {
    const onRetry = vi.fn();
    const tree = AiActivityContent({
      state: {
        status: 'error',
        entries: [],
        next: null,
        message: ACTIVITY_LOAD_FAILED_MESSAGE,
        loadingMore: false,
      },
      now: NOW,
      onRetry,
      onLoadMore: () => {},
    }) as unknown as ReactElement;
    for (const child of pressablesOf(tree)) {
      child.onPress?.();
    }
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows Load more while a next cursor exists and hides it at the end', async () => {
    const api = createMockAuditApi();
    const first = await api.listAiAudit('ai-1');
    expect(first.next).not.toBeNull();
    const more = content({
      status: 'ready',
      entries: first.entries,
      next: first.next,
      message: '',
      loadingMore: false,
    });
    expect(more).toContain('Load more');

    const done = content({
      status: 'ready',
      entries: first.entries,
      next: null,
      message: '',
      loadingMore: false,
    });
    expect(done).not.toContain('Load more');
  });

  it('reads Loading… on the button while the next page loads', async () => {
    const first = await createMockAuditApi().listAiAudit('ai-1');
    const html = content({
      status: 'ready',
      entries: first.entries,
      next: first.next,
      message: '',
      loadingMore: true,
    });
    expect(html).toContain('Loading…');
  });

  it('wires Load more to the append callback', async () => {
    const first = await createMockAuditApi().listAiAudit('ai-1');
    const onLoadMore = vi.fn();
    const tree = AiActivityContent({
      state: {
        status: 'ready',
        entries: first.entries,
        next: first.next,
        message: '',
        loadingMore: false,
      },
      now: NOW,
      onRetry: () => {},
      onLoadMore,
    }) as unknown as ReactElement;
    for (const child of pressablesOf(tree)) {
      child.onPress?.();
    }
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('keeps the rows and shows the fixed line when loading more fails', async () => {
    const first = await createMockAuditApi().listAiAudit('ai-1');
    const html = content({
      status: 'ready',
      entries: first.entries,
      next: first.next,
      message: ACTIVITY_MORE_FAILED_MESSAGE,
      loadingMore: false,
    });
    expect(html).toContain('A request was approved');
    expect(html).toContain(ACTIVITY_MORE_FAILED_MESSAGE);
    expect(html).toContain('Load more');
  });
});

describe('AiActivityHeader', () => {
  it('shows the heading without refresh before the list loads', () => {
    const html = renderToStaticMarkup(
      createElement(AiActivityHeader, { ready: false, onRefresh: () => {} }),
    );
    expect(html).toContain('Activity');
    expect(html).not.toContain('Refresh activity');
  });

  it('shows the refresh button once loaded and wires it to reload', () => {
    const onRefresh = vi.fn();
    const html = renderToStaticMarkup(createElement(AiActivityHeader, { ready: true, onRefresh }));
    expect(html).toContain('Refresh activity');

    const tree = AiActivityHeader({ ready: true, onRefresh }) as unknown as ReactElement;
    for (const child of pressablesOf(tree)) {
      child.onPress?.();
    }
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('AiActivity loading', () => {
  it('renders the heading with placeholders before the effect runs', () => {
    const api = createMockAuditApi();
    const html = renderToStaticMarkup(createElement(AiActivity, { api, aiId: 'ai-1' }));
    expect(html).toContain('Activity');
    expect(html).toContain('Loading activity');
  });
});

describe('loadAiActivity and appendAiActivity', () => {
  it('loads the first page of 20 with a next cursor', async () => {
    const page = await loadAiActivity(createMockAuditApi(), 'ai-1');
    expect(page.entries).toHaveLength(20);
    expect(page.next).not.toBeNull();
  });

  it('appends the next page and clears the cursor at the end', async () => {
    const api = createMockAuditApi();
    const first = await loadAiActivity(api, 'ai-1');
    const merged = await appendAiActivity(api, 'ai-1', first.next!, first.entries);
    expect(merged.entries).toHaveLength(25);
    expect(merged.next).toBeNull();
  });

  it('de-duplicates entries already in the list', async () => {
    const api = createMockAuditApi();
    const first = await loadAiActivity(api, 'ai-1');
    const merged = await appendAiActivity(api, 'ai-1', first.next!, [
      ...first.entries,
      ...(await api.listAiAudit('ai-1', first.next!)).entries,
    ]);
    expect(merged.entries).toHaveLength(25);
  });

  it('rethrows failures so the section shows the fixed sentences', async () => {
    const failing: AuditApi = {
      listAiAudit: async () => {
        throw new AuditApiError(0, 'network_error', 'Could not reach the server');
      },
    };
    await expect(loadAiActivity(failing, 'ai-1')).rejects.toMatchObject({
      code: 'network_error',
    });
    const entries: PublicAuditEntry[] = [];
    await expect(appendAiActivity(failing, 'ai-1', 'cursor', entries)).rejects.toMatchObject({
      code: 'network_error',
    });
  });

  it('reloads the first page on refresh', async () => {
    let calls = 0;
    const api: AuditApi = {
      listAiAudit: async (aiId, before) => {
        calls += 1;
        return createMockAuditApi().listAiAudit(aiId, before);
      },
    };
    await loadAiActivity(api, 'ai-1');
    await loadAiActivity(api, 'ai-1');
    expect(calls).toBe(2);
  });
});
