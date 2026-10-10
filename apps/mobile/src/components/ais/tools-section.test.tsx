import { createElement, type ReactElement } from 'react';
import { AsyncResult, AtomRegistry } from 'effect/reactivity';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { createMockToolsApi } from '@/mock/tools';
import { mobileAtomRuntime } from '@/lib/effect/runtime';
import { ToolsApiError, type ToolListItem, type ToolsApi } from '@/lib/tools-api';

import {
  TOOLS_EMPTY_MESSAGE,
  TOOLS_LOAD_FAILED_MESSAGE,
  ToolsSection,
  ToolsSectionContent,
  closeDetailSheet,
  loadAiTools,
  loadAiToolsEffect,
  sectionStateOf,
  withoutTool,
  type ToolsSectionState,
} from './tools-section';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
}));

vi.mock('lucide-react-native', () => ({
  CircleAlert: 'CircleAlert',
  Inbox: 'Inbox',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/button', () => ({
  Button: 'Button',
}));

vi.mock('./tool-detail-sheet', () => ({
  ToolDetailSheet: (props: { toolId: string | null; onClose: () => void }) => {
    capturedSheetOnClose = props.onClose;
    return null;
  },
}));

let capturedSheetOnClose: (() => void) | undefined;

function content(state: ToolsSectionState, onRetry: () => void = () => {}): string {
  return renderToStaticMarkup(createElement(ToolsSectionContent, { state, onRetry }));
}

describe('ToolsSectionContent', () => {
  it('shows the loading line while loading', () => {
    expect(content({ status: 'loading', tools: [], message: '' })).toContain('Loading…');
  });

  it('shows the mock tools with versions, hosts and last runs', async () => {
    const api = createMockToolsApi();
    const tools = await api.listAiTools('ai-1');
    expect(tools).toHaveLength(2);
    const html = content({ status: 'ready', tools, message: '' });
    expect(html).toContain('Morning briefing');
    expect(html).toContain('v3');
    expect(html).toContain('news.example.com, api.example.com');
    expect(html).toContain('approved: news.example.com, api.example.com');
    expect(html).toContain('last run ok');
    expect(html).toContain('Draft helper');
    expect(html).toContain('no sites');
    expect(html).toContain('never run');
  });

  it('labels every row with Open <name> so it opens the detail sheet', async () => {
    const tools = await createMockToolsApi().listAiTools('ai-1');
    const html = content({ status: 'ready', tools, message: '' });
    expect(html).toContain('Open Morning briefing');
    expect(html).toContain('Open Draft helper');
  });

  it('does not show the approved suffix for the tool with no hosts', async () => {
    const tools = await createMockToolsApi().listAiTools('ai-1');
    const html = content({
      status: 'ready',
      tools: tools.filter((tool) => tool.hosts.length === 0),
      message: '',
    });
    expect(html).toContain('no sites');
    expect(html).not.toContain('approved:');
  });

  it('shows the empty sentence when the list is empty', () => {
    const html = content({ status: 'ready', tools: [], message: '' });
    expect(html).toContain(TOOLS_EMPTY_MESSAGE);
  });

  it('shows the fixed error line with a Retry button', () => {
    const html = content({
      status: 'error',
      tools: [],
      message: TOOLS_LOAD_FAILED_MESSAGE,
    });
    expect(html).toContain(TOOLS_LOAD_FAILED_MESSAGE);
    expect(html).toContain('Retry');
  });

  it('wires Retry to the reload callback', () => {
    const onRetry = vi.fn();
    const tree = ToolsSectionContent({
      state: { status: 'error', tools: [], message: TOOLS_LOAD_FAILED_MESSAGE },
      onRetry,
    }) as ReactElement<{ children: ReactElement[] }>;
    const children = tree.props.children as unknown as ReactElement<{ onPress?: () => void }>[];
    children
      .filter((child) => child.props.onPress !== undefined)
      .forEach((child) => child.props.onPress?.());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ToolsSection loading', () => {
  it('renders the heading with the loading line before the effect runs', () => {
    const api = createMockToolsApi();
    const html = renderToStaticMarkup(createElement(ToolsSection, { api, aiId: 'ai-1' }));
    expect(html).toContain('Tools');
    expect(html).toContain('Loading…');
  });
});

describe('loadAiTools', () => {
  it('returns the tools on success', async () => {
    const tools = await loadAiTools(createMockToolsApi(), 'ai-1');
    expect(tools).toHaveLength(2);
  });

  it('reads a 404 as an empty list', async () => {
    const api: ToolsApi = {
      listAiTools: async () => {
        throw new ToolsApiError(404, 'not_found', 'AI not found');
      },
      listAiRoutines: async () => [],
    };
    await expect(loadAiTools(api, 'ai-gone')).resolves.toEqual([]);
  });

  it('reads an unparseable response as an empty list', async () => {
    const api: ToolsApi = {
      listAiTools: async () => {
        throw new ToolsApiError(200, 'invalid_response', 'The server sent an unexpected response');
      },
      listAiRoutines: async () => [],
    };
    await expect(loadAiTools(api, 'ai-1')).resolves.toEqual([]);
  });

  it('rethrows any other failure so the section shows the error with Retry', async () => {
    const api: ToolsApi = {
      listAiTools: async () => {
        throw new ToolsApiError(0, 'network_error', 'Could not reach the server');
      },
      listAiRoutines: async () => [],
    };
    await expect(loadAiTools(api, 'ai-1')).rejects.toMatchObject({ code: 'network_error' });
  });
});

describe('withoutTool', () => {
  it('removes the deleted tool and keeps the others', async () => {
    const tools = await createMockToolsApi().listAiTools('ai-1');
    const remaining = withoutTool(tools, 'tool-1');
    expect(remaining.map((tool) => tool.id)).toEqual(['tool-2']);
    expect(withoutTool(tools, 'tool-gone')).toHaveLength(2);
  });
});

describe('closeDetailSheet', () => {
  it('closes the sheet and bumps the reload tick so the list reloads', () => {
    let openId: string | null = 'tool-1';
    let ticks = 0;
    closeDetailSheet(
      (id) => {
        openId = id;
      },
      () => {
        ticks += 1;
      },
    );
    expect(openId).toBeNull();
    expect(ticks).toBe(1);
  });

  it('wires the sheet onClose through closeDetailSheet so the list reloads', () => {
    capturedSheetOnClose = undefined;
    renderToStaticMarkup(createElement(ToolsSection, { api: createMockToolsApi(), aiId: 'ai-1' }));
    if (capturedSheetOnClose === undefined) throw new Error('expected the sheet onClose');
    const wiredOnClose: () => void = capturedSheetOnClose;
    // The wired onClose must be exactly the close-and-reload expression:
    // `closeDetailSheet(setOpenId, () => reloadTools())`. A revert to
    // `onClose={() => setOpenId(null)}` drops the reload and fails here.
    const source = wiredOnClose.toString().replace(/\s+/g, ' ');
    expect(source).toContain('closeDetailSheet');
    expect(source).toContain('reloadTools');
    expect(source).toContain('setOpenId');
    let directId: string | null = 'tool-1';
    let directTicks = 0;
    closeDetailSheet(
      (id) => {
        directId = id;
      },
      () => {
        directTicks += 1;
      },
    );
    expect(directId).toBeNull();
    expect(directTicks).toBe(1);
  });
});

const settle = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('the load did not settle');
};

describe('reload keeps the rows', () => {
  it('shows the rows while a reload is in flight, then the new rows', async () => {
    const first = await createMockToolsApi().listAiTools('ai-1');
    const second: ToolListItem[] = first.slice(1);
    let calls = 0;
    let answerReload: (tools: ToolListItem[]) => void = () => {};
    const api: ToolsApi = {
      listAiTools: () => {
        calls += 1;
        if (calls === 1) return Promise.resolve(first);
        return new Promise<ToolListItem[]>((resolve) => {
          answerReload = resolve;
        });
      },
      listAiRoutines: () => Promise.resolve([]),
    };
    const registry = AtomRegistry.make();
    const load = mobileAtomRuntime.atom(loadAiToolsEffect(api, 'ai-1'));
    const unsubscribe = registry.subscribe(load, () => {});

    expect(sectionStateOf(registry.get(load), []).status).toBe('loading');

    await settle(() => AsyncResult.isSuccess(registry.get(load)));
    expect(sectionStateOf(registry.get(load), [])).toEqual({
      status: 'ready',
      tools: first,
      message: '',
    });

    registry.refresh(load);
    await settle(() => calls === 2);
    const pending = registry.get(load);
    expect(AsyncResult.isWaiting(pending)).toBe(true);
    expect(sectionStateOf(pending, [])).toEqual({ status: 'ready', tools: first, message: '' });

    answerReload(second);
    await settle(() => {
      const current = registry.get(load);
      return AsyncResult.isSuccess(current) && !AsyncResult.isWaiting(current);
    });
    expect(sectionStateOf(registry.get(load), [])).toEqual({
      status: 'ready',
      tools: second,
      message: '',
    });
    unsubscribe();
  });
});
