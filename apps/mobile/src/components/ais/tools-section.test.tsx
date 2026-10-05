import { createElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { createMockToolsApi } from '@/mock/tools';
import { ToolsApiError, type ToolsApi } from '@/lib/tools-api';

import {
  TOOLS_EMPTY_MESSAGE,
  TOOLS_LOAD_FAILED_MESSAGE,
  ToolsSection,
  ToolsSectionContent,
  loadAiTools,
  type ToolsSectionState,
} from './tools-section';

vi.mock('react-native', () => ({
  View: 'View',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/button', () => ({
  Button: 'Button',
}));

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
