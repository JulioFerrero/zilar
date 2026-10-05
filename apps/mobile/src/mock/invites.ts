import type { Invite, InvitesApi } from '../lib/invites-api';

/**
 * Mock personal-invite API for offline UI work and screenshots. Returns a
 * fixed invite link, like the mock approval the chat's mock card references.
 */

const MOCK_INVITE: Invite = {
  code: 'mock-code',
  url: 'https://chat.zilar.app/invite/mock-code',
};

/** An `InvitesApi` backed by fixed mock data, for offline UI work and screenshots. */
export function createMockInvitesApi(): InvitesApi {
  return {
    async createInvite() {
      return { ...MOCK_INVITE };
    },
  };
}
