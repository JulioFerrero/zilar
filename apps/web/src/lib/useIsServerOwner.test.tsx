import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { resetIsServerOwnerCache, useIsServerOwner } from './useIsServerOwner';
import { jsonResponseAt as jsonResponse } from '@/test/wait';

function Probe() {
  const isOwner = useIsServerOwner();
  return <p>{isOwner ? 'owner' : 'not-owner'}</p>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetIsServerOwnerCache();
});

describe('useIsServerOwner', () => {
  it('starts as not-owner and switches on after the 200, with one request', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        telegram: { configured: true, source: 'stored' },
        email: { configured: false, source: null, from: null },
        canManage: true,
      }),
    );
    resetIsServerOwnerCache();
    vi.stubGlobal('fetch', fetchMock);
    render(<Probe />);

    // The first paint says not-owner (never an optimistic owner flash)…
    expect(screen.getByText('not-owner')).toBeTruthy();
    // …then the 200 flips it, and a second consumer reuses the cache.
    expect(await screen.findByText('owner')).toBeTruthy();
    render(<Probe />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/integrations', expect.anything());
  });

  it('reads a 404 or an error as not-owner without ever flashing owner', async () => {
    for (const status of [404, 500]) {
      const fetchMock = vi.fn(async () =>
        jsonResponse(status, { error: { code: 'x', message: 'x' } }),
      );
      resetIsServerOwnerCache();
      vi.stubGlobal('fetch', fetchMock);
      const { unmount } = render(<Probe />);
      expect(await screen.findByText('not-owner')).toBeTruthy();
      expect(screen.queryByText(/^owner$/)).toBeNull();
      unmount();
    }
  });
});
