import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthProvider';
import { authClient } from '@/lib/auth';
import { isMockMode } from '@/mock/gate';

vi.mock('@/mock/gate', () => ({
  isMockMode: vi.fn(() => false),
  isMockApiEnabled: vi.fn(() => false),
}));

vi.mock('@/lib/auth', () => ({
  INVITE_HEADER: 'x-galena-invite',
  authClient: {
    useSession: vi.fn(() => ({ data: null, isPending: false, refetch: vi.fn(async () => {}) })),
  },
  sendSignInCode: vi.fn(),
  verifySignInCode: vi.fn(),
  signOut: vi.fn(),
}));

function Probe() {
  const auth = useAuth();
  return (
    <div>
      {auth.status}:{auth.user?.name ?? ''}
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuthProvider', () => {
  it('reports the fixed mock user in mock mode without Better Auth', () => {
    vi.mocked(isMockMode).mockReturnValue(true);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByText('authenticated:You')).toBeTruthy();
    expect(vi.mocked(authClient.useSession)).not.toHaveBeenCalled();
  });

  it('does not fake a session when the mock gate is closed', () => {
    vi.mocked(isMockMode).mockReturnValue(false);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByText('guest:')).toBeTruthy();
    expect(vi.mocked(authClient.useSession)).toHaveBeenCalled();
  });
});
