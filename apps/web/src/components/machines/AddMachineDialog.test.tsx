import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddMachineDialog } from './AddMachineDialog';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function createFetch(responses: Array<{ match: RegExp; respond: () => Response }>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const entry of responses) {
      if (entry.match.test(url)) {
        return Promise.resolve(entry.respond());
      }
    }
    void init;
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AddMachineDialog', () => {
  it('shows the code, copy key, command and the runner note', async () => {
    vi.stubGlobal(
      'fetch',
      createFetch([
        {
          match: /\/api\/machines\/pairing-codes$/,
          respond: () =>
            jsonResponse(201, {
              code: 'K7QX-M2PA',
              expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            }),
        },
      ]),
    );

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const onClose = vi.fn();
    render(<AddMachineDialog onClose={onClose} />);

    expect(await screen.findByText('K7QX-M2PA')).toBeTruthy();
    expect(screen.getByText(/zilar-runner pair K7QX-M2PA/)).toBeTruthy();
    expect(screen.getByText(/The desktop runner is not published yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy pairing code' })).toHaveProperty(
      'title',
      'Copy pairing code',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy pairing code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('K7QX-M2PA'));
    expect(screen.getByText('Copied')).toBeTruthy();
  });

  it('ticks the countdown with fake timers and shows "Code expired" with New code', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T10:00:00.000Z'));
    const expiry = new Date(Date.now() + 5 * 1000).toISOString();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 201,
            json: async () => ({ code: 'K7QX-M2PA', expiresAt: expiry }),
          }) as Response,
      ),
    );

    const onClose = vi.fn();
    render(<AddMachineDialog onClose={onClose} />);

    // Let the fetch microtask settle.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('K7QX-M2PA')).toBeTruthy();
    expect(screen.getByText(/Expires in 0:0[45]/)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(screen.getAllByText('Code expired').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'New code' })).toBeTruthy();
    const copy = screen.getByRole('button', { name: 'Copy pairing code' }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
  });

  it('closes on Escape and clears the countdown timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      'fetch',
      createFetch([
        {
          match: /\/api\/machines\/pairing-codes$/,
          respond: () =>
            jsonResponse(201, {
              code: 'K7QX-M2PA',
              expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            }),
        },
      ]),
    );

    const onClose = vi.fn();
    render(<AddMachineDialog onClose={onClose} />);

    expect(await screen.findByText('K7QX-M2PA')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    // Advancing time after the close should not throw ("Can't perform a React
    // state update on an unmounted component").
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
  });
});
