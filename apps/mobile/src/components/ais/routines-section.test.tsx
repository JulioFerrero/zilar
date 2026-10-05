import { createElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { createMockToolsApi } from '@/mock/tools';
import { ToolsApiError, type ToolsApi } from '@/lib/tools-api';

import {
  ROUTINES_EMPTY_MESSAGE,
  ROUTINES_LOAD_FAILED_MESSAGE,
  RoutinesSection,
  RoutinesSectionContent,
  loadAiRoutines,
  type RoutinesSectionState,
} from './routines-section';

vi.mock('react-native', () => ({
  View: 'View',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/button', () => ({
  Button: 'Button',
}));

function content(state: RoutinesSectionState, onRetry: () => void = () => {}): string {
  return renderToStaticMarkup(createElement(RoutinesSectionContent, { state, onRetry }));
}

describe('RoutinesSectionContent', () => {
  it('shows the loading line while loading', () => {
    expect(content({ status: 'loading', routines: [], message: '' })).toContain('Loading…');
  });

  it('shows the mock routines with schedules, tools and statuses', async () => {
    const routines = await createMockToolsApi().listAiRoutines('ai-1');
    expect(routines).toHaveLength(2);
    const html = content({ status: 'ready', routines, message: '' });
    expect(html).toContain('Weekday briefing');
    expect(html).toContain('daily at 09:00 Europe/Madrid on Mon, Tue, Wed, Thu, Fri');
    expect(html).toContain('runs Morning briefing');
    expect(html).toContain('active');
    expect(html).toContain('Hourly drafts');
    expect(html).toContain('every 1 hour');
    expect(html).toContain('paused');
    expect(html).toContain('Paused after repeated failures. Ask the AI to fix it.');
  });

  it('shows the empty sentence when the list is empty', () => {
    const html = content({ status: 'ready', routines: [], message: '' });
    expect(html).toContain(ROUTINES_EMPTY_MESSAGE);
  });

  it('shows the fixed error line with a Retry button', () => {
    const html = content({
      status: 'error',
      routines: [],
      message: ROUTINES_LOAD_FAILED_MESSAGE,
    });
    expect(html).toContain(ROUTINES_LOAD_FAILED_MESSAGE);
    expect(html).toContain('Retry');
  });

  it('wires Retry to the reload callback', () => {
    const onRetry = vi.fn();
    const tree = RoutinesSectionContent({
      state: { status: 'error', routines: [], message: ROUTINES_LOAD_FAILED_MESSAGE },
      onRetry,
    }) as ReactElement<{ children: ReactElement[] }>;
    const children = tree.props.children as unknown as ReactElement<{ onPress?: () => void }>[];
    children
      .filter((child) => child.props.onPress !== undefined)
      .forEach((child) => child.props.onPress?.());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('RoutinesSection loading', () => {
  it('renders the heading with the loading line before the effect runs', () => {
    const api = createMockToolsApi();
    const html = renderToStaticMarkup(createElement(RoutinesSection, { api, aiId: 'ai-1' }));
    expect(html).toContain('Routines');
    expect(html).toContain('Loading…');
  });
});

describe('loadAiRoutines', () => {
  it('returns the routines on success', async () => {
    const routines = await loadAiRoutines(createMockToolsApi(), 'ai-1');
    expect(routines).toHaveLength(2);
  });

  it('reads a 404 as an empty list', async () => {
    const api: ToolsApi = {
      listAiTools: async () => [],
      listAiRoutines: async () => {
        throw new ToolsApiError(404, 'not_found', 'AI not found');
      },
    };
    await expect(loadAiRoutines(api, 'ai-gone')).resolves.toEqual([]);
  });

  it('reads an unparseable response as an empty list', async () => {
    const api: ToolsApi = {
      listAiTools: async () => [],
      listAiRoutines: async () => {
        throw new ToolsApiError(200, 'invalid_response', 'The server sent an unexpected response');
      },
    };
    await expect(loadAiRoutines(api, 'ai-1')).resolves.toEqual([]);
  });

  it('rethrows any other failure so the section shows the error with Retry', async () => {
    const api: ToolsApi = {
      listAiTools: async () => [],
      listAiRoutines: async () => {
        throw new ToolsApiError(0, 'network_error', 'Could not reach the server');
      },
    };
    await expect(loadAiRoutines(api, 'ai-1')).rejects.toMatchObject({ code: 'network_error' });
  });
});
