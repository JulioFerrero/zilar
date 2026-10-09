import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToolDetailPanel } from './ToolDetailPanel';

type Route = () => Response | Promise<Response>;

function jsonResponse(status: number, body: unknown): Response {
  if (status === 204) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), { status });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { error: { code, message } });
}

/** Answers `METHOD /api/path` from `routes`; anything else is a 404. */
function stubRoutes(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const route = routes[`${init?.method ?? 'GET'} ${String(url)}`];
    return route === undefined ? errorResponse(404, 'not_found', 'unexpected') : route();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The bodies of the calls to one `METHOD /api/path`. */
function bodiesOf(fetchMock: ReturnType<typeof vi.fn>, key: string): unknown[] {
  return fetchMock.mock.calls
    .filter(
      (call) =>
        `${(call[1] as RequestInit | undefined)?.method ?? 'GET'} ${String(call[0])}` === key,
    )
    .map((call) => {
      const body = (call[1] as RequestInit | undefined)?.body;
      return body === undefined ? undefined : JSON.parse(body as string);
    });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const toolDetail = {
  id: 'tool-1',
  aiId: 'ai-1',
  groupId: 'g-1',
  topicId: 't-1',
  name: 'prices',
  description: 'Fetches prices.',
  currentVersion: 2,
  hosts: ['api.example.com'],
  approvedHosts: ['api.example.com'],
  lastRunStatus: 'ok',
  updatedAt: '2026-09-30T10:00:00.000Z',
  source: 'export function run() {\n  return fetchPrices();\n}',
};

const versionList = [
  {
    id: 'v-2',
    toolId: 'tool-1',
    version: 2,
    message: 'Add the host',
    hosts: ['api.example.com'],
    createdBy: 'u-you',
    createdAt: '2026-09-29T10:00:00.000Z',
  },
  {
    id: 'v-1',
    toolId: 'tool-1',
    version: 1,
    message: 'First',
    hosts: [],
    createdBy: 'u-you',
    createdAt: '2026-09-28T10:00:00.000Z',
  },
];

const runList = [
  {
    id: 'run-1',
    toolId: 'tool-1',
    version: 2,
    trigger: 'manual',
    status: 'ok',
    errorKind: null,
    durationMs: 42,
    fetchCount: 1,
    outputText: 'gold 4300',
    createdAt: '2026-09-30T10:00:00.000Z',
  },
];

const runOk = {
  ok: true,
  output: { text: 'gold 4300' },
  logs: '',
  durationMs: 42,
  fetchCount: 1,
};

/** The routes of a tool that loads, with `overrides` for the rest. */
function toolRoutes(overrides: Record<string, Route> = {}): Record<string, Route> {
  return {
    'GET /api/tools/tool-1': () => jsonResponse(200, toolDetail),
    'GET /api/tools/tool-1/versions': () => jsonResponse(200, versionList),
    'GET /api/tools/tool-1/runs': () => jsonResponse(200, runList),
    'GET /api/tools/tool-1/versions/1': () =>
      jsonResponse(200, { ...versionList[1], source: 'old source' }),
    'POST /api/tools/tool-1/run': () => jsonResponse(200, runOk),
    ...overrides,
  };
}

function renderPanel(
  overrides: Partial<{
    canManage: boolean;
    onDeleted: (toolId: string) => void;
    onClose: () => void;
  }> = {},
) {
  const onDeleted = overrides.onDeleted ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  render(
    <ToolDetailPanel
      toolId="tool-1"
      canManage={overrides.canManage ?? true}
      onDeleted={onDeleted}
      onClose={onClose}
    />,
  );
  return { onDeleted, onClose };
}

describe('ToolDetailPanel on the web (T-0779)', () => {
  it('rejects run input over 4 KB before any POST', async () => {
    const fetchMock = stubRoutes(toolRoutes());
    renderPanel();
    fireEvent.change(await screen.findByLabelText('Run input (JSON)'), {
      target: { value: JSON.stringify('x'.repeat(5000)) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(await screen.findByText('Input must be at most 4 KB.')).toBeTruthy();
    expect(bodiesOf(fetchMock, 'POST /api/tools/tool-1/run')).toHaveLength(0);
  });

  it('sends the parsed run input and shows the output as text', async () => {
    const fetchMock = stubRoutes(toolRoutes());
    renderPanel();
    fireEvent.change(await screen.findByLabelText('Run input (JSON)'), {
      target: { value: ' {"city":"Madrid"} ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(await screen.findByText(/Ok in 42 ms · 1 fetch/)).toBeTruthy();
    const runNow = within(screen.getByRole('region', { name: 'Run now' }));
    expect(runNow.getByText(/gold 4300/)).toBeTruthy();
    expect(bodiesOf(fetchMock, 'POST /api/tools/tool-1/run')).toEqual([
      { input: { city: 'Madrid' } },
    ]);
  });

  it('runs with an empty body when the input is blank', async () => {
    const fetchMock = stubRoutes(toolRoutes());
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    expect(await screen.findByText(/Ok in 42 ms/)).toBeTruthy();
    expect(bodiesOf(fetchMock, 'POST /api/tools/tool-1/run')).toEqual([{}]);
  });

  it('confirms a revert, then reloads the detail', async () => {
    const fetchMock = stubRoutes(
      toolRoutes({
        'POST /api/tools/tool-1/revert': () =>
          jsonResponse(200, { ...versionList[1], version: 3, message: 'Revert to v1' }),
      }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Revert to v1' }));
    expect(screen.getByRole('dialog', { name: /Revert prices to v1/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Revert prices to v1/ })).toBeNull();
    });
    expect(bodiesOf(fetchMock, 'POST /api/tools/tool-1/revert')).toEqual([{ version: 1 }]);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter((call) => String(call[0]) === '/api/tools/tool-1'),
      ).toHaveLength(2);
    });
  });

  it('confirms a delete, deletes, and reports the tool id to the parent', async () => {
    const fetchMock = stubRoutes(
      toolRoutes({ 'DELETE /api/tools/tool-1': () => jsonResponse(204, null) }),
    );
    const { onDeleted } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tool' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith('tool-1');
    });
    expect(
      fetchMock.mock.calls.some(
        (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toBe(true);
  });

  it('shows a failed load with its message, Retry and Back', async () => {
    let detailCalls = 0;
    stubRoutes(
      toolRoutes({
        'GET /api/tools/tool-1': () => {
          detailCalls += 1;
          return detailCalls === 1
            ? errorResponse(500, 'internal', 'Load broke')
            : jsonResponse(200, toolDetail);
        },
      }),
    );
    const { onClose } = renderPanel();
    expect(await screen.findByText('Load broke')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Source (v2, read-only)')).toBeTruthy();
    expect(detailCalls).toBe(2);
  });

  it('shows an older version source, then the current one again', async () => {
    stubRoutes(toolRoutes());
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Show source of v1' }));
    expect(await screen.findByText(/Showing v1/)).toBeTruthy();
    expect(await screen.findByText(/old source/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show source of v2' }));
    expect(await screen.findByText(/fetchPrices/)).toBeTruthy();
    expect(screen.queryByText(/Showing v1/)).toBeNull();
  });

  it('shows the fixed sentence for a 403 on run', async () => {
    stubRoutes(
      toolRoutes({
        'POST /api/tools/tool-1/run': () => errorResponse(403, 'forbidden', 'Forbidden'),
      }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    expect(await screen.findByText('You may not run this tool.')).toBeTruthy();
  });
});
