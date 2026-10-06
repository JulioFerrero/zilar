import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AuthProvider } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';
import { InviteDialog } from './InviteDialog';

function renderDialog(onClose: () => void) {
  const store = createChatStore();
  store.setState({ createInvite: vi.fn(async () => 'http://localhost:3000/invite/abc') });
  return render(
    <AuthProvider
      value={{
        status: 'authenticated',
        user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: 'you' },
        refetch: async () => {},
      }}
    >
      <ChatStoreProvider store={store}>
        <InviteDialog onClose={onClose} />
      </ChatStoreProvider>
    </AuthProvider>,
  );
}

describe('InviteDialog', () => {
  it('uses the title as the accessible name and closes on Escape', async () => {
    const onClose = vi.fn();
    renderDialog(onClose);

    const dialog = await screen.findByRole('dialog', { name: 'Invite a friend' });
    expect(await screen.findByText('http://localhost:3000/invite/abc')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' }).getAttribute('data-slot')).toBe('button');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
