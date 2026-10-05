import { useEffect, useState } from 'react';
import { getIntegrationsStatus } from '@/lib/api';

/**
 * Whether the signed-in user is the server owner (T-0162). The owner is
 * the user with the earliest `createdAt`; `GET /api/settings/integrations`
 * answers 200 for the owner and the same 404 as an unknown route for
 * everyone else, so 200 means owner and 404 (or any error) means not.
 *
 * The answer is fetched once per session and cached in module state, so
 * every consumer (menu, stickers page, import dialog) shares one request.
 * Starts as not-owner and only switches on after the 200 — never show an
 * owner-only entry optimistically.
 */
let cached: boolean | undefined;

export function useIsServerOwner(): boolean {
  const [isOwner, setIsOwner] = useState(cached ?? false);

  // The effect only synchronizes with the owner endpoint (the lint rule
  // flags synchronous setState inside effects); the fetch promise resolves
  // the next state, applied once.
  useEffect(() => {
    if (cached !== undefined) {
      return;
    }
    let active = true;
    void ownerFromServer().then((next) => {
      cached = next;
      if (active) {
        setIsOwner(next);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return isOwner;
}

async function ownerFromServer(): Promise<boolean> {
  try {
    await getIntegrationsStatus();
    return true;
  } catch {
    // 404 (not the owner) and any error both read as not-owner: the
    // endpoint reveals nothing beyond the status either way.
    return false;
  }
}

/** Forgets the cached owner answer (tests only). */
export function resetIsServerOwnerCache(): void {
  cached = undefined;
}
