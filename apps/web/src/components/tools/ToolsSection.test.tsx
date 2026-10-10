import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToolsSection } from './ToolsSection';
import { jsonResponseAt as jsonResponse } from '@/test/wait';

type Route = () => Response | Promise<Response>;

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

afterEach(() => {
  vi.unstubAllGlobals();
});

const toolRow = {
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
};

const toolDetail = {
  ...toolRow,
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
];

/** The detail routes every test that opens a tool needs. */
function detailRoutes(): Record<string, Route> {
  return {
    'GET /api/tools/tool-1': () => jsonResponse(200, toolDetail),
    'GET /api/tools/tool-1/versions': () => jsonResponse(200, versionList),
    'GET /api/tools/tool-1/runs': () => jsonResponse(200, []),
  };
}

const topicScope = { topicId: 't-1' };

describe('ToolsSection on the web (T-0779)', () => {
  it('shows Loading… until the list arrives, then the tool rows', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubRoutes({
      'GET /api/topics/t-1/tools': async () => {
        await gate;
        return jsonResponse(200, [toolRow]);
      },
    });
    render(<ToolsSection scope={topicScope} scopeKey="topic:t-1" canManage />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    release();
    expect(await screen.findByRole('button', { name: 'Open prices' })).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByText(/approved: api\.example\.com/)).toBeTruthy();
  });

  it('shows the list error with Retry, and Retry loads the list again', async () => {
    let listCalls = 0;
    const fetchMock = stubRoutes({
      'GET /api/topics/t-1/tools': () => {
        listCalls += 1;
        return listCalls === 1
          ? errorResponse(500, 'internal', 'Server broke')
          : jsonResponse(200, [toolRow]);
      },
    });
    render(<ToolsSection scope={topicScope} scopeKey="topic:t-1" canManage />);
    expect(await screen.findByText('Server broke')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Open prices' })).toBeTruthy();
    expect(screen.queryByText('Server broke')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads a 404 on the list as no tools (older server)', async () => {
    stubRoutes({
      'GET /api/topics/t-1/tools': () => errorResponse(404, 'not_found', 'Topic not found'),
    });
    render(<ToolsSection scope={topicScope} scopeKey="topic:t-1" canManage />);
    expect(await screen.findByText(/An AI can write small tools/)).toBeTruthy();
    expect(screen.queryByText('Topic not found')).toBeNull();
  });

  it('goes back to the list from a tool detail with Back to tools', async () => {
    stubRoutes({
      'GET /api/topics/t-1/tools': () => jsonResponse(200, [toolRow]),
      ...detailRoutes(),
    });
    render(<ToolsSection scope={topicScope} scopeKey="topic:t-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open prices' }));
    expect(await screen.findByText('Source (v2, read-only)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to tools' }));
    expect(await screen.findByRole('button', { name: 'Open prices' })).toBeTruthy();
  });

  it('reloads the list after a delete from the detail, and the tool is gone', async () => {
    let listed = [toolRow];
    stubRoutes({
      'GET /api/topics/t-1/tools': () => jsonResponse(200, listed),
      ...detailRoutes(),
      'DELETE /api/tools/tool-1': () => {
        listed = [];
        return jsonResponse(204, null);
      },
    });
    render(<ToolsSection scope={topicScope} scopeKey="topic:t-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open prices' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tool' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/An AI can write small tools/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open prices' })).toBeNull();
  });

  it('shows a network failure inline with Retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    render(<ToolsSection scope={topicScope} scopeKey="topic:t-1" canManage />);
    expect(await screen.findByText('Could not reach the server')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
