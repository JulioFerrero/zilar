import type { AuthStatus } from './session-store';

export type GuardDecision =
  { kind: 'loading' } | { kind: 'allow' } | { kind: 'login'; from: string } | { kind: 'name' };

/**
 * Decides where a protected screen should send the user. A guest goes to
 * `/login` with `from` = the target so the flow can return there; a signed-in
 * user without a name goes to `/welcome/name`.
 */
export function guardDecision(input: {
  status: AuthStatus;
  name: string | undefined;
  target: string;
}): GuardDecision {
  if (input.status === 'loading') {
    return { kind: 'loading' };
  }
  if (input.status === 'guest') {
    return { kind: 'login', from: input.target };
  }
  if ((input.name ?? '').trim() === '') {
    return { kind: 'name' };
  }
  return { kind: 'allow' };
}

/** Only relative in-app paths may be used as a post-login target. */
export function safeTarget(from: string | string[] | undefined): string {
  const value = Array.isArray(from) ? from[0] : from;
  return typeof value === 'string' && value.startsWith('/') ? value : '/';
}
