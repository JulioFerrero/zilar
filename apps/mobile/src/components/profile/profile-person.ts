import type { HandleProfile } from '@/lib/contacts-api';

/**
 * The by-handle profile plus the optional bio the server sends (T-1258). The
 * phone's `HandleProfile` narrows the contract and drops `bio`, so the screen
 * widens it here to read the bio it already receives (T-1308).
 */
export type ProfilePerson = HandleProfile & { bio?: string };
