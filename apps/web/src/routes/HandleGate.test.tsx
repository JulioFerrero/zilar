import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
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

  it('opens the Add contact dialog prefilled from /u/handle', async () => {
    renderApp('/u/bob_b');
    expect(await screen.findByRole('dialog', { name: 'Add contact' })).toBeTruthy();
    expect(screen.getByDisplayValue('bob_b')).toBeTruthy();
  });
});
