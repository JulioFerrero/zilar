import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { getInvite } from '@/lib/api';
import { InvitePage } from './InvitePage';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getInvite: vi.fn(),
}));

vi.mock('@/components/auth/AuthFlow', () => ({
  AuthFlow: ({ inviteCode, heading }: { inviteCode?: string; heading?: string }) => (
    <div>
      {heading} / {inviteCode}
    </div>
  ),
}));

const getInviteMock = vi.mocked(getInvite);

function renderInvite(path = '/i/abc') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/i/:code" element={<InvitePage />} />
        <Route path="/i" element={<InvitePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('InvitePage', () => {
  it('shows the checking text while the invite is looked up', () => {
    getInviteMock.mockReturnValue(new Promise(() => {}));
    renderInvite();

    expect(screen.getByText('Checking your invite…')).toBeTruthy();
    expect(getInviteMock).toHaveBeenCalledWith('abc');
  });

  it('opens the sign-in flow with the code when the invite is valid', async () => {
    getInviteMock.mockResolvedValue({ valid: true });
    renderInvite();

    expect(await screen.findByText("You're invited to Zilar / abc")).toBeTruthy();
  });

  it('says the invite is not valid when the server refuses it', async () => {
    getInviteMock.mockResolvedValue({ valid: false });
    renderInvite();

    expect(await screen.findByText('Invite not valid')).toBeTruthy();
    expect(
      screen.getByText(
        'This invite link has expired or was already used. Ask your friend for a new one.',
      ),
    ).toBeTruthy();
  });

  it('says the invite is not valid when the lookup fails', async () => {
    getInviteMock.mockRejectedValue(new Error('network down'));
    renderInvite();

    expect(await screen.findByText('Invite not valid')).toBeTruthy();
  });

  it('says the invite is not valid without a code, and does not look it up', () => {
    renderInvite('/i');

    expect(screen.getByText('Invite not valid')).toBeTruthy();
    expect(getInviteMock).not.toHaveBeenCalled();
  });
});
