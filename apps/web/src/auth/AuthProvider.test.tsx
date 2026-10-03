import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthProvider';
import { authClient } from '@/lib/auth';
import { getMe } from '@/lib/api';
import { isMockMode } from '@/mock/gate';

vi.mock('@/mock/gate', () => ({
  isMockMode: vi.fn(() => false),
  isMockApiEnabled: vi.fn(() => false),
}));

vi.mock('@/lib/auth', () => ({
  INVITE_HEADER: 'x-zilar-invite',
  authClient: {
    useSession: vi.fn(() => ({ data: null, isPending: false, refetch: vi.fn(async () => {}) })),
  },
  sendSignInCode: vi.fn(),
  verifySignInCode: vi.fn(),
  signOut: vi.fn(),
}));

// Better Auth's session user shape is wider than AuthUser; the provider
// only reads id/name/email off it.
// Better Auth's session shape is wider than AuthUser; the provider only
// reads id/name/email off the user, so the doubles below use the real
// useSession return type with the extra fields filled in.
import type { authClient as AuthClient } from '@/lib/auth';

type SessionReturn = ReturnType<typeof AuthClient.useSession>;

function sessionValue(): SessionReturn {
  return {
    data: {
      user: {
        id: 'u-1',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        image: null,
      },
      session: {
        id: 's-1',
        userId: 'u-1',
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        token: 'tok',
        ipAddress: null,
        userAgent: null,
      },
    },
    isPending: false,
    error: null,
    isRefetching: false,
    refetch: async () => {},
  } as unknown as SessionReturn;
}

vi.mock('@/lib/api', () => ({
  getMe: vi.fn(),
}));

function Probe() {
  const auth = useAuth();
  return (
    <div>
      {auth.status}:{auth.user?.name ?? ''}:{String(auth.user?.handle)}
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMe).mockResolvedValue({
    id: 'u-1',
    email: 'ada@example.com',
    name: 'Ada',
    handle: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuthProvider', () => {
  it('reports the fixed mock user in mock mode without Better Auth', () => {
    vi.mocked(isMockMode).mockReturnValue(true);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByText('authenticated:You:undefined')).toBeTruthy();
    expect(vi.mocked(authClient.useSession)).not.toHaveBeenCalled();
  });

  it('does not fake a session when the mock gate is closed', () => {
    vi.mocked(isMockMode).mockReturnValue(false);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByText('guest::undefined')).toBeTruthy();

    expect(vi.mocked(authClient.useSession)).toHaveBeenCalled();
  });

  it('keeps handle undefined when GET /me fails (no onboarding redirect)', async () => {
    vi.mocked(isMockMode).mockReturnValue(false);
    vi.mocked(authClient.useSession).mockReturnValue(sessionValue());
    vi.mocked(getMe).mockRejectedValue(new Error('network down'));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    // Authenticated, but the handle is still unknown — the gate (which only
    // redirects on `handle === null`) stays off.
    expect(await screen.findByText('authenticated:Ada:undefined')).toBeTruthy();
  });

  it('fills the handle from GET /me on success', async () => {
    vi.mocked(isMockMode).mockReturnValue(false);
    vi.mocked(authClient.useSession).mockReturnValue(sessionValue());
    vi.mocked(getMe).mockResolvedValue({
      id: 'u-1',
      email: 'ada@example.com',
      name: 'Ada',
      handle: 'ada',
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('authenticated:Ada:ada')).toBeTruthy();
  });
});
