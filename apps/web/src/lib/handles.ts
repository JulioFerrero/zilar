import {
  ApiError,
  checkHandle as apiCheckHandle,
  claimHandle as apiClaimHandle,
  type HandleCheck,
} from '@/lib/api';

export { ApiError };

// Mirrors the server's handle shapes client-side, so the input can hint
// before the debounced availability call answers. The server is the
// authority; this only shapes text.
const SUGGEST_INVALID = /[^a-z0-9_]+/g;

/** Builds a suggestion from a display name or an email local part. */
export function suggestHandleFor(name: string, email?: string): string {
  const candidates = [name, email === undefined ? '' : (email.split('@')[0] ?? '')];
  for (const candidate of candidates) {
    const suggestion = shapeSuggestion(candidate);
    if (suggestion !== null) {
      return suggestion;
    }
  }
  return 'user';
}

function shapeSuggestion(raw: string): string | null {
  let shaped = raw.trim().toLowerCase().replace(SUGGEST_INVALID, '_').replace(/^_+/, '');
  shaped = shaped.replace(/_+$/, '');
  if (shaped === '') {
    return null;
  }
  if (!/^[a-z]/.test(shaped)) {
    shaped = `u_${shaped}`;
  }
  shaped = shaped.slice(0, 32).replace(/_+$/, '');
  if (shaped.length < 3) {
    shaped = shaped.padEnd(3, '0').slice(0, 32);
  }
  if (!/^[a-z][a-z0-9_]{2,31}$/.test(shaped)) {
    return null;
  }
  return shaped;
}

export async function checkHandle(handle: string): Promise<HandleCheck> {
  return apiCheckHandle(handle);
}

export async function claimHandle(handle: string): Promise<{ handle: string }> {
  return apiClaimHandle(handle);
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'rate_limited';
}
