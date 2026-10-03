import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { matchRoutes } from 'react-router';
import { renderApp } from '@/test/renderApp';

describe('handle gate', () => {
  it('sends a handle-less user to /welcome/handle once', () => {
    renderApp('/', undefined, {
      auth: {
        status: 'authenticated',
        user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: null },
        refetch: async () => {},
      },
    });
    expect(screen.getByText('Pick your username')).toBeTruthy();
  });

  it('lets a user with a handle straight through', () => {
    renderApp('/');
    expect(screen.queryByText('Pick your username')).toBeNull();
  });

  it('does nothing while the handle is still loading', () => {
    renderApp('/', undefined, {
      auth: {
        status: 'authenticated',
        user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: undefined },
        refetch: async () => {},
      },
    });
    // No redirect, no flash of the handle step: the gate waits for `getMe()`.
    expect(screen.queryByText('Pick your username')).toBeNull();
  });

  it('does not redirect again after Skip for now (same session)', async () => {
    const { dismissHandleGate, resetHandleGateDismissal } = await import('@/lib/handleGate');
    resetHandleGateDismissal('u-you');
    const auth = {
      status: 'authenticated' as const,
      user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: null },
      refetch: async () => {},
    };
    const first = renderApp('/', undefined, { auth });
    expect(await screen.findByText('Pick your username')).toBeTruthy();
    first.unmount();
    // Skip records the dismissal; `/` and a chat route no longer redirect.
    dismissHandleGate('u-you');
    renderApp('/', undefined, { auth });
    expect(screen.queryByText('Pick your username')).toBeNull();
    expect(screen.queryByText(/Chats|New chat/)).not.toBeNull();
  });

  it('asks again for a different sign-in (dismissal is per user id)', async () => {
    const { dismissHandleGate, resetHandleGateDismissal } = await import('@/lib/handleGate');
    resetHandleGateDismissal();
    dismissHandleGate('u-you');
    renderApp('/', undefined, {
      auth: {
        status: 'authenticated',
        user: { id: 'u-other', name: 'Other', email: 'other@zilar.test', handle: null },
        refetch: async () => {},
      },
    });
    expect(await screen.findByText('Pick your username')).toBeTruthy();
  });

  it('opens the Add contact dialog prefilled from /u/handle', async () => {
    renderApp('/u/bob_b');
    expect(await screen.findByRole('dialog', { name: 'Add contact' })).toBeTruthy();
    expect(screen.getByDisplayValue('bob_b')).toBeTruthy();
  });

  it('opens the Add contact dialog prefilled from /@handle', async () => {
    renderApp('/@bob_b');
    expect(await screen.findByRole('dialog', { name: 'Add contact' })).toBeTruthy();
    expect(screen.getByDisplayValue('bob_b')).toBeTruthy();
  });

  it('sends a logged-out /@handle visitor to login (returning to /@handle)', async () => {
    const { AuthProvider } = await import('@/auth/AuthProvider');
    const { ChatStoreProvider } = await import('@/store/ChatStoreProvider');
    const { createChatStore } = await import('@/store/store');
    const { render } = await import('@testing-library/react');
    const { MemoryRouter, useLocation } = await import('react-router');
    const { AppRoutes } = await import('@/routes/AppRoutes');
    function ShowPath() {
      const location = useLocation();
      return <div data-testid="path">{`${location.pathname}${location.search}`}</div>;
    }
    // Full router (not renderApp): guest + initial entry /@bob_b must land
    // on /login, and the location state must carry `from: /@bob_b` so the
    // login flow returns to the real share URL afterwards. The state is
    // read through a second probe route instead of a captured variable
    // (reassigning outer variables during render is a lint error).
    function ShowFrom() {
      const location = useLocation();
      const state = location.state as { from?: string } | null;
      return <div data-testid="from">{state?.from ?? ''}</div>;
    }
    render(
      <AuthProvider value={{ status: 'guest', user: undefined, refetch: async () => {} }}>
        <ChatStoreProvider store={createChatStore()}>
          <MemoryRouter initialEntries={['/@bob_b']}>
            <AppRoutes />
            <ShowPath />
            <ShowFrom />
          </MemoryRouter>
        </ChatStoreProvider>
      </AuthProvider>,
    );
    expect(await screen.findByText('Sign in to Zilar')).toBeTruthy();
    expect(screen.getByTestId('path').textContent).toBe('/login');
    expect(screen.getByTestId('from').textContent).toBe('/@bob_b');
  });

  it('redirects a bare /@ home like the catch-all', async () => {
    const { unmount } = renderApp('/@');
    expect(await screen.findByText(/Chats|New chat|Invite a friend/)).toBeTruthy();
    unmount();
  });

  it('keeps static routes ahead of the atHandle gate', () => {
    // Static routes are declared before the dynamic gate, so they win.
    const routes = [
      { path: '/settings/ais', element: <div /> },
      { path: '/u/:handle', element: <div /> },
      { path: '/:atHandle', element: <div /> },
      { path: '*', element: <div /> },
    ];
    expect(matchRoutes(routes, '/@ada')?.[0]?.params).toMatchObject({ atHandle: '@ada' });
    expect(matchRoutes(routes, '/settings/ais')?.[0]?.route.path).toBe('/settings/ais');
    expect(matchRoutes(routes, '/u/bob_b')?.[0]?.route.path).toBe('/u/:handle');
  });
});
