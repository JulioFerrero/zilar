import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

describe('App routes', () => {
  it('redirects a guest to the login screen', async () => {
    renderApp('/', undefined, {
      auth: { status: 'guest', user: undefined, refetch: async () => {} },
    });

    expect(await screen.findByText('Sign in to Zilar')).toBeTruthy();
  });

  it('renders the chat shell with the search field for a signed-in user', () => {
    renderApp('/');

    expect(screen.getByLabelText('Search chats')).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('Dev team')).toBeTruthy();
  });

  it('sends a user without a name to the name step', () => {
    renderApp('/', undefined, {
      auth: {
        status: 'authenticated',
        user: { id: 'u-you', name: '', email: 'you@zilar.test' },
        refetch: async () => {},
      },
    });

    expect(screen.getByText('What should we call you?')).toBeTruthy();
  });
});
