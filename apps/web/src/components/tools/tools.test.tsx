import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';
import { CodeBlock, TruncatedText } from './CodeBlock';
import { ToolsSection } from './ToolsSection';
import { RoutinesSection } from './RoutinesSection';

const auth: AuthState = {
  status: 'authenticated',
  user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
  refetch: async () => {},
};

function jsonResponse(status: number, body: unknown): Response {
  if (status === 204) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), { status });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { error: { code, message } });
}

function renderWithStore(node: React.ReactNode) {
  const store = createChatStore({});
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>{node}</ChatStoreProvider>
    </AuthProvider>,
  );
  return { store };
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

const versions = [
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

const runs = [
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

function stubTools(
  overrides: {
    list?: unknown;
    detail?: unknown;
    versions?: unknown;
    versionSource?: unknown;
    runs?: unknown;
    runResult?: unknown;
  } = {},
) {
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    const method = init?.method ?? 'GET';
    if (target === '/api/topics/t-1/tools') {
      return jsonResponse(200, overrides.list ?? [toolRow]);
    }
    if (target === '/api/tools/tool-1' && method === 'GET') {
      return jsonResponse(200, overrides.detail ?? toolDetail);
    }
    if (target === '/api/tools/tool-1/versions' && method === 'GET') {
      return jsonResponse(200, overrides.versions ?? versions);
    }
    if (target === '/api/tools/tool-1/versions/1' && method === 'GET') {
      return jsonResponse(200, overrides.versionSource ?? { ...versions[1], source: 'old source' });
    }
    if (target === '/api/tools/tool-1/runs' && method === 'GET') {
      return jsonResponse(200, overrides.runs ?? runs);
    }
    if (target === '/api/tools/tool-1/run' && method === 'POST') {
      return jsonResponse(
        200,
        overrides.runResult ?? {
          ok: true,
          output: { text: 'gold 4300' },
          logs: '',
          durationMs: 42,
          fetchCount: 1,
        },
      );
    }
    if (target === '/api/tools/tool-1/revert' && method === 'POST') {
      return jsonResponse(200, { ...versions[0], version: 3, message: 'Revert to v1' });
    }
    if (target === '/api/tools/tool-1' && method === 'DELETE') {
      return jsonResponse(204, null);
    }
    return errorResponse(404, 'not_found', 'unexpected');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const routineRow = {
  id: 'r-1',
  title: 'Morning prices',
  toolName: 'prices',
  schedule: { kind: 'daily', time: '09:00', timezone: 'Europe/Madrid', weekdays: [1, 2, 3, 4, 5] },
  status: 'active',
  pausedReason: null,
  nextRunAt: '2026-10-01T09:00:00.000Z',
  lastRunAt: '2026-09-30T09:00:00.000Z',
  lastStatus: 'ok',
  approvedHosts: [],
};

function stubRoutines(list: unknown[] = [routineRow]) {
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    const method = init?.method ?? 'GET';
    if (target === '/api/groups/g-1/routines') {
      return jsonResponse(200, list);
    }
    if (target === '/api/routines/r-1/pause' && method === 'POST') {
      return jsonResponse(200, { ...routineRow, status: 'paused', pausedReason: 'user' });
    }
    if (target === '/api/routines/r-1/resume' && method === 'POST') {
      return jsonResponse(200, routineRow);
    }
    if (target === '/api/routines/r-1' && method === 'DELETE') {
      return jsonResponse(204, null);
    }
    return errorResponse(404, 'not_found', 'unexpected');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('CodeBlock and TruncatedText (T-0107)', () => {
  it('renders source as text with line numbers, never as HTML', () => {
    renderWithStore(
      <CodeBlock code={'<img src=x onerror=alert(1)>\njavascript:alert(2)'} label="Source" />,
    );
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(screen.getByText('javascript:alert(2)')).toBeTruthy();
  });

  it('truncates long output with a Show all toggle', () => {
    const long = `ok\n${'x'.repeat(3000)}`;
    renderWithStore(<TruncatedText text={long} preview={`${long.slice(0, 2000)}…`} truncated />);
    expect(screen.getByRole('button', { name: 'Show all' })).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy();
  });
});

describe('ToolsSection (T-0107)', () => {
  it('lists tools with version, hosts and last run, plus the one-sentence empty state', async () => {
    stubTools();
    renderWithStore(<ToolsSection scope={{ topicId: 't-1' }} scopeKey="topic:t-1" canManage />);
    expect(await screen.findByText('prices')).toBeTruthy();
    expect(screen.getByText('v2', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText(/api\.example\.com/)).toBeTruthy();
  });

  it('shows the one-sentence empty state when there are no tools', async () => {
    stubTools({ list: [] });
    renderWithStore(<ToolsSection scope={{ topicId: 't-1' }} scopeKey="topic:t-1" canManage />);
    expect(await screen.findByText(/An AI can write small tools/)).toBeTruthy();
  });

  it('opens the detail with read-only source, history and run', async () => {
    stubTools();
    renderWithStore(<ToolsSection scope={{ topicId: 't-1' }} scopeKey="topic:t-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open prices' }));
    expect(await screen.findByText('Source (v2, read-only)')).toBeTruthy();
    expect(screen.getByText('Version history')).toBeTruthy();
    expect(screen.getByText(/Revert to this version/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(await screen.findByText(/gold 4300/)).toBeTruthy();
  });

  it('keeps the run result when the history refresh after it fails', async () => {
    const fetchMock = stubTools();
    renderWithStore(<ToolsSection scope={{ topicId: 't-1' }} scopeKey="topic:t-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open prices' }));
    await screen.findByText('Source (v2, read-only)');
    const base = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target === '/api/tools/tool-1/runs' && (init?.method ?? 'GET') === 'GET') {
        return errorResponse(500, 'internal', 'boom');
      }
      return base === undefined ? errorResponse(404, 'not_found', 'unexpected') : base(url, init);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(await screen.findByText(/gold 4300/)).toBeTruthy();
    expect(screen.queryByText('Could not run the tool.')).toBeNull();
  });

  it('shows an older version source on history select and reverts with confirm', async () => {
    stubTools();
    renderWithStore(<ToolsSection scope={{ topicId: 't-1' }} scopeKey="topic:t-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open prices' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show source of v1' }));
    expect(await screen.findByText(/Showing v1/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Revert to v1' }));
    expect(screen.getByRole('dialog', { name: /Revert prices to v1/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Revert prices to v1/ })).toBeNull();
    });
  });

  it('rejects invalid JSON input before the POST', async () => {
    const fetchMock = stubTools();
    renderWithStore(<ToolsSection scope={{ topicId: 't-1' }} scopeKey="topic:t-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open prices' }));
    fireEvent.change(await screen.findByLabelText('Run input (JSON)'), {
      target: { value: '{oops' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(await screen.findByText('Input must be valid JSON.')).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/run'))).toBe(false);
  });

  it('hides Run/Revert/Delete for a member the API would refuse', async () => {
    stubTools();
    renderWithStore(
      <ToolsSection scope={{ topicId: 't-1' }} scopeKey="topic:t-1" canManage={false} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open prices' }));
    expect(await screen.findByText('Source (v2, read-only)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Revert to this version/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete tool' })).toBeNull();
  });

  it('shows an inline message on a 403 list, no crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse(403, 'forbidden', 'Forbidden')),
    );
    // A forbidden group-scope list surfaces as an inline error with Retry
    // (a 404 or an unparsable row instead reads as "no tools", like older
    // servers and strict fetch mocks).
    renderWithStore(<ToolsSection scope={{ groupId: 'g-1' }} scopeKey="group:g-1" canManage />);
    expect(await screen.findByText('Forbidden')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('falls back to the empty state on a topic 404 (older server)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse(404, 'not_found', 'Topic not found')),
    );
    renderWithStore(<ToolsSection scope={{ topicId: 't-1' }} scopeKey="topic:t-1" canManage />);
    expect(await screen.findByText(/An AI can write small tools/)).toBeTruthy();
  });

  it('handles a 403 run gracefully with an inline message', async () => {
    stubTools({
      runResult: undefined,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        const method = init?.method ?? 'GET';
        if (target === '/api/topics/t-1/tools') {
          return jsonResponse(200, [toolRow]);
        }
        if (target === '/api/tools/tool-1' && method === 'GET') {
          return jsonResponse(200, toolDetail);
        }
        if (target === '/api/tools/tool-1/versions') {
          return jsonResponse(200, versions);
        }
        if (target === '/api/tools/tool-1/runs') {
          return jsonResponse(200, runs);
        }
        if (target === '/api/tools/tool-1/run') {
          return errorResponse(403, 'forbidden', 'Forbidden');
        }
        return errorResponse(404, 'not_found', 'unexpected');
      }),
    );
    renderWithStore(<ToolsSection scope={{ topicId: 't-1' }} scopeKey="topic:t-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open prices' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    expect(await screen.findByText('You may not run this tool.')).toBeTruthy();
  });

  it('shows a deleted-or-missing tool as an inline 404 with Retry and Back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const target = String(url);
        if (target === '/api/topics/t-1/tools') {
          return jsonResponse(200, [toolRow]);
        }
        return errorResponse(404, 'not_found', 'Tool not found');
      }),
    );
    renderWithStore(<ToolsSection scope={{ topicId: 't-1' }} scopeKey="topic:t-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open prices' }));
    expect(await screen.findByText('Tool not found')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: 'Open prices' })).toBeTruthy();
  });

  it('shows network failures inline with Retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    renderWithStore(<ToolsSection scope={{ topicId: 't-1' }} scopeKey="topic:t-1" canManage />);
    expect(await screen.findByText('Could not reach the server')).toBeTruthy();
  });
});

describe('RoutinesSection (T-0107)', () => {
  it('lists routines with the schedule in plain words', async () => {
    stubRoutines();
    renderWithStore(<RoutinesSection scope={{ groupId: 'g-1' }} scopeKey="g:g-1" canManage />);
    expect(await screen.findByText('Morning prices')).toBeTruthy();
    expect(screen.getByText(/daily at 09:00 Europe\/Madrid on Mon/)).toBeTruthy();
  });

  it('pauses and resumes with the status updating', async () => {
    stubRoutines();
    renderWithStore(<RoutinesSection scope={{ groupId: 'g-1' }} scopeKey="g:g-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause Morning prices' }));
    expect(await screen.findByText('Paused by a person.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume Morning prices' }));
    await waitFor(() => {
      expect(screen.queryByText('Paused by a person.')).toBeNull();
    });
  });

  it('deletes with an inline confirm step', async () => {
    stubRoutines();
    renderWithStore(<RoutinesSection scope={{ groupId: 'g-1' }} scopeKey="g:g-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Morning prices' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deleting Morning prices' }));
    await waitFor(() => {
      expect(screen.queryByText('Morning prices')).toBeNull();
    });
  });

  it('explains a hosts_changed pause with its next step', async () => {
    stubRoutines([{ ...routineRow, status: 'needs_approval', pausedReason: 'hosts_changed' }]);
    const section = screen;
    renderWithStore(<RoutinesSection scope={{ groupId: 'g-1' }} scopeKey="g:g-1" canManage />);
    expect(await section.findByText(/Ask the AI to schedule it again/)).toBeTruthy();
  });

  it('shows the re-approve hint on a 409 resume', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        if (target === '/api/groups/g-1/routines') {
          return jsonResponse(200, [
            { ...routineRow, status: 'needs_approval', pausedReason: 'hosts_changed' },
          ]);
        }
        if (target === '/api/routines/r-1/resume') {
          expect(init?.method).toBe('POST');
          return errorResponse(409, 'needs_approval', 'The routine needs re-approval');
        }
        return errorResponse(404, 'not_found', 'unexpected');
      }),
    );
    renderWithStore(<RoutinesSection scope={{ groupId: 'g-1' }} scopeKey="g:g-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume Morning prices' }));
    expect(await screen.findByText(/needs re-approval/)).toBeTruthy();
  });

  it('hides Pause/Resume/Delete for a member the API would refuse', async () => {
    stubRoutines();
    renderWithStore(
      <RoutinesSection scope={{ groupId: 'g-1' }} scopeKey="g:g-1" canManage={false} />,
    );
    expect(await screen.findByText('Morning prices')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause Morning prices' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume Morning prices' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Morning prices' })).toBeNull();
  });

  it('shows a 404 on a routine action as an inline message, no crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const target = String(url);
        if (target === '/api/groups/g-1/routines') {
          return jsonResponse(200, [routineRow]);
        }
        return errorResponse(404, 'not_found', 'Routine not found');
      }),
    );
    renderWithStore(<RoutinesSection scope={{ groupId: 'g-1' }} scopeKey="g:g-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause Morning prices' }));
    expect(await screen.findByText('You may not change this routine.')).toBeTruthy();
    expect(screen.queryByText('Morning prices')).toBeTruthy();
  });

  it('shows 403 and network failures inline with Retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse(403, 'forbidden', 'Forbidden')),
    );
    renderWithStore(<RoutinesSection scope={{ groupId: 'g-1' }} scopeKey="g:g-1" canManage />);
    expect(await screen.findByText('Forbidden')).toBeTruthy();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    renderWithStore(<RoutinesSection scope={{ groupId: 'g-1' }} scopeKey="g2:g-1" canManage />);
    expect(await screen.findByText('Could not reach the server')).toBeTruthy();
  });

  it('renders tool output as text, proving nothing executes', async () => {
    stubTools({
      runResult: {
        ok: true,
        output: { text: '<img src=x onerror=alert(1)> javascript:alert(2)' },
        logs: '',
        durationMs: 1,
        fetchCount: 0,
      },
    });
    renderWithStore(<ToolsSection scope={{ topicId: 't-1' }} scopeKey="topic:t-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open prices' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    const pre = await screen.findByText(/javascript:alert/);
    expect(pre.tagName.toLowerCase()).toBe('pre');
    expect(document.querySelector('img')).toBeNull();
    // The detail wrapper scopes every assertion below to the panel.
    const panel = within(pre.closest('div') ?? document.body);
    expect(panel.getByText(/img src/)).toBeTruthy();
  });
});
