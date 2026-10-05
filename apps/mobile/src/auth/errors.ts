import type { AuthError } from './session-store';

/** Mirrors the web copy for the errors the server can return (T-0015/T-0024). */
export function errorMessageFor(error: AuthError | undefined): string {
  const code = error?.code ?? '';
  if (code === 'TOO_MANY_ATTEMPTS' || error?.status === 429) {
    return 'Too many attempts, try again later';
  }
  if (code === 'INVALID_OTP' || code === 'OTP_EXPIRED') {
    return 'Wrong code';
  }
  return 'Something went wrong. Try again.';
}

export function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
