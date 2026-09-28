/**
 * Whether a JID belongs to one of our AIs. AIs are provisioned with an `ai-`
 * localpart (`ai-<aiId>@<domain>`), so the localpart alone decides it; any
 * resource (`/nick`) or query is dropped first. Shared by the Markdown rule in
 * `markdown.ts` and the web UI's AI badge, so the two can never disagree.
 */
export function isAiJid(jid: string): boolean {
  const bare = (jid.split('/')[0] ?? jid).split('?')[0] ?? jid;
  const localpart = bare.split('@')[0] ?? bare;
  return localpart.startsWith('ai-');
}
