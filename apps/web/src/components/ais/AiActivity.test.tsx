import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiActivity, describeAuditEntry, formatRelativeAudit } from './AiActivity';
import type { PublicAuditEntry } from '@/lib/api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const aiId = 'a-1';

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function auditEntry(overrides: Partial<PublicAuditEntry> = {}): PublicAuditEntry {
  return {
    id: 'audit-1',
    at: minutesAgo(3),
    aiId,
    groupId: null,
    action: 'ai.stopped',
    subjectId: 'a-1',
    argsHash: null,
    cost: null,
    result: 'ok',
    detail: null,
    actorUserId: 'u-you',
    ...overrides,
  };
}

function auditRouter(specs: { path: string; respond: () => Response }[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const spec = specs.find((item) => item.path === url);
    if (spec === undefined) {
      throw new Error(`unexpected fetch ${url}`);
    }
    return spec.respond();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderActivity() {
  return render(<AiActivity aiId={aiId} />);
}

describe('describeAuditEntry', () => {
  it('approval.decided with approve_once says approved', () => {
    expect(
      describeAuditEntry(
        auditEntry({ action: 'approval.decided', detail: { decision: 'approve_once' } }),
      ),
    ).toBe('A request was approved');
  });

  it('approval.decided with approve_always says approved', () => {
    expect(
      describeAuditEntry(
        auditEntry({ action: 'approval.decided', detail: { decision: 'approve_always' } }),
      ),
    ).toBe('A request was approved');
  });

  it('approval.decided with deny says denied', () => {
    expect(
      describeAuditEntry(auditEntry({ action: 'approval.decided', detail: { decision: 'deny' } })),
    ).toBe('A request was denied');
  });

  it('approval.decided with an unknown decision falls back to decided', () => {
    expect(
      describeAuditEntry(auditEntry({ action: 'approval.decided', detail: { decision: 'maybe' } })),
    ).toBe('A request was decided');
  });

  it('approval.decided with no detail falls back to decided', () => {
    expect(describeAuditEntry(auditEntry({ action: 'approval.decided', detail: null }))).toBe(
      'A request was decided',
    );
  });

  it('ai.stopped says Stopped', () => {
    expect(describeAuditEntry(auditEntry({ action: 'ai.stopped' }))).toBe('Stopped');
  });

  it('ai.resumed says Resumed', () => {
    expect(describeAuditEntry(auditEntry({ action: 'ai.resumed' }))).toBe('Resumed');
  });

  it('humanises known machine actions', () => {
    expect(describeAuditEntry(auditEntry({ action: 'machine.approved' }))).toBe('Machine approved');
    expect(describeAuditEntry(auditEntry({ action: 'machine.paired' }))).toBe('Machine paired');
    expect(describeAuditEntry(auditEntry({ action: 'machine.deleted' }))).toBe('Machine deleted');
  });

  it('humanises an unknown action without leaking it raw', () => {
    expect(describeAuditEntry(auditEntry({ action: 'cost.charged' }))).toBe('Cost charged');
    expect(describeAuditEntry(auditEntry({ action: 'something.else' }))).toBe('Something else');
    expect(describeAuditEntry(auditEntry({ action: 'engine.used' }))).toBe('Engine used');
  });

  it('never renders hostile detail fields, only the decision', () => {
    const entry = auditEntry({
      action: 'approval.decided',
      detail: {
        decision: 'approve_once',
        note: '<script>alert(1)</script>',
        nested: { x: '<img src=x onerror=alert(1)>' },
      },
    });
    const output = describeAuditEntry(entry);
    expect(output).toBe('A request was approved');
    expect(output).not.toContain('<');
    expect(output).not.toContain('script');
  });

  it('falls back to humanised action when detail has no decision but other keys', () => {
    const entry = auditEntry({
      action: 'machine.approved',
      detail: { foo: '<script>alert(1)</script>' },
    });
    expect(describeAuditEntry(entry)).toBe('Machine approved');
  });
});

describe('formatRelativeAudit', () => {
  const now = new Date('2026-09-29T12:00:00.000Z');
  it('says just now for very recent entries', () => {
    expect(formatRelativeAudit(new Date('2026-09-29T12:00:00.000Z'), now)).toBe('just now');
    expect(formatRelativeAudit(new Date('2026-09-29T11:59:30.000Z'), now)).toBe('just now');
  });

  it('formats minutes ago', () => {
    expect(formatRelativeAudit(new Date('2026-09-29T11:57:00.000Z'), now)).toBe('3 min ago');
    expect(formatRelativeAudit(new Date('2026-09-29T11:01:00.000Z'), now)).toBe('59 min ago');
  });

  it('formats hours ago', () => {
    expect(formatRelativeAudit(new Date('2026-09-29T10:00:00.000Z'), now)).toBe('2 hours ago');
    expect(formatRelativeAudit(new Date('2026-09-29T11:00:00.000Z'), now)).toBe('1 hour ago');
  });

  it('formats days ago', () => {
    expect(formatRelativeAudit(new Date('2026-09-28T12:00:00.000Z'), now)).toBe('1 day ago');
    expect(formatRelativeAudit(new Date('2026-09-27T12:00:00.000Z'), now)).toBe('2 days ago');
  });
});

describe('AiActivity', () => {
  it('renders the list with a plain-words description and a relative time', async () => {
    auditRouter([
      {
        path: '/api/audit?aiId=a-1&limit=20',
        respond: () =>
          jsonResponse(200, {
            entries: [
              auditEntry({ id: 'a-stopped', action: 'ai.stopped' }),
              auditEntry({
                id: 'a-approved',
                action: 'approval.decided',
                detail: { decision: 'approve_once' },
              }),
            ],
            next: null,
          }),
      },
    ]);

    renderActivity();

    expect(await screen.findByText('Stopped')).toBeTruthy();
    expect(screen.getByText('A request was approved')).toBeTruthy();
    expect(screen.getAllByText(/min ago/)).toHaveLength(2);
  });

  it('shows the empty state when the AI has no activity', async () => {
    auditRouter([
      {
        path: '/api/audit?aiId=a-1&limit=20',
        respond: () => jsonResponse(200, { entries: [], next: null }),
      },
    ]);

    renderActivity();

    expect(await screen.findByText('No activity yet.')).toBeTruthy();
  });

  it('shows an error with a Retry button when the first load fails', async () => {
    auditRouter([
      {
        path: '/api/audit?aiId=a-1&limit=20',
        respond: () => jsonResponse(500, { error: { code: 'boom', message: 'server down' } }),
      },
    ]);

    renderActivity();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('server down');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('retries after a failed first load', async () => {
    let calls = 0;
    auditRouter([
      {
        path: '/api/audit?aiId=a-1&limit=20',
        respond: () => {
          calls += 1;
          if (calls === 1) {
            return jsonResponse(500, { error: { code: 'boom', message: 'server down' } });
          }
          return jsonResponse(200, {
            entries: [auditEntry({ id: 'recovered' })],
            next: null,
          });
        },
      },
    ]);

    renderActivity();

    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Stopped')).toBeTruthy();
  });

  it('shows Load more and appends the next page', async () => {
    auditRouter([
      {
        path: '/api/audit?aiId=a-1&limit=20',
        respond: () =>
          jsonResponse(200, {
            entries: [auditEntry({ id: 'first' })],
            next: 'cursor-1',
          }),
      },
      {
        path: '/api/audit?aiId=a-1&limit=20&before=cursor-1',
        respond: () =>
          jsonResponse(200, {
            entries: [auditEntry({ id: 'second', action: 'ai.resumed' })],
            next: null,
          }),
      },
    ]);

    renderActivity();

    await screen.findByText('Stopped');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Resumed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('deduplicates entries by id when the server returns overlap', async () => {
    const overlap = auditEntry({ id: 'overlap', action: 'ai.stopped' });
    auditRouter([
      {
        path: '/api/audit?aiId=a-1&limit=20',
        respond: () =>
          jsonResponse(200, {
            entries: [overlap],
            next: 'cursor-1',
          }),
      },
      {
        path: '/api/audit?aiId=a-1&limit=20&before=cursor-1',
        respond: () =>
          jsonResponse(200, {
            entries: [overlap, auditEntry({ id: 'extra', action: 'ai.resumed' })],
            next: null,
          }),
      },
    ]);

    renderActivity();

    await screen.findByText('Stopped');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Resumed');
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
  });

  it('disables Load more while a page is in flight', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('before=')) {
        return pending;
      }
      return jsonResponse(200, {
        entries: [auditEntry({ id: 'first' })],
        next: 'cursor-1',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderActivity();

    await screen.findByText('Stopped');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Loading…' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Loading…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    release(jsonResponse(200, { entries: [auditEntry({ id: 'second' })], next: null }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Loading…' })).toBeNull());
  });

  it('the refresh button reloads from the top', async () => {
    let calls = 0;
    const fetchMock = auditRouter([
      {
        path: '/api/audit?aiId=a-1&limit=20',
        respond: () => {
          calls += 1;
          if (calls === 1) {
            return jsonResponse(200, {
              entries: [auditEntry({ id: 'one', action: 'ai.stopped' })],
              next: null,
            });
          }
          return jsonResponse(200, {
            entries: [auditEntry({ id: 'two', action: 'ai.resumed' })],
            next: null,
          });
        },
      },
    ]);

    renderActivity();

    await screen.findByText('Stopped');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh activity' }));
    expect(await screen.findByText('Resumed')).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a hostile detail object does not leak markup into the rendered text', async () => {
    auditRouter([
      {
        path: '/api/audit?aiId=a-1&limit=20',
        respond: () =>
          jsonResponse(200, {
            entries: [
              auditEntry({
                id: 'hostile',
                action: 'approval.decided',
                detail: {
                  decision: 'approve_once',
                  note: '<script>alert(1)</script>',
                  nested: { x: '<img src=x onerror=alert(1)>' },
                },
              }),
            ],
            next: null,
          }),
      },
    ]);

    const { container } = renderActivity();

    expect(await screen.findByText('A request was approved')).toBeTruthy();
    expect(container.textContent).not.toContain('<script>');
    expect(container.textContent).not.toContain('onerror');
  });
});
