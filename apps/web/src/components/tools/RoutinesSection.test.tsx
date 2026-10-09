import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RoutinesSection } from './RoutinesSection';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

const morning = {
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

const evening = { ...morning, id: 'r-2', title: 'Evening prices' };

const groupScope = { groupId: 'g-1' };

describe('RoutinesSection on the web (T-0779)', () => {
  it('disables every row action while one pause is in flight, then settles', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubRoutes({
      'GET /api/groups/g-1/routines': () => jsonResponse(200, [morning, evening]),
      'POST /api/routines/r-1/pause': async () => {
        await gate;
        return jsonResponse(200, { ...morning, status: 'paused', pausedReason: 'user' });
      },
    });
    render(<RoutinesSection scope={groupScope} scopeKey="g:g-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause Morning prices' }));

    const pausing = screen.getByRole('button', { name: 'Pause Morning prices' });
    expect(pausing.textContent).toBe('Pausing…');
    expect(pausing.hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Pause Evening prices' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Delete Evening prices' }).hasAttribute('disabled'),
    ).toBe(true);

    release();
    expect(await screen.findByText('Paused by a person.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Pause Evening prices' }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('sends one pause for a double click on the same row', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = stubRoutes({
      'GET /api/groups/g-1/routines': () => jsonResponse(200, [morning]),
      'POST /api/routines/r-1/pause': async () => {
        await gate;
        return jsonResponse(200, { ...morning, status: 'paused', pausedReason: 'user' });
      },
    });
    render(<RoutinesSection scope={groupScope} scopeKey="g:g-1" canManage />);
    const pause = await screen.findByRole('button', { name: 'Pause Morning prices' });
    fireEvent.click(pause);
    fireEvent.click(pause);
    release();
    expect(await screen.findByText('Paused by a person.')).toBeTruthy();
    const pauses = fetchMock.mock.calls.filter(
      (call) => String(call[0]) === '/api/routines/r-1/pause',
    );
    expect(pauses).toHaveLength(1);
  });

  it('keeps the routine when Cancel closes the delete confirm', async () => {
    const fetchMock = stubRoutes({
      'GET /api/groups/g-1/routines': () => jsonResponse(200, [morning]),
    });
    render(<RoutinesSection scope={groupScope} scopeKey="g:g-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Morning prices' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete Morning prices' })).toBeTruthy();
    expect(screen.getByText('Morning prices')).toBeTruthy();
    const deletes = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deletes).toHaveLength(0);
  });

  it('shows the empty line when the group has no routines', async () => {
    stubRoutes({ 'GET /api/groups/g-1/routines': () => jsonResponse(200, []) });
    render(<RoutinesSection scope={groupScope} scopeKey="g:g-1" canManage />);
    expect(
      await screen.findByText('No routines here yet. Ask the AI in the chat to schedule one.'),
    ).toBeTruthy();
  });

  it('shows a 403 on a pause as the fixed sentence and keeps the row', async () => {
    stubRoutes({
      'GET /api/groups/g-1/routines': () => jsonResponse(200, [morning]),
      'POST /api/routines/r-1/pause': () => errorResponse(403, 'forbidden', 'Forbidden'),
    });
    render(<RoutinesSection scope={groupScope} scopeKey="g:g-1" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause Morning prices' }));
    expect(await screen.findByText('You may not change this routine.')).toBeTruthy();
    expect(screen.getByText('Morning prices')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pause Morning prices' }).textContent).toBe(
        'Pause',
      );
    });
  });
});
