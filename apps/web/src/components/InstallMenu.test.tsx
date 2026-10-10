import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';
import { resetIsServerOwnerCache } from '@/lib/useIsServerOwner';

// Install entry (T-0119): the main menu carries "Install app" only while the
// browser holds a `beforeinstallprompt` offer, and a Notifications entry
// always.

function openMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
}

afterEach(() => {
  resetIsServerOwnerCache();
});

describe('ChatList install and notifications entries', () => {
  it('shows no Install entry without an install offer', () => {
    renderApp('/');
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /Install/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Notifications' })).toBeTruthy();
  });

  it('shows Install while the browser offers it, then fires the prompt', () => {
    renderApp('/');
    const prompt = vi.fn(async () => undefined);
    const event = new Event('beforeinstallprompt', { cancelable: true });
    (event as unknown as { prompt: () => Promise<void> }).prompt = prompt;
    act(() => {
      window.dispatchEvent(event);
    });

    openMenu();
    const install = screen.getByRole('menuitem', { name: 'Install app' });
    fireEvent.click(install);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('navigates to the Notifications page from the menu', async () => {
    renderApp('/');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Notifications' }));
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeTruthy();
  });

  it('shows the Integrations menu item only to the server owner', async () => {
    // renderApp uses the mock store, not fetch: stub the owner endpoint.
    resetIsServerOwnerCache();
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/settings/integrations')
        ? new Response(
            JSON.stringify({
              telegram: { configured: true, source: 'stored' },
              email: { configured: false, source: null, from: null },
              canManage: true,
            }),
          )
        : new Response(JSON.stringify({})),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderApp('/');
    openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Integrations' })).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('hides the Integrations menu item for non-owners (404)', async () => {
    resetIsServerOwnerCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }), {
            status: 404,
          }),
      ),
    );
    renderApp('/');
    openMenu();
    // The hook starts as not-owner; the 404 keeps it there.
    await vi.waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Integrations' })).toBeNull();
    });
    expect(screen.getByRole('menuitem', { name: 'Notifications' })).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
