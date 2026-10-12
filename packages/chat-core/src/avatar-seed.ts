// Avatar seed helpers (T-1209): one ball per person, AI and group on every
// web screen. `avatarSvg` normalizes its seed, so these helpers only pick the
// right id; they do not normalize themselves.
//
// The client cannot reproduce the server's `u<hash>` fallback for unusual ids
// (`provisioning.ts:29-35` hashes with sha256 and base32 there), but normal
// ids — the lowercased user id — match the web mention builder exactly
// (`${userId.toLowerCase()}@${domain}`), and the DM chat id and the store
// contact's `jid` already carry the real bare JID, which callers prefer.
// `normalizeJid` in `avatarSvg` strips any resource and lowercases, so a
// mixed-case input still draws the same ball.

/**
 * A person's seed: their bare JID. Prefer the real bare JID when the call
 * site already has it (the DM chat id, the store contact's `jid`); otherwise
 * derive it from the user id and the XMPP domain the way the web mention
 * builder does.
 */
export function personSeed(userId: string, domain: string): string {
  return `${userId.toLowerCase()}@${domain}`;
}

/** An AI's seed: its AI JID (`ai-<aiId>@<domain>`). */
export function aiSeed(aiJid: string): string {
  return aiJid;
}

/**
 * A group, channel or topic's seed: the General topic's room JID. A topic
 * row passes its own room JID, which is the same family (the General topic's
 * room JID is the group's old chat id). Where the topics are not loaded yet
 * (cold explore lists), the rule's id is not available and the call site is
 * left unchanged.
 */
export function groupSeed(generalRoomJid: string): string {
  return generalRoomJid;
}
