import type { AuthStatus } from './session-store';

export type GuardDecision =
  { kind: 'loading' } | { kind: 'allow' } | { kind: 'login'; from: string } | { kind: 'name' };

/**
 * A guest goes to `/login` with `from` = the target; a signed-in user with no
 * name goes to `/welcome/name`. An `offline` status never signs the user out.
 */
export function guardDecision(input: {
  status: AuthStatus;
  name: string | undefined;
  target: string;
}): GuardDecision {
  if (input.status === 'loading') {
    return { kind: 'loading' };
  }
  if (input.status === 'offline') {
    return input.name === undefined ? { kind: 'loading' } : { kind: 'allow' };
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
