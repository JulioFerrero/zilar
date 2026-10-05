import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { updateMe } from '@/lib/api';
import { NamePage } from './NamePage';

vi.mock('@/lib/api', () => ({
  updateMe: vi.fn(async (name: string) => ({ id: 'u-1', email: 'a@b.com', name, jid: null })),
}));

const updateMock = vi.mocked(updateMe);

describe('NamePage', () => {
  it('saves the name through the API and refreshes the session', async () => {
    const refetch = vi.fn(async () => {});
    render(
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-1', name: '', email: 'a@b.com' },
          refetch,
        }}
      >
        <MemoryRouter>
          <NamePage />
        </MemoryRouter>
      </AuthProvider>,
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Ada  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('Ada'));
    expect(refetch).toHaveBeenCalled();
  });

  it('does not call the API for an empty name', async () => {
    render(
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-1', name: '', email: 'a@b.com' },
          refetch: async () => {},
        }}
      >
        <MemoryRouter>
          <NamePage />
        </MemoryRouter>
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Enter your name')).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('returns to `next` after saving (join-by-link round trip)', async () => {
    render(
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-1', name: '', email: 'a@b.com' },
          refetch: async () => {},
        }}
      >
        <MemoryRouter initialEntries={[{ pathname: '/welcome/name', state: { next: '/j/abc' } }]}>
          <Routes>
            <Route path="/welcome/name" element={<NamePage />} />
            <Route path="/j/:token" element={<div>Join page</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Join page')).toBeTruthy();
  });
});
